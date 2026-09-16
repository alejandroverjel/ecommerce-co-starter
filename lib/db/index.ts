import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

import { TIENDA } from "../../tienda.config";
import * as schema from "./schema";

/**
 * ============================================================================
 * Cliente de Drizzle sobre node-postgres
 * ============================================================================
 *
 * El navegador NUNCA toca Postgres. Este modulo solo puede importarse desde
 * codigo de servidor (route handlers, server components, server actions,
 * scripts). Por eso no hay RLS: la autorizacion se hace arriba, en cada
 * handler, filtrando explicitamente por user_id / session_token.
 */

/**
 * Falta DATABASE_URL: se cae, PERO NO AL CONSTRUIR LA IMAGEN.
 *
 * `next build` importa cada modulo de pagina para recolectar su configuracion,
 * y la imagen se construye en GitHub Actions, donde la base vive en la red
 * privada del VPS y no es alcanzable. Un `throw` en el cuerpo del modulo se
 * disparaba en ese import y tumbaba el build entero — antes de que corriera el
 * try/catch que cada pagina ya tiene para degradar sin base (el sitemap y las
 * fichas lo tenian y no servia de nada).
 *
 * En ejecucion la guarda sigue intacta: arrancar el contenedor sin base seria
 * peor, porque el fallo aparecerian mas tarde y disfrazado.
 */
const enConstruccion = process.env.NEXT_PHASE === "phase-production-build";

if (!process.env.DATABASE_URL && !enConstruccion) {
  throw new Error(
    "Falta DATABASE_URL. Ver env.example (postgresql://<usuario>:...@postgres:5432/<base>)",
  );
}

/**
 * Postgres corre en el mismo VPS, en su propia red Docker privada
 * (`<tienda>-privada`): cada tienda tiene su propio contenedor de Postgres,
 * aislado de las demas. La latencia es de microsegundos, asi que un pool
 * chico alcanza y sobra.
 *
 * `max: 10` con el limite de 1 vCPU del contenedor: mas conexiones solo
 * generan contencion frente a `max_connections` (por defecto 100) de ESTE
 * Postgres.
 */
const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PGPOOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  /**
   * Recicla conexiones cada 7500 queries. Evita que una conexion de larga vida
   * acumule planes preparados y memoria en el backend de Postgres.
   */
  maxUses: 7_500,
  /** Sin SSL: el trafico no sale de la red Docker interna. */
  ssl: false,
  application_name: process.env.PG_APPLICATION_NAME ?? `${TIENDA.slug}-next`,
} as const;

/**
 * En desarrollo, el hot reload de Next.js reevalua los modulos en cada cambio.
 * Sin este cache en globalThis se abre un pool nuevo cada vez y a los pocos
 * minutos Postgres responde "too many clients already".
 */
const globalForDb = globalThis as unknown as {
  __dbPool?: Pool;
  __db?: NodePgDatabase<typeof schema>;
};

export const pool: Pool = globalForDb.__dbPool ?? new Pool(poolConfig);

/**
 * Un error en una conexion IDLE del pool es asincrono: si nadie lo escucha,
 * node-postgres lo emite como uncaughtException y tumba el proceso.
 */
pool.on("error", (err) => {
  console.error("[db] error en conexion idle del pool:", err);
});

