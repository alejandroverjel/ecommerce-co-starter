import { timestamp } from "drizzle-orm/pg-core";

/**
 * Columnas de auditoria compartidas.
 *
 * `withTimezone: true` siempre: el negocio opera en America/Bogota pero la base
 * guarda en UTC. `timestamp` sin timezone es el error clasico que rompe los
 * cortes de dia cuando el server corre en otra zona.
 *
 * `$onUpdate` es el equivalente en la capa de Drizzle al trigger
 * `set_updated_at()`. Se conservan LOS DOS a proposito:
 *   - `$onUpdate` cubre los UPDATE que salen de Drizzle.
 *   - el trigger SQL cubre los UPDATE que hacen las funciones plpgsql
 *     (fulfill_paid_order, release_reservations, ...) y cualquier `psql` manual.
 * Si solo dejaras `$onUpdate`, updated_at mentiria cada vez que la pasarela
 * confirma un pago, porque ese camino no pasa por Drizzle.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const createdAtOnly = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
};

/**
 * Snapshot de direccion que se congela dentro de orders.shipping_address.
 * Es jsonb y no un FK a addresses a proposito: si el cliente edita o borra su
 * direccion despues, el pedido historico no puede cambiar.
 */
export type ShippingAddressSnapshot = {
  recipientName: string;
  recipientPhone: string;
  departamento: string;
  ciudad: string;
  line1: string;
  line2?: string | null;
  notes?: string | null;
};
