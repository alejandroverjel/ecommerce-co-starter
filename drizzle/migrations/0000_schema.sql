CREATE TYPE "public"."coupon_scope" AS ENUM('orden', 'categoria', 'producto');--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('porcentaje', 'monto_fijo', 'envio_gratis');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pendiente', 'pagado', 'en_preparacion', 'enviado', 'entregado', 'cancelado', 'reembolsado');--> statement-breakpoint
CREATE TYPE "public"."payment_gateway" AS ENUM('wompi', 'epayco', 'mercadopago');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pendiente', 'aprobado', 'rechazado', 'reembolsado');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('borrador', 'activo', 'archivado');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pendiente', 'aprobada', 'rechazada');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'staff', 'cliente');--> statement-breakpoint
CREATE SEQUENCE "public"."order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1000 CACHE 1;--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"departamento" text NOT NULL,
	"ciudad" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"notes" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'cliente' NOT NULL,
	"phone" text,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_no_self_parent_ck" CHECK ("categories"."parent_id" is null or "categories"."parent_id" <> "categories"."id")
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"alt_text" text,
	"width" integer,
	"height" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"price_cop" integer NOT NULL,
	"compare_at_price_cop" integer,
	"stock" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_price_ck" CHECK ("product_variants"."price_cop" >= 0),
	CONSTRAINT "product_variants_compare_price_ck" CHECK ("product_variants"."compare_at_price_cop" is null or "product_variants"."compare_at_price_cop" > "product_variants"."price_cop"),
	CONSTRAINT "product_variants_stock_ck" CHECK ("product_variants"."stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"description_html" text,
	"status" "product_status" DEFAULT 'borrador' NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"tags" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid,
	"author_name" text NOT NULL,
	"rating" smallint NOT NULL,
	"title" text,
	"body" text,
	"status" "review_status" DEFAULT 'pendiente' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_ck" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_no_self_approval_ck" CHECK ("reviews"."approved_by" is null or "reviews"."user_id" is null or "reviews"."approved_by" <> "reviews"."user_id"),
	CONSTRAINT "reviews_approval_coherence_ck" CHECK (("reviews"."status" <> 'aprobada') or ("reviews"."approved_by" is not null and "reviews"."approved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_quantity_ck" CHECK ("cart_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"session_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_owner_ck" CHECK ("carts"."user_id" is not null or "carts"."session_token" is not null)
);
--> statement-breakpoint
CREATE TABLE "coupon_categories" (
	"coupon_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "coupon_categories_coupon_id_category_id_pk" PRIMARY KEY("coupon_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "coupon_products" (
	"coupon_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "coupon_products_coupon_id_product_id_pk" PRIMARY KEY("coupon_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid,
	"amount_cop" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_amount_ck" CHECK ("coupon_redemptions"."amount_cop" >= 0)
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"type" "coupon_type" NOT NULL,
	"scope" "coupon_scope" DEFAULT 'orden' NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"min_subtotal_cop" integer DEFAULT 0 NOT NULL,
	"max_discount_cop" integer,
	"usage_limit" integer,
	"usage_limit_per_user" integer,
	"times_redeemed" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_value_ck" CHECK ("coupons"."value" >= 0),
	CONSTRAINT "coupons_percent_range_ck" CHECK ("coupons"."type" <> 'porcentaje' or "coupons"."value" <= 10000),
	CONSTRAINT "coupons_min_subtotal_ck" CHECK ("coupons"."min_subtotal_cop" >= 0),
	CONSTRAINT "coupons_window_ck" CHECK ("coupons"."starts_at" is null or "coupons"."ends_at" is null or "coupons"."starts_at" < "coupons"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"session_token" text NOT NULL,
	"order_id" uuid,
	"quantity" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_quantity_ck" CHECK ("inventory_reservations"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"product_name" text NOT NULL,
	"variant_name" text NOT NULL,
	"sku" text,
	"unit_price_cop" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_cop" integer GENERATED ALWAYS AS (unit_price_cop * quantity) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_ck" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_unit_price_ck" CHECK ("order_items"."unit_price_cop" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text DEFAULT 'ORD-' || lpad(nextval('order_number_seq')::text, 6, '0') NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"phone" text,
	"customer_name" text,
	"status" "order_status" DEFAULT 'pendiente' NOT NULL,
	"subtotal_cop" integer NOT NULL,
	"discount_cop" integer DEFAULT 0 NOT NULL,
	"shipping_cop" integer DEFAULT 0 NOT NULL,
	"total_cop" integer NOT NULL,
	"tax_included_cop" integer DEFAULT 0 NOT NULL,
	"coupon_id" uuid,
	"coupon_code" text,
	"payment_method" text,
	"shipping_address" jsonb,
	"notes" text,
	"checkout_session_token" text,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_subtotal_ck" CHECK ("orders"."subtotal_cop" >= 0),
	CONSTRAINT "orders_discount_ck" CHECK ("orders"."discount_cop" >= 0),
	CONSTRAINT "orders_shipping_ck" CHECK ("orders"."shipping_cop" >= 0),
	CONSTRAINT "orders_discount_lte_subtotal_ck" CHECK ("orders"."discount_cop" <= "orders"."subtotal_cop"),
	CONSTRAINT "orders_total_ck" CHECK ("orders"."total_cop" = "orders"."subtotal_cop" - "orders"."discount_cop" + "orders"."shipping_cop"),
	CONSTRAINT "orders_tax_ck" CHECK ("orders"."tax_included_cop" >= 0 and "orders"."tax_included_cop" <= "orders"."total_cop"),
	CONSTRAINT "orders_coupon_coherence_ck" CHECK (("orders"."coupon_id" is null) = ("orders"."coupon_code" is null)),
	CONSTRAINT "orders_paid_at_ck" CHECK ("orders"."status" not in ('pagado','en_preparacion','enviado','entregado') or "orders"."paid_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway" "payment_gateway" NOT NULL,
	"external_id" text NOT NULL,
	"event_type" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_started_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "payment_events_order_ck" CHECK ("payment_events"."processed_at" is null or "payment_events"."processing_started_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"gateway" "payment_gateway" NOT NULL,
	"status" "payment_status" DEFAULT 'pendiente' NOT NULL,
	"amount_cop" integer NOT NULL,
	"currency" text DEFAULT 'COP' NOT NULL,
	"external_id" text,
	"external_reference" text,
	"raw_response" jsonb,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount_cop" > 0),
	CONSTRAINT "payments_paid_at_ck" CHECK ("payments"."status" <> 'aprobado' or "payments"."paid_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "payment_gateways" (
	"gateway" "payment_gateway" PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"is_sandbox" boolean DEFAULT true NOT NULL,
	"public_key" text,
	"config" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"store_name" text DEFAULT 'Mi tienda' NOT NULL,
	"contact_email" text DEFAULT 'hola@example.com' NOT NULL,
	"contact_phone" text,
	"whatsapp_number" text DEFAULT '' NOT NULL,
	"flat_shipping_cop" integer DEFAULT 10000 NOT NULL,
	"free_shipping_threshold_cop" integer DEFAULT 200000 NOT NULL,
	"tax_rate_bps" integer DEFAULT 1900 NOT NULL,
	"reservation_ttl_minutes" integer DEFAULT 15 NOT NULL,
	"currency" text DEFAULT 'COP' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_settings_singleton_ck" CHECK ("store_settings"."id"),
	CONSTRAINT "store_settings_flat_shipping_ck" CHECK ("store_settings"."flat_shipping_cop" >= 0),
	CONSTRAINT "store_settings_free_threshold_ck" CHECK ("store_settings"."free_shipping_threshold_cop" >= 0),
	CONSTRAINT "store_settings_tax_rate_ck" CHECK ("store_settings"."tax_rate_bps" >= 0 and "store_settings"."tax_rate_bps" <= 10000),
	CONSTRAINT "store_settings_ttl_ck" CHECK ("store_settings"."reservation_ttl_minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_categories" ADD CONSTRAINT "coupon_categories_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_categories" ADD CONSTRAINT "coupon_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "addresses_user_id_idx" ON "addresses" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_one_default_per_user_uq" ON "addresses" USING btree ("user_id") WHERE "addresses"."is_default";--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_uq" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "product_images_product_position_idx" ON "product_images" USING btree ("product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_primary_uq" ON "product_images" USING btree ("product_id") WHERE "product_images"."position" = 0;--> statement-breakpoint
CREATE INDEX "product_variants_product_id_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_name_uq" ON "product_variants" USING btree ("product_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku_uq" ON "product_variants" USING btree ("sku") WHERE "product_variants"."sku" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_uq" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_category_id_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_status_category_position_idx" ON "products" USING btree ("status","category_id","position");--> statement-breakpoint
CREATE INDEX "products_tags_gin_idx" ON "products" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "reviews_product_status_idx" ON "reviews" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "reviews_user_id_idx" ON "reviews" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_product_user_uq" ON "reviews" USING btree ("product_id","user_id") WHERE "reviews"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_items_user_product_uq" ON "wishlist_items" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "wishlist_items_product_id_idx" ON "wishlist_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_cart_variant_uq" ON "cart_items" USING btree ("cart_id","variant_id");--> statement-breakpoint
CREATE INDEX "cart_items_cart_id_idx" ON "cart_items" USING btree ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_user_uq" ON "carts" USING btree ("user_id") WHERE "carts"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "carts_session_token_uq" ON "carts" USING btree ("session_token") WHERE "carts"."session_token" is not null;--> statement-breakpoint
CREATE INDEX "coupon_categories_category_id_idx" ON "coupon_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "coupon_products_product_id_idx" ON "coupon_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_coupon_order_uq" ON "coupon_redemptions" USING btree ("coupon_id","order_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_user_idx" ON "coupon_redemptions" USING btree ("user_id","coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_upper_uq" ON "coupons" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "coupons_active_idx" ON "coupons" USING btree ("is_active","ends_at") WHERE "coupons"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_reservations_variant_session_uq" ON "inventory_reservations" USING btree ("variant_id","session_token");--> statement-breakpoint
CREATE INDEX "inventory_reservations_variant_expires_idx" ON "inventory_reservations" USING btree ("variant_id","expires_at");--> statement-breakpoint
CREATE INDEX "inventory_reservations_expires_at_idx" ON "inventory_reservations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "inventory_reservations_order_id_idx" ON "inventory_reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_variant_id_idx" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_uq" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "orders_user_id_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_email_idx" ON "orders" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "orders_status_created_at_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_checkout_session_uq" ON "orders" USING btree ("checkout_session_token") WHERE "orders"."checkout_session_token" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_gateway_external_id_uq" ON "payment_events" USING btree ("gateway","external_id");--> statement-breakpoint
CREATE INDEX "payment_events_pending_idx" ON "payment_events" USING btree ("received_at") WHERE "payment_events"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "payments_order_id_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gateway_external_id_uq" ON "payments" USING btree ("gateway","external_id") WHERE "payments"."external_id" is not null;