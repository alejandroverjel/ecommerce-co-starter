import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAtOnly, timestamps } from "./_shared";
import { productStatus, reviewStatus } from "./enums";
import { users } from "./auth";

/**
 * ============================================================================
 * categories — arbol auto-referencial
 * ============================================================================
 *
 * `parentId` se auto-referencia. Drizzle no puede inferir el tipo de una
 * columna que se referencia a si misma, por eso la anotacion explicita
 * `(): AnyPgColumn`. Sin ella TypeScript entra en recursion infinita.
 *
 * `on delete set null` y no `cascade`: borrar una categoria padre no debe
 * borrar en cascada sus subcategorias con todos sus productos. Quedan como
 * raiz.
 *
 * Las categorias iniciales las siembra lib/db/seed.ts desde
 * TIENDA.catalogo.categoriasIniciales: el panel no tiene CRUD de categorias.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "set null",
    }),

    /** Segmento de URL. Estructura a preservar: /tienda/{categoria}/{producto}/ */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),

    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),

    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("categories_slug_uq").on(t.slug),
    index("categories_parent_id_idx").on(t.parentId),
    /** Una categoria no puede ser su propia madre. Los ciclos mas largos no se
     *  pueden atajar con CHECK: eso lo valida la app al mover una categoria. */
    check(
      "categories_no_self_parent_ck",
      sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`,
    ),
  ],
);

/**
 * ============================================================================
 * products — SIN precio y SIN stock
 * ============================================================================
 *
 * Precio y existencias viven en `product_variants`, siempre. Un producto sin
 * variantes no se puede vender: eso es intencional y evita el caso ambiguo de
 * "precio del producto vs precio de la variante" que produce descuadres.
 * Al importar desde una plataforma que solo maneja productos simples, cada
 * uno genera UNA variante llamada "Unica".
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),

    slug: text("slug").notNull(),
    name: text("name").notNull(),

    /** Texto plano, sin shortcodes ni HTML del CMS de origen. Para buscador y meta description. */
    description: text("description"),
    /** HTML sanitizado que se pinta en la PDP. */
    descriptionHtml: text("description_html"),

    status: productStatus("status").notNull().default("borrador"),
    isFeatured: boolean("is_featured").notNull().default(false),
    position: integer("position").notNull().default(0),

    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    /** text[] nativo de Postgres, no una tabla puente: son etiquetas libres. */
    tags: text("tags").array(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("products_slug_uq").on(t.slug),
    index("products_category_id_idx").on(t.categoryId),
    /**
     * Indice compuesto para la consulta caliente del listado:
     * `where status = 'activo' and category_id = $1 order by position`.
     */
    index("products_status_category_position_idx").on(
      t.status,
      t.categoryId,
      t.position,
    ),
    /** GIN para `tags @> ARRAY['navidad']`. */
    index("products_tags_gin_idx").using("gin", t.tags),
  ],
);

/**
 * ============================================================================
 * product_variants — donde viven precio y stock
 * ============================================================================
 *
 * DINERO EN ENTEROS COP. `integer` aguanta hasta 2.147.483.647 pesos, de sobra
 * para cualquier catalogo. Nada de numeric ni real: los precios colombianos no
 * tienen centavos y un float introduce errores de redondeo que despues no
 * cuadran contra el extracto de la pasarela.
 *
 * `price_cop` YA INCLUYE el IVA del 19% (convencion colombiana). Para la
 * factura se desglosa con store_settings.tax_rate_bps; nunca se suma encima.
 *
 * `stock` es el stock FISICO. El disponible para vender es
 * `available_stock(variant_id, session_token)` = stock - reservas vigentes de
 * OTRAS sesiones. Ver la nota del BUG 4 en inventory_reservations.
 */
export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    sku: text("sku"),

    /** Precio de venta con IVA incluido, en pesos enteros. */
    priceCop: integer("price_cop").notNull(),
    /** Precio tachado ("antes"). Null si no hay promocion. */
    compareAtPriceCop: integer("compare_at_price_cop"),

    stock: integer("stock").notNull().default(0),
    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),

    ...timestamps,
  },
  (t) => [
    index("product_variants_product_id_idx").on(t.productId),
    uniqueIndex("product_variants_product_name_uq").on(t.productId, t.name),
    /** SKU unico solo entre los que existen: varias variantes pueden no tenerlo. */
    uniqueIndex("product_variants_sku_uq")
      .on(t.sku)
      .where(sql`${t.sku} is not null`),
    check("product_variants_price_ck", sql`${t.priceCop} >= 0`),
    check(
      "product_variants_compare_price_ck",
      sql`${t.compareAtPriceCop} is null or ${t.compareAtPriceCop} > ${t.priceCop}`,
    ),
    /** El stock NUNCA puede quedar negativo: es la ultima red bajo el plpgsql. */
    check("product_variants_stock_ck", sql`${t.stock} >= 0`),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    /** Ruta RELATIVA en el volumen Docker: /uploads/productos/{archivo}. Nunca URL absoluta. */
    url: text("url").notNull(),
    altText: text("alt_text"),
    width: integer("width"),
    height: integer("height"),
    position: integer("position").notNull().default(0),

    ...createdAtOnly,
  },
  (t) => [
    index("product_images_product_position_idx").on(t.productId, t.position),
    /** Una sola imagen principal por producto (la de position 0 se usa en OG y JSON-LD). */
    uniqueIndex("product_images_primary_uq")
      .on(t.productId)
      .where(sql`${t.position} = 0`),
  ],
);

/**
 * ============================================================================
 * reviews
 * ============================================================================
 *
 * El trigger `prevent_review_self_approval` se conserva reescrito sin
 * auth.uid(): recibe el aprobador desde la app. Pero la regla mas importante
 * (nadie se auto-aprueba) es un INVARIANTE DE DATOS, no una regla de sesion, y
 * por eso se declara ademas como CHECK: un CHECK no se puede saltar ni desde
 * psql, ni desde una migracion apurada, ni si alguien desactiva el trigger.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Null si la resena es de un invitado o si el usuario borro su cuenta. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),

    authorName: text("author_name").notNull(),
    /** smallint: el rango util es 1..5, no hace falta un integer de 4 bytes. */
    rating: smallint("rating").notNull(),
    title: text("title"),
    body: text("body"),

    status: reviewStatus("status").notNull().default("pendiente"),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", {
      withTimezone: true,
      mode: "date",
    }),

    ...timestamps,
  },
  (t) => [
    index("reviews_product_status_idx").on(t.productId, t.status),
    index("reviews_user_id_idx").on(t.userId),
    /** Una resena por usuario y producto (los invitados no quedan limitados). */
    uniqueIndex("reviews_product_user_uq")
      .on(t.productId, t.userId)
      .where(sql`${t.userId} is not null`),
    check("reviews_rating_ck", sql`${t.rating} between 1 and 5`),
    /** Nadie aprueba su propia resena. Espejo del trigger, a nivel de datos. */
    check(
      "reviews_no_self_approval_ck",
      sql`${t.approvedBy} is null or ${t.userId} is null or ${t.approvedBy} <> ${t.userId}`,
    ),
    /** Coherencia: aprobada <=> hay aprobador y fecha. */
    check(
      "reviews_approval_coherence_ck",
      sql`(${t.status} <> 'aprobada') or (${t.approvedBy} is not null and ${t.approvedAt} is not null)`,
    ),
  ],
);

/**
 * wishlist_items — lista de deseos.
 * Apunta al PRODUCTO y no a la variante: se desea el producto, la variante se
 * elige al momento de agregarlo al carrito.
 */
export const wishlistItems = pgTable(
  "wishlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    ...createdAtOnly,
  },
  (t) => [
    uniqueIndex("wishlist_items_user_product_uq").on(t.userId, t.productId),
    index("wishlist_items_product_id_idx").on(t.productId),
  ],
);

// --- Tipos inferidos ---------------------------------------------------------

export type Category = InferSelectModel<typeof categories>;
export type NewCategory = InferInsertModel<typeof categories>;
export type Product = InferSelectModel<typeof products>;
export type NewProduct = InferInsertModel<typeof products>;
export type ProductVariant = InferSelectModel<typeof productVariants>;
export type NewProductVariant = InferInsertModel<typeof productVariants>;
export type ProductImage = InferSelectModel<typeof productImages>;
export type NewProductImage = InferInsertModel<typeof productImages>;
export type Review = InferSelectModel<typeof reviews>;
export type NewReview = InferInsertModel<typeof reviews>;
export type WishlistItem = InferSelectModel<typeof wishlistItems>;
export type NewWishlistItem = InferInsertModel<typeof wishlistItems>;
