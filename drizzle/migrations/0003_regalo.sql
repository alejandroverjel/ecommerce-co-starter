-- ============================================================================
-- Entrega programada y destinatario
--
-- Soporte para tiendas donde quien paga no siempre es quien recibe (regalos,
-- flores, encargos para terceros).
--
-- 1. Quien paga puede NO ser quien recibe. Se contacta al destinatario, no al
--    comprador, así que su nombre y teléfono son datos operativos, no un
--    detalle del envío.
-- 2. Cada pedido puede llevar un mensaje escrito a mano, cuando la tienda
--    activa checkout.mensajeRegalo.
-- 3. Es entrega programada: la experiencia depende de la hora.
--
-- Van como columnas y no dentro de shipping_address (jsonb) porque son datos
-- que se consultan a diario: "imprimir las tarjetas de hoy", "qué entregas
-- hay entre 8 y 12". Enterrados en un jsonb eso obliga a escanear la tabla.
-- ============================================================================

alter table public.orders
  add column if not exists gift_message    text,
  add column if not exists recipient_name  text,
  add column if not exists recipient_phone text,
  add column if not exists delivery_date   date,
  add column if not exists delivery_slot   text;

comment on column public.orders.gift_message is
  'Mensaje que se escribe a mano en la tarjeta. Lo redacta el comprador.';
comment on column public.orders.recipient_name is
  'Quien recibe el regalo. Puede ser distinto de customer_name.';
comment on column public.orders.recipient_phone is
  'Teléfono al que llama el mensajero al llegar.';
comment on column public.orders.delivery_date is
  'Fecha acordada de entrega, en zona horaria América/Bogotá.';
comment on column public.orders.delivery_slot is
  'Franja horaria de entrega.';

-- ----------------------------------------------------------------------------
-- Franjas de entrega
--
-- Texto con CHECK en vez de enum: las franjas cambian según la operación
-- (temporada alta, día de la madre) y alterar un enum en Postgres exige
-- migración, mientras que ajustar un CHECK es una sola sentencia.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_delivery_slot_ck'
  ) then
    alter table public.orders
      add constraint orders_delivery_slot_ck
      check (
        delivery_slot is null
        or delivery_slot in ('manana', 'tarde', 'noche')
      );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Coherencia: si hay fecha debe haber franja, y al revés.
-- Media programación no sirve para nada a quien organiza la ruta del día.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_delivery_coherence_ck'
  ) then
    alter table public.orders
      add constraint orders_delivery_coherence_ck
      check (
        (delivery_date is null and delivery_slot is null)
        or (delivery_date is not null and delivery_slot is not null)
      );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Índice para la vista de operación: "qué hay que entregar hoy".
--
-- Parcial sobre los pedidos que siguen vivos: los cancelados y entregados no
-- se consultan por fecha y solo harían crecer el índice.
-- ----------------------------------------------------------------------------
create index if not exists orders_delivery_date_idx
  on public.orders (delivery_date, delivery_slot)
  where delivery_date is not null
    and status in ('pagado', 'en_preparacion', 'enviado');
