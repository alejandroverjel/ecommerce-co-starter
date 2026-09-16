import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { enviarAvisoTienda, enviarConfirmacionDePago } from "@/lib/correo/pedido";
import { leerSecretoPasarela } from "@/lib/admin/secretos";
import {
  aEstadoPago,
  configuracionCobroMercadoPago,
  consultarPagoMercadoPago,
  firmaMercadoPagoEsValida,
} from "@/lib/pagos/mercadopago";

/**
 * Webhook de Mercado Pago.
 *
 * ÚNICA fuente de verdad de que un pedido se pagó. La vuelta del cliente a
 * /gracias es solo una redirección del navegador y se falsifica escribiendo la
 * URL; esto no, porque cada notificación viene firmada con la clave secreta del
 * webhook y aquí se verifica antes de tocar nada.
 *
 * Dos capas de desconfianza, no una:
 *   1. La firma `x-signature` demuestra que el POST viene de Mercado Pago.
 *   2. Aunque venga de MP, el estado y el monto NO se leen del cuerpo: se
 *      RECONSULTAN a la API con el access token. El cuerpo solo aporta un id.
 *
 * Aplicar el cobro se delega en `fulfill_paid_order`, la misma función que usa
 * el panel y el webhook de Wompi: hereda su idempotencia por
 * (gateway, external_id) —un reenvío de MP no cobra dos veces ni descuenta
 * stock dos veces—, su orden de bloqueo y su guarda de monto.
 */

export const dynamic = "force-dynamic";

type FilaFulfill = {
  order_id: string;
  new_status: string;
  already_processed: boolean;
  needs_review: boolean;
  review_reason: string | null;
};

export async function POST(peticion: Request) {
  let cuerpo: {
    type?: string;
    topic?: string;
    action?: string;
    data?: { id?: string | number };
  };

  try {
    cuerpo = await peticion.json();
  } catch {
    // MP reintenta ante un 400; con un cuerpo ilegible no hay nada que
    // reintentar, pero tampoco es un evento válido.
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }

  const url = new URL(peticion.url);

  // MP manda el tipo y el id por el cuerpo o por la query, según la antigüedad
  // de la integración y el tipo de notificación. Se aceptan las dos formas.
  const tipo = cuerpo.type ?? cuerpo.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
  const idPago = String(
    cuerpo.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "",
  );

  // Solo interesan los eventos de pago. `merchant_order` y demás se aceptan
  // con 200 para que MP no los reintente en bucle, pero no mueven nada.
  if (tipo !== "payment" || !idPago) {
    return NextResponse.json({ recibido: true });
  }

  const secreto = await leerSecretoPasarela("mercadopago", "secretoEventos");
  if (!secreto) {
    // Sin secreto no se puede verificar NADA. Se rechaza en vez de dar por
    // buenos los eventos: dar por pagado un POST sin verificar es justo el
    // agujero que este endpoint existe para cerrar.
    console.error("mercadopago/webhook: falta la clave secreta del webhook; evento descartado");
    return NextResponse.json({ error: "webhook no configurado" }, { status: 503 });
  }

  const firmaValida = firmaMercadoPagoEsValida(
    peticion.headers.get("x-signature"),
    peticion.headers.get("x-request-id"),
    idPago,
    secreto,
  );

  if (!firmaValida) {
    console.warn("mercadopago/webhook: firma inválida; evento descartado");
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  const cfg = await configuracionCobroMercadoPago();
  if (!cfg) {
    // La pasarela quedó apagada o sin access token entre el cobro y la
    // notificación. Se devuelve 503 para que MP reintente: el pago existe y
    // hay que aplicarlo cuando la configuración vuelva.
    console.error("mercadopago/webhook: pasarela sin configurar; se pedirá reintento");
    return NextResponse.json({ error: "pasarela no configurada" }, { status: 503 });
  }

  const pago = await consultarPagoMercadoPago(cfg, idPago);
  if (!pago) {
    return NextResponse.json({ error: "no se pudo consultar el pago" }, { status: 503 });
  }

  if (!pago.referencia) {
    // Sin external_reference no se sabe a qué pedido aplicarlo. Se acepta el
    // evento —reintentar no lo va a arreglar— y se deja el aviso en el log.
    console.error(`mercadopago/webhook: el pago ${pago.id} no trae external_reference`);
    return NextResponse.json({ recibido: true });
  }

  const estado = aEstadoPago(pago.estado);

  // Pendiente o un estado que no reconocemos: se acepta el evento (200) para
  // que MP no lo reintente en bucle, pero no se toca el pedido. El cobro se
  // aplicará cuando llegue el evento terminal.
  if (estado === null || estado === "pendiente") {
    return NextResponse.json({ recibido: true });
  }

  try {
    const { rows } = await db.execute<FilaFulfill>(sql`
      select * from fulfill_paid_order(
        'mercadopago'::payment_gateway,
        ${`mp-evt:${pago.id}:${pago.estado}`}::text,
        ${pago.id}::text,
        ${pago.referencia}::text,
        ${estado}::payment_status,
        ${pago.montoCop}::integer,
        ${JSON.stringify({ origen: "webhook", action: cuerpo.action ?? null, estadoMp: pago.estado })}::jsonb,
        ${cuerpo.action ?? "payment.updated"}::text
      )`);

    const fila = rows[0];
    if (fila?.needs_review) {
      console.warn(
        `mercadopago/webhook: ${pago.referencia} necesita revisión — ${fila.review_reason ?? "sin motivo"}`,
      );
    }

    /**
     * Un cobro aprobado DESCUENTA INVENTARIO dentro de `fulfill_paid_order`.
     * Sin esto, las fichas —que son ISR— seguirían anunciando como disponible
     * lo que acaba de venderse, hasta que expire su caché. El panel ya hacía
     * este refresco al registrar un cobro a mano; el webhook no, así que las
     * ventas por pasarela (o sea, casi todas) dejaban el catálogo mintiendo.
     *
     * Solo cuando de verdad se aplicó algo: si el evento ya estaba procesado
     * no se movió stock y no hay nada que refrescar.
     */
    if (estado === "aprobado" && !fila?.already_processed) {
      revalidatePath("/tienda/[categoria]/[producto]", "page");
      revalidatePath("/", "page");

      // Avisar al comprador (pago confirmado) y a la tienda (pedido PAGADO,
      // listo para preparar). Se esperan en vez de soltarlos: en un runtime
      // serverless una promesa sin await se corta al devolver la respuesta. Las
      // funciones no lanzan y la pasarela tolera de sobra la espera.
      await Promise.all([
        enviarConfirmacionDePago(pago.referencia),
        enviarAvisoTienda(pago.referencia),
      ]);
    }

    // 200 si se procesó (o ya estaba procesado): MP deja de reintentar. Un
    // error real cae abajo con 500 y MP sí reintenta.
    return NextResponse.json({ recibido: true });
  } catch (e) {
    // No se registra el objeto entero: su message trae la SQL con parámetros.
    const code =
      typeof e === "object" && e !== null && "cause" in e && e.cause
        ? (e.cause as { code?: unknown }).code
        : (e as { code?: unknown })?.code;
    console.error(`mercadopago/webhook: fallo aplicando el cobro (code=${String(code ?? "?")})`);
    return NextResponse.json({ error: "no se pudo aplicar" }, { status: 500 });
  }
}

/**
 * MP hace un GET de prueba al guardar la URL en el panel de "Webhooks".
 * Sin esto respondería 405 y la consola lo marcaría como fallido.
 */
export async function GET() {
  return NextResponse.json({ ok: true });
}
