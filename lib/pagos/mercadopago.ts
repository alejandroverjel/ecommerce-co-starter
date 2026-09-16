import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { paymentGateways } from "@/lib/db/schema";
import { leerSecretoPasarela } from "@/lib/admin/secretos";
import { SITIO } from "@/lib/sitio";
import { TIENDA } from "@/tienda.config";
import { urlGraciasFirmada } from "@/lib/pagos/recibo";
import {
  aEstadoPago,
  firmaMercadoPagoEsValida,
  lineasParaPreferencia,
  type LineaPreferencia,
} from "@/lib/pagos/mercadopago-puro";

// Reexportadas para que las rutas de app/api sigan importando de aquí: la
// implementación (pura, sin server-only ni db) vive en mercadopago-puro.ts
// porque también la necesita app/api/checkout/route.ts.
export { aEstadoPago, firmaMercadoPagoEsValida, lineasParaPreferencia };
export type { LineaPreferencia };

/**
 * ============================================================================
 * Mercado Pago — Checkout Pro
 * ============================================================================
 *
 * DECISIÓN: Checkout Pro (redirección al checkout hospedado de MP), no el
 * Brick embebido ni la API de pagos directa. El cliente sale a mercadopago.com,
 * paga con tarjeta / PSE / Efecty / saldo, y vuelve. Los datos de tarjeta nunca
 * tocan nuestro servidor: el alcance PCI se queda en el mínimo.
 *
 * DIFERENCIA IMPORTANTE CON WOMPI: allá el cobro se inicia armando una URL
 * firmada, sin llamar a nadie. Aquí hay que CREAR UNA PREFERENCIA por API
 * (autenticada con el access token) y usar la URL que devuelve. Es una llamada
 * de red en el camino del checkout, así que tiene timeout y falla explícita: si
 * MP no responde, el pedido ya está creado y se le da el número al cliente en
 * vez de dejarlo en una pantalla rota.
 *
 * El cobro NO se da por bueno cuando el cliente vuelve a /gracias: eso es la
 * redirección del navegador y se falsifica escribiendo la URL. La verdad llega
 * por el WEBHOOK (`app/api/pagos/mercadopago/route.ts`), que verifica la firma
 * y RECONSULTA el pago a la API de MP antes de tocar nada.
 *
 * Las llaves salen del panel (payment_gateways, cifradas), no de .env:
 *   - `publicKey`        → Public Key (APP_USR-... / TEST-...). Informativa
 *                          para Checkout Pro; se conserva por si algún día se
 *                          usa un Brick.
 *   - `llavePrivada`     → ACCESS TOKEN. Es lo que autentica las llamadas.
 *   - `secretoEventos`   → clave secreta del webhook (Tus integraciones →
 *                          Webhooks → Configurar notificaciones).
 *   - `secretoIntegridad`→ NO APLICA en Mercado Pago.
 */

const API = "https://api.mercadopago.com";

/** MP puede tardar; más de esto y preferimos devolver el pedido sin cobro. */
const TIMEOUT_MS = 8000;

type ConfigMercadoPago = {
  accessToken: string;
  sandbox: boolean;
};

/**
 * Configuración para iniciar un cobro. Devuelve null si falta algo: sin access
 * token no se puede crear la preferencia, y mandar al cliente a una pasarela
 * rota es peor que ofrecerle otro método.
 */
export async function configuracionCobroMercadoPago(): Promise<ConfigMercadoPago | null> {
  const filas = await db
    .select({
      habilitada: paymentGateways.isEnabled,
      sandbox: paymentGateways.isSandbox,
    })
    .from(paymentGateways)
    .where(eq(paymentGateways.gateway, "mercadopago"))
    .limit(1);

  const fila = filas[0];
  if (!fila?.habilitada) return null;

  const accessToken = await leerSecretoPasarela("mercadopago", "llavePrivada");
  if (!accessToken) return null;

  return { accessToken, sandbox: fila.sandbox };
}

/**
 * Crea la preferencia y devuelve la URL a la que hay que mandar al cliente.
 *
 * `external_reference` es el número de pedido: es lo que el webhook usa para
 * encontrarlo y lo que aparece en la conciliación de Mercado Pago.
 *
 * COP no tiene centavos y MP recibe el monto en unidades de la moneda (a
 * diferencia de Wompi, que cobra en centavos). Se manda el entero tal cual.
 */
