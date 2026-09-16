import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { enviarAvisoTienda, enviarConfirmacionDePago } from "@/lib/correo/pedido";
import { leerSecretoPasarela } from "@/lib/admin/secretos";
import { eventoWompiEsAutentico } from "@/lib/pagos/wompi";

/**
 * Webhook de Wompi.
 *
 * ÚNICA fuente de verdad de que un pedido se pagó. La página de gracias es solo
 * la redirección del navegador y se puede falsificar; esto no, porque cada
 * evento viene firmado con el secreto de EVENTOS y aquí se verifica antes de
 * tocar nada. Sin firma válida, el POST se descarta.
 *
 * Aplicar el cobro se delega en `fulfill_paid_order`, la misma función que usa
 * el panel: hereda su idempotencia por (gateway, external_id) —un reenvío de
 * Wompi no cobra dos veces ni descuenta stock dos veces— y su guarda de monto.
 */

export const dynamic = "force-dynamic";

/** Estado de la transacción de Wompi -> payment_status de la base. */
function aEstadoPago(
  estadoWompi: string,
): "aprobado" | "rechazado" | "reembolsado" | "pendiente" | null {
  switch (estadoWompi) {
    case "APPROVED":
      return "aprobado";
    // VOIDED es la ANULACIÓN de un cobro que ya fue aprobado (devolución el
    // mismo día). Mapearlo a "rechazado" —como antes— dejaba el pedido en
    // 'pagado' y se despachaba mercancía cuya plata ya se devolvió. Como
    // "reembolsado", fulfill_paid_order mueve el pedido a 'reembolsado'; y si
    // llegara sin cobro previo, su guarda 5.e lo deja en revisión.
    case "VOIDED":
      return "reembolsado";
    case "DECLINED":
    case "ERROR":
      return "rechazado";
    case "PENDING":
      return "pendiente";
    default:
      return null;
  }
}

type FilaFulfill = {
  order_id: string;
  new_status: string;
  already_processed: boolean;
  needs_review: boolean;
  review_reason: string | null;
};

export async function POST(peticion: Request) {
  let cuerpo: {
    event?: string;
    data?: { transaction?: Record<string, unknown> };
    signature?: { checksum?: string; properties?: string[] };
    timestamp?: number | string;
  };

  try {
    cuerpo = await peticion.json();
  } catch {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }

  const secreto = await leerSecretoPasarela("wompi", "secretoEventos");
  if (!secreto) {
    // Sin secreto no se puede verificar NADA. Se rechaza en vez de dar por
    // buenos los eventos: dar por pagado un POST sin verificar es justo el
    // agujero que este endpoint existe para cerrar.
    console.error("wompi/webhook: falta el secreto de eventos; evento descartado");
    return NextResponse.json({ error: "webhook no configurado" }, { status: 503 });
  }

  if (!eventoWompiEsAutentico(cuerpo, secreto)) {
    console.warn("wompi/webhook: firma inválida; evento descartado");
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  const txn = cuerpo.data?.transaction;
  const txId = txn?.id ? String(txn.id) : "";
  const referencia = txn?.reference ? String(txn.reference) : "";
  const estadoWompi = txn?.status ? String(txn.status) : "";
  const centavos = Number(txn?.amount_in_cents ?? 0);

  if (!txId || !referencia || !estadoWompi) {
    return NextResponse.json({ error: "transacción incompleta" }, { status: 400 });
  }

  const estado = aEstadoPago(estadoWompi);

  // PENDING o un estado que no reconocemos: se acepta el evento (200) para que
  // Wompi no lo reintente en bucle, pero no se toca el pedido. El cobro se
  // aplicará cuando llegue el evento terminal (APPROVED/DECLINED).
  if (estado === null || estado === "pendiente") {
    return NextResponse.json({ recibido: true });
  }

  try {
    const { rows } = await db.execute<FilaFulfill>(sql`
      select * from fulfill_paid_order(
        'wompi'::payment_gateway,
        ${`wompi-evt:${txId}:${estadoWompi}`}::text,
        ${txId}::text,
        ${referencia}::text,
        ${estado}::payment_status,
        ${Math.round(centavos / 100)}::integer,
        ${JSON.stringify({ origen: "webhook", event: cuerpo.event ?? null, transaction: txn })}::jsonb,
        ${cuerpo.event ?? "transaction.updated"}::text
      )`);

    const fila = rows[0];
    if (fila?.needs_review) {
      console.warn(`wompi/webhook: ${referencia} necesita revisión — ${fila.review_reason ?? "sin motivo"}`);
    }

    // El cobro aprobado descontó inventario: hay que refrescar las fichas o
    // seguirán ofreciendo lo que acaba de venderse. Ver la nota extensa en el
    // webhook de Mercado Pago.
    if (estado === "aprobado" && !fila?.already_processed) {
      revalidatePath("/tienda/[categoria]/[producto]", "page");
      revalidatePath("/", "page");

      // Avisar al comprador. Se espera el envío en vez de soltarlo: en un
      // runtime serverless una promesa sin await se corta al devolver la
      // respuesta. La función no lanza y el correo tarda ~200 ms; la pasarela
      // tolera de sobra esa espera.
      await Promise.all([
        enviarConfirmacionDePago(referencia),
        enviarAvisoTienda(referencia),
      ]);
    }

    // Siempre 200 si se procesó (o ya estaba procesado): así Wompi deja de
    // reintentar. Un error real cae abajo con 500 y Wompi sí reintenta.
    return NextResponse.json({ recibido: true });
  } catch (e) {
    // No se registra el objeto entero: su message trae la SQL con parámetros.
    const code =
      typeof e === "object" && e !== null && "cause" in e && e.cause
        ? (e.cause as { code?: unknown }).code
        : (e as { code?: unknown })?.code;
    console.error(`wompi/webhook: fallo aplicando el cobro (code=${String(code ?? "?")})`);
    return NextResponse.json({ error: "no se pudo aplicar" }, { status: 500 });
  }
}
