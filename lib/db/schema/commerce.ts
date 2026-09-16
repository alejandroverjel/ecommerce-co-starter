import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAtOnly, timestamps, type ShippingAddressSnapshot } from "./_shared";
import {
  couponScope,
  couponType,
  orderStatus,
  paymentGateway,
  paymentStatus,
} from "./enums";
import { users } from "./auth";
import { categories, productVariants, products } from "./catalog";

/**
 * ============================================================================
 * carts / cart_items
 * ============================================================================
 *
 * Un carrito pertenece a un usuario logueado O a una cookie de invitado, nunca
 * a ninguno de los dos. El CHECK lo obliga; el original dejaba crear carritos
 * huerfanos imposibles de recuperar.
 */
export const carts = pgTable(
  "carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** Token opaco guardado en cookie httpOnly para invitados. */
    sessionToken: text("session_token"),
    ...timestamps,
  },
  (t) => [
    check(
      "carts_owner_ck",
      sql`${t.userId} is not null or ${t.sessionToken} is not null`,
    ),
    /** Un carrito activo por usuario y uno por cookie. Indices parciales. */
    uniqueIndex("carts_user_uq")
      .on(t.userId)
      .where(sql`${t.userId} is not null`),
    uniqueIndex("carts_session_token_uq")
      .on(t.sessionToken)
      .where(sql`${t.sessionToken} is not null`),
  ],
);

/**
 * cart_items apunta a la VARIANTE, no al producto: el precio y el stock viven
 * ahi. `product_id` no se guarda porque se deriva por join y duplicarlo abre la
 * puerta a que apunten a productos distintos.
 */
export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    /** Agregar dos veces la misma variante suma cantidad, no crea otra fila. */
    uniqueIndex("cart_items_cart_variant_uq").on(t.cartId, t.variantId),
    index("cart_items_cart_id_idx").on(t.cartId),
    check("cart_items_quantity_ck", sql`${t.quantity} > 0`),
  ],
);

/**
 * ============================================================================
 * coupons
 * ============================================================================
 *
 * BUG 3 (los cupones nunca se aplicaban porque `discount_cop` estaba fijo en 0
 * en el INSERT de create_pending_order) se corrige en dos frentes: aca estan
 * las columnas necesarias para CALCULAR el descuento, y en `orders` estan
 * `coupon_id`, `coupon_code` y `discount_cop` con un CHECK de cuadre que hace
 * imposible grabar un total que no corresponda al descuento aplicado.
 *
 * Semantica de `value` segun `type`:
 *   porcentaje   -> puntos basicos (1000 = 10%). Entero, coherente con tax_rate_bps.
 *   monto_fijo   -> pesos enteros COP a restar.
 *   envio_gratis -> se ignora; lo concedido es el costo del envio.
 *
 * DONDE SE VE CADA COSA (una sola verdad, ver couponRedemptions.amountCop):
 *   orders.discount_cop            -> descuento sobre PRODUCTOS. Para
 *                                     'envio_gratis' es 0, porque lo concedido
 *                                     no es un descuento: es shipping_cop = 0.
 *   coupon_redemptions.amount_cop  -> lo que el cupon le costo a la tienda:
 *                                     discount_cop + envio perdonado.
 */