export async function crearPreferenciaMercadoPago(
  cfg: ConfigMercadoPago,
  referencia: string,
  lineas: LineaPreferencia[],
  envioCop: number,
  /** Total del pedido: viaja firmado en la URL de retorno para poder mostrarlo. */
  totalCop: number,
): Promise<string | null> {
  const cuerpo = {
    items: lineas.map((l) => ({
      title: l.titulo.slice(0, 250),
      quantity: l.cantidad,
      unit_price: l.precioCop,
      currency_id: "COP",
    })),
    // El envío va como costo aparte y no como ítem, para que el desglose que
    // ve el cliente en MP coincida con el del carrito.
    shipments: envioCop > 0 ? { cost: envioCop, mode: "not_specified" } : undefined,
    external_reference: referencia,
    back_urls: {
      // Con el total firmado: sin él la página de gracias no puede verificar
      // la cifra y la oculta, dejando a la persona sin saber cuánto pagó.
      success: urlGraciasFirmada(referencia, totalCop),
      pending: urlGraciasFirmada(referencia, totalCop),
      failure: `${SITIO.dominio}/finalizar-compra/?pago=fallido&pedido=${encodeURIComponent(referencia)}`,
    },
    // Vuelve solo al aprobar. En pending se queda en MP (Efecty, PSE en
    // proceso) y el webhook resolverá cuando el pago termine.
    auto_return: "approved",
    notification_url: `${SITIO.dominio}/api/pagos/mercadopago/`,
    statement_descriptor: TIENDA.pagos.descriptorExtracto.slice(0, 13),
  };

  const respuesta = await fetch(`${API}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!respuesta.ok) {
    // Se registra el status, NO el cuerpo: la respuesta de error de MP puede
    // devolver partes de la petición, y ahí van los datos del comprador.
    console.error(`mercadopago: la preferencia falló con HTTP ${respuesta.status}`);
    return null;
  }

  const datos = (await respuesta.json()) as {
    init_point?: string;
    sandbox_init_point?: string;
  };

  /**
   * SIEMPRE init_point. `sandbox_init_point` es del esquema viejo de
   * credenciales TEST- y está deprecado: con las credenciales de prueba
   * actuales (aplicación de prueba, prefijo APP_USR-) el flujo correcto es
   * abrir init_point y pagar con las tarjetas o usuarios de prueba — no se
   * mueve dinero real porque las credenciales son de la app de prueba, no
   * porque la URL sea otra. Se conserva sandbox_init_point solo como respaldo
   * si init_point faltara.
   */
  return datos.init_point ?? datos.sandbox_init_point ?? null;
}

export type PagoMercadoPago = {
  id: string;
  estado: string;
  montoCop: number;
  referencia: string | null;
};

/**
 * Reconsulta el pago a la API de Mercado Pago.
 *
 * El webhook solo trae un id. El estado y el monto SIEMPRE se leen de aquí, no
 * del cuerpo de la notificación: es la única fuente que no puede manipular
 * quien mande el POST, y evita confiar en un payload que podría venir
 * incompleto o reordenado.
 */
export async function consultarPagoMercadoPago(
  cfg: ConfigMercadoPago,
  idPago: string,
): Promise<PagoMercadoPago | null> {
  const respuesta = await fetch(`${API}/v1/payments/${encodeURIComponent(idPago)}`, {
    headers: { Authorization: `Bearer ${cfg.accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!respuesta.ok) {
    console.error(`mercadopago: consulta del pago ${idPago} devolvió HTTP ${respuesta.status}`);
    return null;
  }

  const d = (await respuesta.json()) as {
    id?: number | string;
    status?: string;
    transaction_amount?: number;
    external_reference?: string | null;
  };

  if (!d.id || !d.status) return null;

  return {
    id: String(d.id),
    estado: d.status,
    // COP sin centavos. MP devuelve el monto en unidades de la moneda.
    montoCop: Math.round(Number(d.transaction_amount ?? 0)),
    referencia: d.external_reference ?? null,
  };
}
