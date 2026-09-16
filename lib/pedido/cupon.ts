"use server";

import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { coupons, couponRedemptions, orders } from "@/lib/db/schema";

/**
 * Previsualización de un cupón para el checkout.
 *
 * Deja ver el descuento ANTES de pagar, en vez de descubrir en el último clic
 * que el código no servía. Pero NO es la autoridad: el total real lo fija
 * `create_pending_order` en Postgres al crear el pedido, dentro de la misma
 * transacción que bloquea el cupón `for update` (esta previsualización no
 * puede, dos personas podrían estar gastando el último uso a la vez).
 *
 * Por eso solo calcula la cifra exacta para los cupones de alcance `orden`
 * —los de marketing típicos, como BIENVENIDA10—, que es sobre el subtotal
 * entero. Para los de categoría o producto valida que el cupón exista y esté
 * vigente, pero deja el monto al servidor: calcularlo aquí obligaría a
 * duplicar la lógica de qué líneas hacen match, y esa duplicación es
 * justamente lo que rompe estos proyectos.
 *
 * El límite POR USUARIO tampoco se comprueba aquí (el invitado no tiene id
 * hasta el checkout); lo valida el servidor.
 */

export type PrevisualizacionCupon =
  | { ok: false; error: string }
  | {
      ok: true;
      codigo: string;
      /** Descuento en COP, o null si depende de qué líneas lleva (scope categoría/producto). */
      descuentoCop: number | null;
      envioGratis: boolean;
      /** Aviso para el cliente cuando el monto exacto se resuelve al confirmar. */
      nota?: string;
    };

export async function previsualizarCupon(
  codigo: string,
  subtotalCop: number,
): Promise<PrevisualizacionCupon> {
  const limpio = codigo.trim();
  if (!limpio) return { ok: false, error: "Escribe un código." };
  if (!Number.isInteger(subtotalCop) || subtotalCop <= 0) {
    return { ok: false, error: "Agrega productos antes de aplicar un cupón." };
  }

  const [cupon] = await db
    .select()
    .from(coupons)
    .where(sql`upper(${coupons.code}) = upper(${limpio})`)
    .limit(1);

  if (!cupon) return { ok: false, error: `El cupón "${limpio}" no existe.` };
  if (!cupon.isActive) return { ok: false, error: "Ese cupón está desactivado." };

  const ahora = new Date();
  if (cupon.startsAt && cupon.startsAt > ahora) {
    return { ok: false, error: "Ese cupón todavía no está vigente." };
  }
  if (cupon.endsAt && cupon.endsAt <= ahora) {
    return { ok: false, error: "Ese cupón ya venció." };
  }
  if (cupon.minSubtotalCop > subtotalCop) {
    return {
      ok: false,
      error: `Este cupón aplica desde ${formatearCop(cupon.minSubtotalCop)} en productos.`,
    };
  }

  // Tope global de usos: se cuentan las redenciones de pedidos no cancelados,
  // igual que la función de la base (no el contador denormalizado).
  if (cupon.usageLimit != null) {
    const [{ usados }] = await db
      .select({ usados: sql<number>`count(*)::int` })
      .from(couponRedemptions)
      .innerJoin(orders, eq(orders.id, couponRedemptions.orderId))
      .where(and(eq(couponRedemptions.couponId, cupon.id), ne(orders.status, "cancelado")));

    if (usados >= cupon.usageLimit) {
      return { ok: false, error: "Ese cupón ya agotó sus usos." };
    }
  }

  if (cupon.type === "envio_gratis") {
    return { ok: true, codigo: cupon.code, descuentoCop: 0, envioGratis: true };
  }

  // Categoría o producto: válido, pero el monto depende de las líneas.
  if (cupon.scope !== "orden") {
    return {
      ok: true,
      codigo: cupon.code,
      descuentoCop: null,
      envioGratis: false,
      nota: "El descuento se aplica a los productos que califican, al confirmar.",
    };
  }

  let descuento =
    cupon.type === "porcentaje"
      ? Math.round((subtotalCop * cupon.value) / 10000)
      : Math.min(cupon.value, subtotalCop);

  if (cupon.maxDiscountCop != null) descuento = Math.min(descuento, cupon.maxDiscountCop);
  descuento = Math.max(0, Math.min(descuento, subtotalCop));

  return { ok: true, codigo: cupon.code, descuentoCop: descuento, envioGratis: false };
}

/** COP entero → "$ 120.000", sin arrastrar el módulo de formato del cliente. */
function formatearCop(pesos: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(pesos);
}