export const db: NodePgDatabase<typeof schema> =
  globalForDb.__db ?? drizzle({ client: pool, schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__dbPool = pool;
  globalForDb.__db = db;
}

export { schema };
export type Database = typeof db;
/** Tipo del handle dentro de `db.transaction(...)`. Util para firmar helpers. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Cierre ordenado. Llamar solo desde scripts (seed, importador, backup), nunca
 * desde un route handler: el pool es de todo el proceso.
 */
export async function closeDb(): Promise<void> {
  await pool.end();
}

/**
 * Ejecuta una funcion con un cliente crudo de pg tomado del pool.
 * Se necesita para lo poco que Drizzle no cubre: `LISTEN/NOTIFY`, `COPY`, o
 * fijar `statement_timeout` para una operacion puntual.
 */
export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * ============================================================================
 * Como se llaman las funciones plpgsql que se conservaron
 * ============================================================================
 *
 * Se quedan en la base porque resuelven bien el orden de bloqueo (anti-deadlock)
 * y la idempotencia; reescribirlas en TypeScript significaria hacer varios
 * round-trips y perder la atomicidad. Se invocan asi:
 *
 *   import { sql } from "drizzle-orm";
 *   import { db } from "@/lib/db";
 *
 *   // Stock disponible. OJO con el segundo parametro: es el BUG 4 corregido.
 *   // Pasar el session_token del solicitante hace que su propia reserva NO se
 *   // le descuente a si mismo en un reintento de checkout.
 *   const { rows } = await db.execute<{ available_stock: number }>(
 *     sql`select available_stock(${variantId}::uuid, ${sessionToken}::text)`,
 *   );
 *
 *   // Crear pedido pendiente. LAS FIRMAS DE ABAJO SON LAS REALES: estan
 *   // copiadas de drizzle/migrations/0001_funciones.sql. El bloque que habia
 *   // aqui antes inventaba parametros que la funcion nunca tuvo (un cartId, y
 *   // un fulfill_paid_order(paymentEventId)); si algun handler se escribe
 *   // contra esta documentacion en vez de contra el SQL, volvemos a tener dos
 *   // contratos distintos, que es exactamente lo que rompio este proyecto.
 *   //
 *   // El orden importa: son parametros POSICIONALES.
 *   const { rows } = await db.execute<{
 *     order_id: string; order_number: string; total_cop: number;
 *   }>(
 *     sql`select * from create_pending_order(
 *           ${email}::text,
 *           ${JSON.stringify(items)}::jsonb,          -- [{product_id, quantity}]
 *           ${JSON.stringify(shippingAddress)}::jsonb,
 *           ${sessionToken}::text,
 *           ${userId}::uuid,                          -- null = invitado
 *           ${paymentMethod}::text,
 *           ${couponCode}::text
 *         )`,
 *   );
 *
 *   // Webhook de la pasarela. Idempotente por (gateway, external_id) del
 *   // EVENTO, y marca processed_at AL FINAL, no al principio (BUG 5).
 *   // OJO: son DOS ids distintos. Wompi manda varios eventos por transaccion.
 *   const { rows } = await db.execute<{
 *     order_id: string; new_status: string;
 *     already_processed: boolean; needs_review: boolean; review_reason: string | null;
 *   }>(
 *     sql`select * from fulfill_paid_order(
 *           ${gateway}::payment_gateway,
 *           ${eventId}::text,          -- id del EVENTO       -> payment_events
 *           ${transactionId}::text,    -- id de la TRANSACCION -> payments
 *           ${orderNumber}::text,
 *           ${status}::payment_status,
 *           ${amountCop}::integer,
 *           ${JSON.stringify(payload)}::jsonb,
 *           ${eventType}::text
 *         )`,
 *   );
 *   // needs_review = true -> el pago SE REGISTRO pero NO se aplico al pedido
 *   // (pedido cancelado, monto descuadrado...). Responder 200 a la pasarela
 *   // igual (el evento se recibio) y ALERTAR a operaciones con review_reason.
 *   // Los casos pendientes se listan con:
 *   //   select * from payment_events where last_error is not null;
 *
 * `db.execute` devuelve el QueryResult de node-postgres: los datos estan en
 * `.rows`, no en el valor de retorno directo.
 *
 * Para que estas llamadas participen de una transaccion de Drizzle hay que
 * usar el handle de la transaccion, no `db`:
 *   await db.transaction(async (tx) => {
 *     await tx.execute(sql`select release_reservations(${sessionToken}::text)`);
 *     await tx.update(orders).set({ status: "cancelado" }).where(...);
 *   });
 */
