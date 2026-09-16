import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

import { timestamps } from "./_shared";
import { paymentGateway } from "./enums";

/**
 * ============================================================================
 * store_settings — fila unica (singleton)
 * ============================================================================
 *
 * COMO SE GARANTIZA QUE EXISTE COMO MUCHO UNA FILA
 * -------------------------------------------------
 * `id boolean PRIMARY KEY DEFAULT true` + `CHECK (id)`:
 *   - PRIMARY KEY implica NOT NULL  -> `id` no puede ser NULL.
 *   - CHECK (id)                    -> `id` no puede ser false.
 *   - PRIMARY KEY implica UNIQUE    -> solo puede existir un `true`.
 * El dominio efectivo de la columna queda reducido a {true}, y la unicidad del
 * PK lo convierte en un singleton ESTRUCTURAL. No hay trigger, ni regla de
 * negocio, ni "confia en que la app no inserte dos veces".
 *
 * Escritura idempotente:
 *   insert into store_settings (id, flat_shipping_cop, ...)
 *   values (true, 12000, ...)
 *   on conflict (id) do update set flat_shipping_cop = excluded.flat_shipping_cop, ...
 *
 * Lectura: `where id = true` (o `limit 1`, da igual: no puede haber otra).
 *
 * ----------------------------------------------------------------------------
 * BUG 1 CORREGIDO — envio con dos fuentes de verdad
 * ----------------------------------------------------------------------------
 * El original tenia FLAT_SHIPPING_COP=12000 y FREE_SHIPPING_THRESHOLD_COP=150000
 * hardcodeados en el frontend, mientras `create_pending_order` los leia de esta
 * tabla... que estaba VACIA porque el seed.sql que dos documentos referenciaban
 * nunca se creo. El `coalesce(v_flat, 0)` devolvia 0: el servidor grababa envio
 * $0 contra una interfaz que mostraba $12.000.
 *
 * Tres defensas ahora:
 *   a) las columnas son NOT NULL con DEFAULT correcto, asi que ni un
 *      `insert into store_settings (id) values (true)` puede dejarlas vacias;
 *   b) el seed (lib/db/seed.ts) es obligatorio y corre en cada deploy;
 *   c) el frontend deja de tener constantes y lee estos valores del servidor.
 * El `coalesce(..., 0)` del plpgsql debe borrarse: si la fila falta, queremos
 * que explote, no que cobre envio gratis en silencio.
 *
 * ----------------------------------------------------------------------------
 * BUG 7 CORREGIDO — TTL de reserva duplicado
 * ----------------------------------------------------------------------------
 * Estaba como RESERVATION_TTL_MINUTES=15 en TypeScript Y como
 * `interval '15 minutes'` literal dentro del plpgsql. Ahora vive SOLO en
 * `reservation_ttl_minutes`; el SQL lo lee de aca:
 *   now() + (select reservation_ttl_minutes from store_settings) * interval '1 minute'
 * y el front lo recibe del servidor para pintar el contador.
 */
export const storeSettings = pgTable(
  "store_settings",
  {
    id: boolean("id").primaryKey().default(true),

    storeName: text("store_name").notNull().default("Mi tienda"),
    contactEmail: text("contact_email")
      .notNull()
      .default("hola@example.com"),
    contactPhone: text("contact_phone"),
    whatsappNumber: text("whatsapp_number").notNull().default(""),

    /** Tarifa plana de envio, en pesos ENTEROS. */
    flatShippingCop: integer("flat_shipping_cop").notNull().default(10_000),

    /** Subtotal (ya con descuento aplicado) a partir del cual el envio es gratis. */
    freeShippingThresholdCop: integer("free_shipping_threshold_cop")
      .notNull()
      .default(200_000),

    /**
     * IVA en PUNTOS BASICOS: 1900 = 19%. Entero, nunca decimal ni float.
     *
     * CONVENCION COLOMBIANA: el IVA ya viene INCLUIDO en `price_cop`. Este valor
     * sirve UNICAMENTE para desglosarlo en la factura:
     *   base = round(total * 10000.0 / (10000 + tax_rate_bps))
     *   iva  = total - base
     * Jamas se suma encima del precio mostrado.
     */
    taxRateBps: integer("tax_rate_bps").notNull().default(1900),

    /** Fuente UNICA del TTL de las reservas de inventario. Ver BUG 7 arriba. */
    reservationTtlMinutes: integer("reservation_ttl_minutes")
      .notNull()
      .default(15),

    currency: text("currency").notNull().default("COP"),

    ...timestamps,
  },
  (t) => [
    check("store_settings_singleton_ck", sql`${t.id}`),
    check("store_settings_flat_shipping_ck", sql`${t.flatShippingCop} >= 0`),
    check(
      "store_settings_free_threshold_ck",
      sql`${t.freeShippingThresholdCop} >= 0`,
    ),
    check(
      "store_settings_tax_rate_ck",
      sql`${t.taxRateBps} >= 0 and ${t.taxRateBps} <= 10000`,
    ),
    check("store_settings_ttl_ck", sql`${t.reservationTtlMinutes} > 0`),
  ],
);

/**
 * payment_gateways — configuracion por pasarela.
 *
 * El PRIMARY KEY *es* el enum `payment_gateway`. Eso hace imposible tener dos
 * filas para 'wompi' o una fila 'wompy' mal escrita, sin necesidad de un
 * unique index adicional.
 *
 * Los SECRETOS no van en variables de entorno: viven CIFRADOS dentro de
 * `config.secretos`. El resto de `config` guarda datos publicos: URL de
 * redireccion, moneda aceptada, cuotas, etc.
 */
export const paymentGateways = pgTable("payment_gateways", {
  gateway: paymentGateway("gateway").primaryKey(),
  displayName: text("display_name").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  isSandbox: boolean("is_sandbox").notNull().default(true),
  /** Llave PUBLICA de la pasarela; la privada nunca toca la base. */
  publicKey: text("public_key"),
  config: jsonb("config").$type<Record<string, unknown>>(),
  position: integer("position").notNull().default(0),
  ...timestamps,
});

export type StoreSettings = InferSelectModel<typeof storeSettings>;
export type NewStoreSettings = InferInsertModel<typeof storeSettings>;
export type PaymentGatewayConfig = InferSelectModel<typeof paymentGateways>;
export type NewPaymentGatewayConfig = InferInsertModel<typeof paymentGateways>;
