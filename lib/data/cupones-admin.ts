import "server-only";

import { desc, eq, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { coupons, couponRedemptions, orders } from "@/lib/db/schema";

/**
 * Consultas de cupones para el panel.
 *
 * SIN RLS: la autorización es de quien llama. Las páginas pasan por
 * `exigirAdminPagina` (los cupones mueven dinero) y las escrituras por
 * `exigirAdmin`.
 */

export type CuponAdmin = {
  id: string;
  code: string;
  tipo: string;
  scope: string;
  value: number;
  activa: boolean;
  /** Usos reales: redenciones de pedidos no cancelados. */
  usos: number;
  usageLimit: number | null;
  minSubtotalCop: number;
  inicio: Date | null;
  fin: Date | null;
  /** Resuelto contra ahora: vigente / programado / vencido / apagado. */
  estado: "vigente" | "programado" | "vencido" | "apagado";
};

function estadoCupon(
  activa: boolean,
  inicio: Date | null,
  fin: Date | null,
): CuponAdmin["estado"] {
  if (!activa) return "apagado";
  const ahora = new Date();
  if (inicio && inicio > ahora) return "programado";
  if (fin && fin <= ahora) return "vencido";
  return "vigente";
}

export async function listarCupones(): Promise<CuponAdmin[]> {
  // Usos reales por cupón (pedidos no cancelados), en una sola consulta.
  const usosPorCupon = db
    .select({
      couponId: couponRedemptions.couponId,
      usos: sql<number>`count(*)::int`.as("usos"),
    })
    .from(couponRedemptions)
    .innerJoin(orders, eq(orders.id, couponRedemptions.orderId))
    .where(ne(orders.status, "cancelado"))
    .groupBy(couponRedemptions.couponId)
    .as("usos_por_cupon");

  const filas = await db
    .select({
      id: coupons.id,
      code: coupons.code,
      tipo: coupons.type,
      scope: coupons.scope,
      value: coupons.value,
      activa: coupons.isActive,
      usos: sql<number>`coalesce(${usosPorCupon.usos}, 0)`,
      usageLimit: coupons.usageLimit,
      minSubtotalCop: coupons.minSubtotalCop,
      inicio: coupons.startsAt,
      fin: coupons.endsAt,
    })
    .from(coupons)
    .leftJoin(usosPorCupon, eq(usosPorCupon.couponId, coupons.id))
    .orderBy(desc(coupons.createdAt));

  return filas.map((f) => ({
    ...f,
    estado: estadoCupon(f.activa, f.inicio, f.fin),
  }));
}

export type FichaCuponAdmin = {
  id: string;
  code: string;
  description: string | null;
  type: string;
  scope: string;
  value: number;
  minSubtotalCop: number;
  maxDiscountCop: number | null;
  usageLimit: number | null;
  usageLimitPerUser: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  usos: number;
};

export async function leerCuponAdmin(id: string): Promise<FichaCuponAdmin | null> {
  const [fila] = await db.select().from(coupons).where(eq(coupons.id, id)).limit(1);
  if (!fila) return null;

  const [{ usos }] = await db
    .select({ usos: sql<number>`count(*)::int` })
    .from(couponRedemptions)
    .innerJoin(orders, eq(orders.id, couponRedemptions.orderId))
    .where(sql`${couponRedemptions.couponId} = ${id} and ${orders.status} <> 'cancelado'`);

  return {
    id: fila.id,
    code: fila.code,
    description: fila.description,
    type: fila.type,
    scope: fila.scope,
    value: fila.value,
    minSubtotalCop: fila.minSubtotalCop,
    maxDiscountCop: fila.maxDiscountCop,
    usageLimit: fila.usageLimit,
    usageLimitPerUser: fila.usageLimitPerUser,
    startsAt: fila.startsAt,
    endsAt: fila.endsAt,
    isActive: fila.isActive,
    usos: usos ?? 0,
  };
}