export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    description: text("description"),

    type: couponType("type").notNull(),
    scope: couponScope("scope").notNull().default("orden"),
    value: integer("value").notNull().default(0),

    /** Subtotal minimo para que aplique. */
    minSubtotalCop: integer("min_subtotal_cop").notNull().default(0),
    /** Tope de descuento para los de porcentaje. Null = sin tope. */
    maxDiscountCop: integer("max_discount_cop"),

    /** Null = ilimitado. */
    usageLimit: integer("usage_limit"),
    usageLimitPerUser: integer("usage_limit_per_user"),
    /** Contador denormalizado; la verdad esta en coupon_redemptions. */
    timesRedeemed: integer("times_redeemed").notNull().default(0),

    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
    isActive: boolean("is_active").notNull().default(true),

    ...timestamps,
  },
  (t) => [
    /** Codigos case-insensitive: el cliente escribe "navidad" y "NAVIDAD". */
    uniqueIndex("coupons_code_upper_uq").on(sql`upper(${t.code})`),
    index("coupons_active_idx")
      .on(t.isActive, t.endsAt)
      .where(sql`${t.isActive}`),
    check("coupons_value_ck", sql`${t.value} >= 0`),
    /** Si es porcentaje, `value` esta en bps y no puede pasar del 100%. */
    check(
      "coupons_percent_range_ck",
      sql`${t.type} <> 'porcentaje' or ${t.value} <= 10000`,
    ),
    check("coupons_min_subtotal_ck", sql`${t.minSubtotalCop} >= 0`),
    check(
      "coupons_window_ck",
      sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.startsAt} < ${t.endsAt}`,
    ),
  ],
);

/** Restriccion por categoria cuando scope = 'categoria'. PK compuesto, sin id sobrante. */
export const couponCategories = pgTable(
  "coupon_categories",
  {
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.couponId, t.categoryId] }),
    index("coupon_categories_category_id_idx").on(t.categoryId),
  ],
);

/** Restriccion por producto cuando scope = 'producto'. */
export const couponProducts = pgTable(
  "coupon_products",
  {
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.couponId, t.productId] }),
    index("coupon_products_product_id_idx").on(t.productId),
  ],
);

/**
 * ============================================================================
 * order_number_seq + orders
 * ============================================================================
 *
 * La secuencia arranca en 1000 para que el primer pedido no sea "ORD-000001" y
 * se note que la tienda es nueva. Se declara con `pgSequence` para que
 * drizzle-kit la incluya en la migracion (si solo estuviera dentro del DEFAULT
 * como texto, la migracion generaria un DEFAULT que referencia una secuencia
 * inexistente).
 *
 * Nota operativa: al importar un historico de pedidos previo, avanzar la
 * secuencia con `select setval('order_number_seq', <ultimo_numero>)` para no
 * colisionar.
 */
export const orderNumberSeq = pgSequence("order_number_seq", {
  startWith: 1000,
  increment: 1,
});

/**
 * orders
 *
 * `userId` es NULLABLE a proposito: se puede comprar como invitado. Por eso
 * `email` es NOT NULL — es el unico identificador garantizado del comprador y
 * el canal por donde llega la confirmacion.
 *
 * `shippingAddress` es un SNAPSHOT jsonb, no un FK a `addresses`: si el cliente
 * edita o borra su direccion en marzo, el pedido de enero tiene que seguir
 * mostrando a donde se despacho de verdad.
 *
 * BUG 2 CORREGIDO: `create_pending_order` recibia `p_payment_method` y lo
 * botaba porque no habia donde guardarlo. Ahora existe `payment_method` y la
 * funcion lo persiste. Es el metodo que ELIGIO el cliente (tarjeta, pse,
 * nequi, contra_entrega); la transaccion real y su pasarela viven en `payments`.
 *
 * BUG 3 CORREGIDO: `discount_cop`, `coupon_id` y `coupon_code` existen y el
 * CHECK `orders_total_ck` obliga a que
 *   total_cop = subtotal_cop - discount_cop + shipping_cop
 * siempre. Si create_pending_order vuelve a insertar `discount_cop = 0` con un
 * cupon aplicado, el INSERT falla en vez de cobrar de mas en silencio.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** ORD-001000, ORD-001001, ... generado por la base, no por la app. */
    orderNumber: text("order_number")
      .notNull()
      .default(sql`'ORD-' || lpad(nextval('order_number_seq')::text, 6, '0')`),

    /** Null = compra como invitado. `set null` conserva el pedido si borran la cuenta. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),

    email: text("email").notNull(),
    phone: text("phone"),
    customerName: text("customer_name"),

    status: orderStatus("status").notNull().default("pendiente"),

    // --- Dinero. Todo integer COP, IVA incluido en los precios unitarios. ----
    subtotalCop: integer("subtotal_cop").notNull(),
    discountCop: integer("discount_cop").notNull().default(0),
    shippingCop: integer("shipping_cop").notNull().default(0),
    totalCop: integer("total_cop").notNull(),
    /**
     * IVA ya contenido en `total_cop`, calculado al momento de la compra y
     * congelado. Se guarda y no se recalcula porque la tarifa puede cambiar y
     * la factura vieja tiene que seguir cuadrando.
     */
    taxIncludedCop: integer("tax_included_cop").notNull().default(0),

    // --- Cupon (BUG 3) -------------------------------------------------------
    couponId: uuid("coupon_id").references(() => coupons.id, {
      onDelete: "set null",
    }),
    /** Snapshot del codigo: el cupon puede borrarse o renombrarse despues. */
    couponCode: text("coupon_code"),

    // --- Pago (BUG 2) --------------------------------------------------------
    paymentMethod: text("payment_method"),

    // --- Envio ---------------------------------------------------------------
    shippingAddress: jsonb("shipping_address").$type<ShippingAddressSnapshot>(),
    /** Indicaciones para el mensajero: portería, apartamento, referencias. */
    notes: text("notes"),

    // --- Regalo (migracion 0003) ---------------------------------------------
    /**
     * Cuando checkout.destinatarioDistinto esta activo, quien paga puede no
     * ser quien recibe.
     *
     * Son columnas y no campos dentro de `shippingAddress` porque se consultan
     * a diario ("imprimir las tarjetas de hoy", "que entregas hay en la
     * manana"). Dentro de un jsonb esas consultas escanean la tabla entera.
     */

    /** Mensaje que se escribe a mano en la tarjeta que acompana el pedido. */
    giftMessage: text("gift_message"),
    /** Quien recibe. Puede ser distinto de `customerName`. */
    recipientName: text("recipient_name"),
    /** A quien llama el mensajero al llegar. */
    recipientPhone: text("recipient_phone"),
    /** Fecha acordada, en zona horaria America/Bogota. */
    deliveryDate: date("delivery_date"),
    /**
     * Franja de entrega: manana | tarde | noche.
     *
     * Texto con CHECK en vez de enum: las franjas cambian segun la operacion
     * (temporada alta, dia de la madre) y alterar un enum exige migracion,
     * mientras que ajustar un CHECK es una sola sentencia.
     */
    deliverySlot: text("delivery_slot"),

    /**
     * Token de la sesion de checkout. Ata el pedido a sus
     * `inventory_reservations` y es la llave de idempotencia para reintentos
     * del cliente (ver BUG 4).
     */
    checkoutSessionToken: text("checkout_session_token"),

    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),

    /**
     * Cuando se descontó el inventario de este pedido (migracion 0004). Marca
     * unica e irreversible: el descuento nunca se repite aunque el pedido se
     * reabra o lleguen mas eventos del webhook de la pasarela.
     */
    stockDescontadoAt: timestamp("stock_descontado_at", {
      withTimezone: true,
      mode: "date",
    }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_order_number_uq").on(t.orderNumber),
    index("orders_user_id_idx").on(t.userId),
    index("orders_email_idx").on(sql`lower(${t.email})`),
    index("orders_status_created_at_idx").on(t.status, t.createdAt),
    /**
     * Un pedido por sesion de checkout. Convierte el reintento del cliente en
     * un `on conflict do nothing` en vez de un pedido duplicado.
     */
    uniqueIndex("orders_checkout_session_uq")
      .on(t.checkoutSessionToken)
      .where(sql`${t.checkoutSessionToken} is not null`),

    /**
     * Indice para la vista de operacion: "que hay que entregar hoy". Parcial
     * sobre los pedidos que siguen vivos: los cancelados y entregados no se
     * consultan por fecha y solo harian crecer el indice. Copiado literal de
     * 0003_regalo.sql para que db:generate deje de ver deriva.
     */
    index("orders_delivery_date_idx")
      .on(t.deliveryDate, t.deliverySlot)
      .where(
        sql`${t.deliveryDate} is not null and ${t.status} in ('pagado', 'en_preparacion', 'enviado')`,
      ),

    check("orders_subtotal_ck", sql`${t.subtotalCop} >= 0`),
    check("orders_discount_ck", sql`${t.discountCop} >= 0`),
    check("orders_shipping_ck", sql`${t.shippingCop} >= 0`),
    check("orders_discount_lte_subtotal_ck", sql`${t.discountCop} <= ${t.subtotalCop}`),
    /** El cuadre. Esta linea es la que hace imposible reintroducir el BUG 3. */
    check(
      "orders_total_ck",
      sql`${t.totalCop} = ${t.subtotalCop} - ${t.discountCop} + ${t.shippingCop}`,
    ),
    check(
      "orders_tax_ck",
      sql`${t.taxIncludedCop} >= 0 and ${t.taxIncludedCop} <= ${t.totalCop}`,
    ),
    /** Si hay cupon aplicado tiene que haber codigo guardado, y al reves. */
    check(
      "orders_coupon_coherence_ck",
      sql`(${t.couponId} is null) = (${t.couponCode} is null)`,
    ),
    /** 'pagado' implica fecha de pago. */
    check(
      "orders_paid_at_ck",
      sql`${t.status} not in ('pagado','en_preparacion','enviado','entregado') or ${t.paidAt} is not null`,
    ),
    /**
     * Franjas de entrega (migracion 0003). Texto con CHECK en vez de enum:
     * las franjas cambian segun la operacion y alterar un enum en Postgres
     * exige migracion, mientras que ajustar un CHECK es una sola sentencia.
     * Copiado literal de 0003_regalo.sql.
     */
    check(
      "orders_delivery_slot_ck",
      sql`${t.deliverySlot} is null or ${t.deliverySlot} in ('manana', 'tarde', 'noche')`,
    ),
    /**
     * Coherencia: si hay fecha debe haber franja, y al reves. Copiado literal
     * de 0003_regalo.sql.
     */
    check(
      "orders_delivery_coherence_ck",
      sql`(${t.deliveryDate} is null and ${t.deliverySlot} is null) or (${t.deliveryDate} is not null and ${t.deliverySlot} is not null)`,
    ),
  ],
);

/**
 * order_items — todo es SNAPSHOT.
 *
 * `product_name`, `variant_name`, `sku` y `unit_price_cop` se congelan al
 * comprar. Los FK a producto y variante son `set null` y solo sirven para
 * enlazar "volver a comprar": si el producto se borra, la linea del pedido
 * historico sigue siendo legible.
 *
 * `line_total_cop` es una columna GENERADA por Postgres. No se puede insertar
 * un total de linea que no sea precio * cantidad, ni siquiera desde psql.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),

    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),

    productName: text("product_name").notNull(),
    variantName: text("variant_name").notNull(),
    sku: text("sku"),

    /** Precio unitario con IVA incluido, congelado al momento de la compra. */
    unitPriceCop: integer("unit_price_cop").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalCop: integer("line_total_cop").generatedAlwaysAs(
      sql`unit_price_cop * quantity`,
    ),

    ...createdAtOnly,
  },
  (t) => [
    index("order_items_order_id_idx").on(t.orderId),
    index("order_items_variant_id_idx").on(t.variantId),
    check("order_items_quantity_ck", sql`${t.quantity} > 0`),
    check("order_items_unit_price_ck", sql`${t.unitPriceCop} >= 0`),
  ],
);

/**
 * coupon_redemptions — canjes efectivos.
 * Es la fuente de verdad de "cuantas veces se uso este cupon";
 * `coupons.times_redeemed` es solo un contador denormalizado para listados.
 */
export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * Lo que el cupon le costo a la tienda en este pedido, en pesos enteros:
     *
     *     amount_cop = orders.discount_cop + envio perdonado por el cupon
     *
     * Para 'porcentaje' y 'monto_fijo' el segundo sumando es 0 y esto es
     * exactamente orders.discount_cop. Para 'envio_gratis' el primero es 0 y
     * esto vale el envio que se dejo de cobrar (0 si el pedido ya superaba el
     * umbral de envio gratis: ahi el cupon no concedio nada).
     *
     * UNA SOLA VERDAD: el schema decia esto y create_pending_order grababa 0
     * para 'envio_gratis'. Manda esta definicion, y la funcion la implementa.
     */
    amountCop: integer("amount_cop").notNull(),
    ...createdAtOnly,
  },
  (t) => [
    /** Un cupon se canjea una sola vez por pedido. */
    uniqueIndex("coupon_redemptions_coupon_order_uq").on(t.couponId, t.orderId),
    index("coupon_redemptions_user_idx").on(t.userId, t.couponId),
    check("coupon_redemptions_amount_ck", sql`${t.amountCop} >= 0`),
  ],
);

/**
 * ============================================================================
 * payments
 * ============================================================================
 * Una fila por INTENTO de cobro. Un pedido puede tener varios (rechazado,
 * reintento, aprobado) y por eso el estado del pedido no se deriva de una sola.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),

    gateway: paymentGateway("gateway").notNull(),
    status: paymentStatus("status").notNull().default("pendiente"),

    amountCop: integer("amount_cop").notNull(),
    currency: text("currency").notNull().default("COP"),

    /** ID de la transaccion en la pasarela (Wompi / Mercado Pago). */
    externalId: text("external_id"),
    /** Referencia que NOSOTROS enviamos a la pasarela (normalmente order_number). */
    externalReference: text("external_reference"),
    /** Respuesta cruda, para poder auditar una disputa meses despues. */
    rawResponse: jsonb("raw_response").$type<Record<string, unknown>>(),

    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),

    ...timestamps,
  },
  (t) => [
    index("payments_order_id_idx").on(t.orderId),
    /** Un transaction id de la pasarela no puede aparecer dos veces. */
    uniqueIndex("payments_gateway_external_id_uq")
      .on(t.gateway, t.externalId)
      .where(sql`${t.externalId} is not null`),
    check("payments_amount_ck", sql`${t.amountCop} > 0`),
    check(
      "payments_paid_at_ck",
      sql`${t.status} <> 'aprobado' or ${t.paidAt} is not null`,
    ),
  ],
);

/**
 * ============================================================================
 * inventory_reservations
 * ============================================================================
 *
 * Bloquea unidades mientras el cliente termina de pagar. `expires_at` las
 * caduca solo; `cleanup_expired_reservations()` las borra fisicamente.
 *
 * BUG 4 — available_stock contaba DOBLE la reserva propia.
 * La version original hacia:
 *     stock - (select coalesce(sum(quantity),0)
 *              from inventory_reservations
 *              where variant_id = p_variant_id and expires_at > now())
 * es decir, restaba TODAS las reservas vigentes, incluida la del propio cliente
 * que estaba reintentando. Con el mismo session_token, el segundo intento veia
 * su propia reserva como competencia y fallaba con "Stock insuficiente".
 * La firma corregida es `available_stock(p_variant_id uuid, p_session_token text)`
 * y filtra `and (p_session_token is null or session_token <> p_session_token)`.
 * El `unique (variant_id, session_token)` de abajo es lo que hace posible ese
 * filtro: garantiza que "la reserva propia" sea exactamente una fila.
 *
 * BUG 6 — nada agendaba `cleanup_expired_reservations()`. No se arregla en el
 * schema: se agenda con pg_cron dentro del contenedor de Postgres, o con un
 * cron del VPS golpeando un route handler protegido por token. Sin eso, las
 * reservas caducadas nunca se borran (siguen sin contar por `expires_at`, pero
 * la tabla crece sin fin). El indice `expires_at` de abajo es para ese barrido.
 */
export const inventoryReservations = pgTable(
  "inventory_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    /** Mismo token que orders.checkout_session_token. */
    sessionToken: text("session_token").notNull(),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "cascade",
    }),
    quantity: integer("quantity").notNull(),
    /**
     * Se calcula con store_settings.reservation_ttl_minutes (BUG 7), nunca con
     * un `interval '15 minutes'` literal.
     */
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    ...createdAtOnly,
  },
  (t) => [
    /** Clave del BUG 4: una sola reserva por variante y sesion. */
    uniqueIndex("inventory_reservations_variant_session_uq").on(
      t.variantId,
      t.sessionToken,
    ),
    index("inventory_reservations_variant_expires_idx").on(
      t.variantId,
      t.expiresAt,
    ),
    /** Para el barrido de cleanup_expired_reservations(). */
    index("inventory_reservations_expires_at_idx").on(t.expiresAt),
    index("inventory_reservations_order_id_idx").on(t.orderId),
    check("inventory_reservations_quantity_ck", sql`${t.quantity} > 0`),
  ],
);

/**
 * ============================================================================
 * payment_events — bitacora de webhooks y guardia de idempotencia
 * ============================================================================
 *
 * `unique (gateway, external_id)` es lo que impide procesar dos veces el mismo
 * webhook cuando la pasarela reintenta.
 *
 * BUG 5 — `fulfill_paid_order` marcaba `processed_at = now()` ANTES de hacer el
 * trabajo. Si el proceso moria a mitad, el evento quedaba marcado como
 * procesado, el pedido sin pagar, y el reintento de la pasarela se descartaba
 * en silencio: pedido cobrado y nunca despachado.
 *
 * Correccion: TRES estados en vez de dos.
 *   received_at            -> siempre, al insertar.
 *   processing_started_at  -> se marca al TOMAR el evento, con
 *                             `update ... where processing_started_at is null
 *                              or processing_started_at < now() - interval '5 minutes'`
 *                             (claim atomico + rescate de eventos colgados).
 *   processed_at           -> se marca AL FINAL, en la MISMA transaccion que
 *                             hace el trabajo. Si algo revienta, el rollback se
 *                             lo lleva y el reintento de la pasarela encuentra
 *                             el evento otra vez disponible.
 *
 * `attempts` y `last_error` permiten ver los eventos atascados desde el admin.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gateway: paymentGateway("gateway").notNull(),
    /** ID del evento en la pasarela. Junto con gateway es la llave de idempotencia. */
    externalId: text("external_id").notNull(),
    eventType: text("event_type"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),

    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
      mode: "date",
    }),
    processedAt: timestamp("processed_at", {
      withTimezone: true,
      mode: "date",
    }),

    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    /** LA guardia de idempotencia. */
    uniqueIndex("payment_events_gateway_external_id_uq").on(
      t.gateway,
      t.externalId,
    ),
    /**
     * Indice parcial sobre lo pendiente. La tabla crece para siempre pero la
     * cola de trabajo se mantiene chiquita.
     */
    index("payment_events_pending_idx")
      .on(t.receivedAt)
      .where(sql`${t.processedAt} is null`),
    /** No se puede terminar algo que no se empezo. */
    check(
      "payment_events_order_ck",
      sql`${t.processedAt} is null or ${t.processingStartedAt} is not null`,
    ),
  ],
);

/**
 * ============================================================================
 * abandoned_carts — recuperación de carritos
 * ============================================================================
 *
 * Se graba en cuanto el comprador escribe su correo en el checkout, ANTES de
 * confirmar. Si no termina la compra, un barrido manda un recordatorio.
 *
 * Es una tabla aparte y no `carts` a propósito: aquí lo que importa no es el
 * carrito vivo del navegador sino la INTENCIÓN capturada en un momento, con su
 * correo, su consentimiento y su total congelado. Las líneas van como snapshot
 * jsonb por la misma razón que en order_items: si el catálogo cambia, el correo
 * debe poder reconstruir lo que la persona tenía delante.
 *
 * PRIVACIDAD (Ley 1581/2012): solo se escribe si `consent` es true, y una vez
 * enviado el recordatorio no se vuelve a escribir a esa dirección (`emailedAt`
 * lo impide). `unsubscribedAt` marca a quien pidió no recibir más.
 */
export const abandonedCarts = pgTable(
  "abandoned_carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    /** Snapshot de lo que había en el carrito: nombre, cantidad, precio, ruta. */
    items: jsonb("items").notNull(),
    subtotalCop: integer("subtotal_cop").notNull(),
    /** Autorización explícita para escribirle. Sin esto no se envía nada. */
    consent: boolean("consent").notNull().default(false),
    /** Cuándo se mandó el recordatorio. NULL = todavía no. Evita reenvíos. */
    emailedAt: timestamp("emailed_at", { withTimezone: true, mode: "date" }),
    /** Se marca cuando esa persona sí terminó comprando. */
    recoveredAt: timestamp("recovered_at", { withTimezone: true, mode: "date" }),
    /** Baja voluntaria: nunca más se le escribe. */
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (t) => [
    /**
     * Un registro vivo por correo: mientras la persona edita el carrito se
     * actualiza la misma fila en vez de acumular una por pulsación.
     */
    uniqueIndex("abandoned_carts_email_uq").on(t.email),
    /** El barrido busca por aquí: pendientes de aviso, por antigüedad. */
    index("abandoned_carts_pendientes_idx")
      .on(t.updatedAt)
      .where(sql`${t.emailedAt} is null and ${t.recoveredAt} is null`),
    check("abandoned_carts_subtotal_ck", sql`${t.subtotalCop} >= 0`),
  ],
);

// --- Tipos inferidos ---------------------------------------------------------

export type AbandonedCart = InferSelectModel<typeof abandonedCarts>;
export type NewAbandonedCart = InferInsertModel<typeof abandonedCarts>;
export type Cart = InferSelectModel<typeof carts>;
export type NewCart = InferInsertModel<typeof carts>;
export type CartItem = InferSelectModel<typeof cartItems>;
export type NewCartItem = InferInsertModel<typeof cartItems>;
export type Coupon = InferSelectModel<typeof coupons>;
export type NewCoupon = InferInsertModel<typeof coupons>;
export type CouponCategory = InferSelectModel<typeof couponCategories>;
export type NewCouponCategory = InferInsertModel<typeof couponCategories>;
export type CouponProduct = InferSelectModel<typeof couponProducts>;
export type NewCouponProduct = InferInsertModel<typeof couponProducts>;
export type CouponRedemption = InferSelectModel<typeof couponRedemptions>;
export type NewCouponRedemption = InferInsertModel<typeof couponRedemptions>;
export type Order = InferSelectModel<typeof orders>;
export type NewOrder = InferInsertModel<typeof orders>;
export type OrderItem = InferSelectModel<typeof orderItems>;
export type NewOrderItem = InferInsertModel<typeof orderItems>;
export type Payment = InferSelectModel<typeof payments>;
export type NewPayment = InferInsertModel<typeof payments>;
export type InventoryReservation = InferSelectModel<typeof inventoryReservations>;
export type NewInventoryReservation = InferInsertModel<typeof inventoryReservations>;
export type PaymentEvent = InferSelectModel<typeof paymentEvents>;
export type NewPaymentEvent = InferInsertModel<typeof paymentEvents>;
