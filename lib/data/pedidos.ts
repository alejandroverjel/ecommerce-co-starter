import "server-only";

import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { orderItems, orders } from "@/lib/db/schema";

/**
 * Pedidos del cliente.
 *
 * SIN RLS. Se descartó al salir de Supabase, así que la autorización es
 * responsabilidad de esta capa: TODA consulta filtra por `user_id` explícito y
 * el id sale de la sesión del servidor, nunca de un parámetro de la URL.
 */

export type PedidoResumen = {
  id: string;
  numero: string;
  estado: string;
  totalCop: number;
  creado: Date;
  fechaEntrega: string | null;
  franja: string | null;
  destinatario: string | null;
  articulos: { nombre: string; cantidad: number; precioCop: number }[];
};

/** Etiquetas de estado para mostrar. Los valores crudos del enum no se pintan. */
export const ETIQUETAS_ESTADO: Record<string, string> = {
  pendiente: "Pendiente de pago",
  pagado: "Pagado",
  en_preparacion: "En preparación",
  enviado: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
  reembolsado: "Reembolsado",
};

/**
 * Pedidos de un usuario.
 *
 * NO se buscan además por correo. Un pedido de invitado con el mismo correo
 * podría ser de otra persona: mientras no haya verificación de correo,
 * cruzarlos dejaría que alguien se registre con el correo de un tercero y lea
 * sus pedidos.
 */
export async function listarPedidosDeUsuario(
  idUsuario: string,
): Promise<PedidoResumen[]> {
  const filas = await db
    .select({
      id: orders.id,
      numero: orders.orderNumber,
      estado: orders.status,
      totalCop: orders.totalCop,
      creado: orders.createdAt,
      fechaEntrega: orders.deliveryDate,
      franja: orders.deliverySlot,
      destinatario: orders.recipientName,
    })
    .from(orders)
    .where(eq(orders.userId, idUsuario))
    .orderBy(desc(orders.createdAt))
    .limit(50);

  if (filas.length === 0) return [];

  // Una sola consulta para los artículos de todos los pedidos, en vez de una
  // por pedido: con 50 pedidos eso serían 51 viajes a la base.
  const ids = filas.map((f) => f.id);
  const articulos = await db
    .select({
      pedidoId: orderItems.orderId,
      nombre: orderItems.productName,
      cantidad: orderItems.quantity,
      precioCop: orderItems.unitPriceCop,
    })
    .from(orderItems)
    // Arriba se garantizó que `ids` no está vacío: `inArray` con lista vacía
    // genera SQL inválido.
    .where(inArray(orderItems.orderId, ids));

  const porPedido = new Map<string, PedidoResumen["articulos"]>();
  for (const a of articulos) {
    const lista = porPedido.get(a.pedidoId) ?? [];
    lista.push({ nombre: a.nombre, cantidad: a.cantidad, precioCop: a.precioCop });
    porPedido.set(a.pedidoId, lista);
  }

  return filas.map((f) => ({
    ...f,
    articulos: porPedido.get(f.id) ?? [],
  }));
}
