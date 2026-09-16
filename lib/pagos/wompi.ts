import "server-only";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { paymentGateways } from "@/lib/db/schema";
import { leerSecretoPasarela } from "@/lib/admin/secretos";
import { SITIO } from "@/lib/sitio";
import { urlGraciasFirmada } from "@/lib/pagos/recibo";
import { aCentavos, eventoWompiEsAutentico } from "@/lib/pagos/wompi-firma";

// Reexportadas para que las rutas de app/api sigan importando de aquí: la
// implementación (pura, sin server-only ni db) vive en wompi-firma.ts porque
// también la necesita app/api/checkout/route.ts.
export { aCentavos, eventoWompiEsAutentico };

/**
 * ============================================================================
 * Wompi — checkout hospedado (Web Checkout) y verificación de eventos
 * ============================================================================
 *
 * DECISIÓN: usamos el checkout HOSPEDADO, no el widget embebido ni la API de
 * transacciones. El cliente sale a `checkout.wompi.co`, paga con tarjeta/PSE/
 * Nequi y vuelve. Así los datos de tarjeta nunca tocan nuestro servidor y el
 * alcance PCI se reduce al mínimo.
 *
 * El cobro NO se da por bueno cuando el cliente vuelve a la página de gracias:
 * eso es solo la redirección del navegador y se puede falsificar. La verdad
 * llega por el WEBHOOK (`app/api/pagos/wompi/route.ts`), que verifica la firma
 * de evento y llama a `fulfill_paid_order`. La página de gracias solo saluda.
 *
 * Las llaves salen del panel (payment_gateways, cifradas), no de .env. La
 * integración queda inerte hasta que un administrador las escribe en
 * /admin/ajustes; ahí se enciende sola.
 */

type ConfigWompi = {
  publicKey: string;
  integridad: string;
  sandbox: boolean;
};

/**
 * Lee la configuración necesaria para INICIAR un cobro: llave pública (va en la
 * URL, es pública) y secreto de integridad (firma el monto para que el cliente
 * no lo altere en la URL). Devuelve null si falta cualquiera de los dos: sin
 * ellos no se puede cobrar y hay que caer a otro método, no mandar al cliente a
 * una pasarela rota.
 */
export async function configuracionCobroWompi(): Promise<ConfigWompi | null> {
  const filas = await db
    .select({
      habilitada: paymentGateways.isEnabled,
      sandbox: paymentGateways.isSandbox,
      publicKey: paymentGateways.publicKey,
    })
    .from(paymentGateways)
    .where(eq(paymentGateways.gateway, "wompi"))
    .limit(1);

  const fila = filas[0];
  if (!fila || !fila.habilitada || !fila.publicKey) return null;

  const integridad = await leerSecretoPasarela("wompi", "secretoIntegridad");
  if (!integridad) return null;

  return { publicKey: fila.publicKey, integridad, sandbox: fila.sandbox };
}

/**
 * Firma de integridad del checkout hospedado.
 *
 * Wompi la exige para que el cliente no pueda cambiar el monto o la referencia
 * en la URL: es SHA-256 de `<referencia><centavos><moneda><secreto>`.
 */
function firmaIntegridad(
  referencia: string,
  centavos: number,
  moneda: string,
  secreto: string,
): string {
  return createHash("sha256")
    .update(`${referencia}${centavos}${moneda}${secreto}`)
    .digest("hex");
}

/**
 * Construye la URL del checkout hospedado para un pedido ya creado.
 *
 * `referencia` es el número de pedido: es lo que el webhook usa para encontrar
 * el pedido y lo que aparece en la conciliación de Wompi.
 */
export function urlCheckoutWompi(
  cfg: ConfigWompi,
  referencia: string,
  totalCop: number,
): string {
  const centavos = aCentavos(totalCop);
  const moneda = "COP";
  // Sandbox y producción comparten dominio: lo que separa uno de otro es el
  // prefijo de la llave pública (pub_test_ vs pub_prod_), no la URL.
  const base = "https://checkout.wompi.co/p/";

  const params = new URLSearchParams({
    "public-key": cfg.publicKey,
    currency: moneda,
    "amount-in-cents": String(centavos),
    reference: referencia,
    "signature:integrity": firmaIntegridad(referencia, centavos, moneda, cfg.integridad),
    // Con el total firmado: si vuelve sin él, la página de gracias oculta la
    // cifra (no la puede verificar) y la persona no sabe cuánto pagó.
    "redirect-url": urlGraciasFirmada(referencia, totalCop),
  });

  return `${base}?${params.toString()}`;
}
