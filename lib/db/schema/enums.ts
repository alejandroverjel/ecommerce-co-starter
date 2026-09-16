import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Enums de Postgres. Son la UNICA fuente de verdad de estos valores.
 *
 * BUG 8 CORREGIDO: en el starter original `UserRole` se escribia a mano en
 * TypeScript y ya habia perdido 'staff'. Aca los tipos de TS se DERIVAN del
 * pgEnum (`enumValues`), asi que es imposible que diverjan: si agregas un
 * valor al enum, el tipo de TS cambia solo y el compilador te muestra los
 * switch/match que quedaron incompletos.
 */

export const userRole = pgEnum("user_role", ["admin", "staff", "cliente"]);

export const productStatus = pgEnum("product_status", [
  "borrador",
  "activo",
  "archivado",
]);

export const orderStatus = pgEnum("order_status", [
  "pendiente",
  "pagado",
  "en_preparacion",
  "enviado",
  "entregado",
  "cancelado",
  "reembolsado",
]);

/**
 * 'manual' NO es una pasarela: es la plata que entra por fuera de una —
 * efectivo del contra entrega, una transferencia, un Nequi. Existe para que
 * esos cobros vivan en `payments` como cualquier otro y la suma de cobros
 * cuadre con la suma de pedidos pagados. Ver drizzle/migrations/0005_pago_manual.sql.
 */
export const paymentGateway = pgEnum("payment_gateway", [
  "wompi",
  "epayco",
  "mercadopago",
  "manual",
]);

export const paymentStatus = pgEnum("payment_status", [
  "pendiente",
  "aprobado",
  "rechazado",
  "reembolsado",
]);

export const couponType = pgEnum("coupon_type", [
  "porcentaje",
  "monto_fijo",
  "envio_gratis",
]);

export const couponScope = pgEnum("coupon_scope", [
  "orden",
  "categoria",
  "producto",
]);

export const reviewStatus = pgEnum("review_status", [
  "pendiente",
  "aprobada",
  "rechazada",
]);

// --- Tipos derivados (nunca escribir estas uniones a mano) --------------------

export type UserRole = (typeof userRole.enumValues)[number];
export type ProductStatus = (typeof productStatus.enumValues)[number];
export type OrderStatus = (typeof orderStatus.enumValues)[number];
export type PaymentGateway = (typeof paymentGateway.enumValues)[number];
export type PaymentStatus = (typeof paymentStatus.enumValues)[number];
export type CouponType = (typeof couponType.enumValues)[number];
export type CouponScope = (typeof couponScope.enumValues)[number];
export type ReviewStatus = (typeof reviewStatus.enumValues)[number];

/**
 * Estados de pedido que ya consumieron inventario de verdad. Util para la capa
 * de aplicacion; se deriva del enum, no se duplica.
 */
export const ESTADOS_CONSUMEN_STOCK = [
  "pagado",
  "en_preparacion",
  "enviado",
  "entregado",
] as const satisfies readonly OrderStatus[];
