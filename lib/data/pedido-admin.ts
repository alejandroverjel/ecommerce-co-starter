import "server-only";

import { cache } from "react";
import { asc, desc, eq, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orderItems, orders, payments } from "@/lib/db/schema";
import type { ShippingAddressSnapshot } from "@/lib/db/schema";

/**
 * Detalle de un pedido para el panel.
 *
 * Vive aparte de `lib/data/admin.ts` —que es de listados— porque esto trae
 * TODO lo de un solo pedido: tres consultas contra una fila.
 *
 * SIN RLS: la autorización es de quien llama. Esta función no comprueba nada;
 * la página pasa por el layout de /admin y las escrituras por `exigirPersonal()`.
 */

export type ArticuloPedido = {
  id: string;
  nombre: string;
  variante: string;
  sku: string | null;
  precioCop: number;
  cantidad: number;
  lineaCop: number;
  productoId: string | null;
};

export type PagoPedido = {
  id: string;
  pasarela: string;
  estado: string;
  montoCop: number;
  externalId: string | null;
  pagado: Date | null;
  creado: Date;
  /** Solo en los cobros manuales: por dónde entró la plata y quién lo anotó. */
  medio: string | null;
  referencia: string | null;
  nota: string | null;
};

export type PedidoDetalle = {
  id: string;
  numero: string;
  estado: string;

  creado: Date;
  pagadoEn: Date | null;
  canceladoEn: Date | null;

  // Quien paga
  compradorNombre: string | null;
  correo: string;
  telefono: string | null;
  usuarioId: string | null;

  // Quien recibe
  destinatario: string | null;
  telefonoDestinatario: string | null;

  // Dónde y cuándo
  direccion: ShippingAddressSnapshot | null;
  indicaciones: string | null;
  fechaEntrega: string | null;
  franja: string | null;

  // La tarjeta
  mensajeTarjeta: string | null;

  // Dinero — todo entero COP
  subtotalCop: number;
  descuentoCop: number;
  envioCop: number;
  totalCop: number;
  cupon: string | null;
  metodoPago: string | null;

  // Control interno
  tokenCheckout: string | null;
  stockDescontadoEn: Date | null;

  articulos: ArticuloPedido[];
  pagos: PagoPedido[];
};

/** ¿Parece un uuid? Si no, se busca por número de pedido. */
const ES_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Un pedido por id o por número.
 *
 * Acepta las dos formas porque el número (ORD-001042) es lo que la gente
 * copia del correo o dicta por teléfono, y obligar a traducirlo a uuid es
 * fricción sin motivo.
 *
 * Va en `cache()` porque `generateMetadata` y la página lo llaman por
 * separado en la misma petición: sin memoizar eran seis consultas a Postgres
 * por cada vista del detalle en vez de tres.
 */
export const leerPedidoAdmin = cache(async function leerPedidoAdmin(
  idONumero: string,
): Promise<PedidoDetalle | null> {
  const porId = ES_UUID.test(idONumero);

  const [pedido] = await db
    .select({
      id: orders.id,
      numero: orders.orderNumber,
      estado: orders.status,
      creado: orders.createdAt,
      pagadoEn: orders.paidAt,
      canceladoEn: orders.cancelledAt,

      compradorNombre: orders.customerName,
      correo: orders.email,
      telefono: orders.phone,
      usuarioId: orders.userId,

      destinatario: orders.recipientName,
      telefonoDestinatario: orders.recipientPhone,

      direccion: orders.shippingAddress,
      indicaciones: orders.notes,
      fechaEntrega: orders.deliveryDate,
      franja: orders.deliverySlot,

      mensajeTarjeta: orders.giftMessage,

      subtotalCop: orders.subtotalCop,
      descuentoCop: orders.discountCop,
      envioCop: orders.shippingCop,
      totalCop: orders.totalCop,
      cupon: orders.couponCode,
      metodoPago: orders.paymentMethod,

      tokenCheckout: orders.checkoutSessionToken,
      /**
       * `stock_descontado_at` la añadió 0004_pagos.sql con SQL a mano y no
       * está en el schema de Drizzle. Se lee cruda a propósito: meterla en
       * `commerce.ts` haría que `drizzle-kit generate` emitiera un ADD COLUMN
       * que en producción ya existe y reventaría la migración.
       */
      stockDescontadoEn: sql<Date | null>`orders.stock_descontado_at`,
    })
    .from(orders)
    .where(
      porId
        ? eq(orders.id, idONumero)
        : or(
            eq(orders.orderNumber, idONumero),
            eq(orders.orderNumber, idONumero.toUpperCase()),
          ),
    )
    .limit(1);

  if (!pedido) return null;

  const [articulos, cobros] = await Promise.all([
    db
      .select({
        id: orderItems.id,
        nombre: orderItems.productName,
        variante: orderItems.variantName,
        sku: orderItems.sku,
        precioCop: orderItems.unitPriceCop,
        cantidad: orderItems.quantity,
        lineaCop: orderItems.lineTotalCop,
        productoId: orderItems.productId,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, pedido.id))
      .orderBy(asc(orderItems.createdAt)),

    db
      .select({
        id: payments.id,
        pasarela: payments.gateway,
        estado: payments.status,
        montoCop: payments.amountCop,
        externalId: payments.externalId,
        pagado: payments.paidAt,
        creado: payments.createdAt,
        detalle: payments.rawResponse,
      })
      .from(payments)
      .where(eq(payments.orderId, pedido.id))
      .orderBy(desc(payments.createdAt)),
  ]);

  return {
    ...pedido,
    articulos: articulos.map((a) => ({
      ...a,
      // `line_total_cop` es una columna generada: Postgres la calcula, pero
      // Drizzle la tipa como anulable.
      lineaCop: a.lineaCop ?? a.precioCop * a.cantidad,
    })),
    pagos: cobros.map((c) => {
      const detalle = (c.detalle ?? {}) as Record<string, unknown>;
      const texto = (clave: string) =>
        typeof detalle[clave] === "string" ? (detalle[clave] as string) : null;

      return {
        id: c.id,
        pasarela: c.pasarela,
        estado: c.estado,
        montoCop: c.montoCop,
        externalId: c.externalId,
        pagado: c.pagado,
        creado: c.creado,
        medio: texto("medioEtiqueta") ?? texto("medio"),
        referencia: texto("referencia"),
        nota: texto("nota"),
      };
    }),
  };
});
