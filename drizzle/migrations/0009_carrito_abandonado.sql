-- ============================================================================
-- 0009  abandoned_carts — recuperación de carritos abandonados
--
-- OJO: `drizzle-kit generate` produjo también un ALTER TYPE payment_gateway y
-- varios ADD COLUMN de orders (gift_message, recipient_name, recipient_phone,
-- delivery_date, delivery_slot). Todo eso YA existe desde 0003_regalo.sql y
-- 0005_pago_manual.sql: su snapshot venía desfasado porque esas migraciones se
-- escribieron a mano. Aplicarlo habría reventado con "column already exists".
-- Este archivo se dejó SOLO con la tabla nueva, que es el cambio real.
--
-- El correo va con `if not exists` para que reaplicarla sea inofensivo.
-- ============================================================================

create table if not exists "abandoned_carts" (
  "id"              uuid primary key default gen_random_uuid() not null,
  "email"           text not null,
  "items"           jsonb not null,
  "subtotal_cop"    integer not null,
  "consent"         boolean default false not null,
  "emailed_at"      timestamp with time zone,
  "recovered_at"    timestamp with time zone,
  "unsubscribed_at" timestamp with time zone,
  "created_at"      timestamp with time zone default now() not null,
  "updated_at"      timestamp with time zone default now() not null,
  constraint "abandoned_carts_subtotal_ck" check ("subtotal_cop" >= 0)
);
--> statement-breakpoint
-- Un registro vivo por correo: mientras la persona edita el carrito se
-- actualiza la misma fila (upsert) en vez de acumular una por pulsación.
create unique index if not exists "abandoned_carts_email_uq"
  on "abandoned_carts" using btree ("email");
--> statement-breakpoint
-- Índice parcial para el barrido: solo lo que sigue pendiente de aviso.
create index if not exists "abandoned_carts_pendientes_idx"
  on "abandoned_carts" using btree ("updated_at")
  where "emailed_at" is null and "recovered_at" is null;
--> statement-breakpoint
-- updated_at lo mantiene el mismo trigger del resto de tablas: el barrido mide
-- la antigüedad con esa columna, así que tiene que moverse en cada UPDATE.
drop trigger if exists set_updated_at_abandoned_carts on public.abandoned_carts;
--> statement-breakpoint
create trigger set_updated_at_abandoned_carts
  before update on public.abandoned_carts
  for each row execute function public.set_updated_at();
