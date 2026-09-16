-- ============================================================================
-- 0001_funciones.sql
--
-- Funciones plpgsql, triggers de proteccion y disciplina anti-deadlock.
-- Portado de ecommerce-co-starter v0.1.0 (Supabase) a PostgreSQL 16 self-hosted.
--
-- Sin RLS y sin auth.uid(): el navegador nunca toca Postgres. La autorizacion
-- vive en los route handlers de Next.js; lo de aqui son invariantes de datos
-- (stock, dinero, idempotencia) que no se pueden delegar a la aplicacion.
--
-- Este archivo NO abre transaccion: drizzle-kit ya envuelve cada migracion en
-- una. Las lineas separadoras de abajo son las que usa el migrador de drizzle
-- para partir el archivo en sentencias; en psql son comentarios inertes.
--
-- OJO: el migrador parte el archivo por COINCIDENCIA DE TEXTO. Escribir ese
-- marcador dentro de un comentario —como hacia la cabecera de la version
-- anterior para "explicarlo"— corta el archivo justo ahi y manda medio
-- comentario a Postgres como si fuera SQL. Por eso aqui no se transcribe.
--
-- ----------------------------------------------------------------------------
-- CONTRATO CON 0000_schema.sql  (EL SCHEMA MANDA)
-- ----------------------------------------------------------------------------
-- Este archivo se escribio contra lib/db/schema/*.ts. Los nombres de abajo son
-- los que genera drizzle-kit; si el schema cambia, ESTE archivo se adapta, no
-- al reves. Choques que existian y quedaron resueltos aqui:
--
--   store_settings.iva_rate numeric(0.19)  ->  tax_rate_bps integer (1900)
--   orders.tax_cop                         ->  tax_included_cop
--   coupons.max_redemptions                ->  usage_limit
--   coupons.max_redemptions_per_user       ->  usage_limit_per_user
--   coupon_redemptions                     ->  amount_cop NOT NULL (hay que llenarlo)
--   orders                                 ->  coupon_id / coupon_code con CHECK de coherencia
--
-- Columnas que este archivo da por existentes (todas creadas por 0000_schema):
--   store_settings(id boolean pk, tax_rate_bps int, flat_shipping_cop int,
--                  free_shipping_threshold_cop int, reservation_ttl_minutes int)
--   products(id, name, status product_status, category_id)
--   product_variants(id, product_id, name, sku, price_cop int, stock int,
--                    position int, is_active bool)
--   inventory_reservations(variant_id, session_token, order_id, quantity,
--                          expires_at, unique (variant_id, session_token))
--   orders(id, user_id, email, status order_status, subtotal_cop, discount_cop,
--          shipping_cop, tax_included_cop, total_cop, coupon_id, coupon_code,
--          shipping_address jsonb, checkout_session_token text, payment_method,
--          paid_at, cancelled_at, order_number text default nextval)
--   order_items(order_id, product_id, variant_id, product_name, variant_name,
--               sku, unit_price_cop, quantity)
--   payments(order_id, gateway, external_id, external_reference, amount_cop,
--            status payment_status, paid_at, raw_response)
--   payment_events(id, gateway, external_id, event_type, payload,
--                  processing_started_at, processed_at, attempts, last_error,
--                  unique (gateway, external_id))
--   coupons(id, code, type, value, scope, min_subtotal_cop, max_discount_cop,
--           usage_limit, usage_limit_per_user, starts_at, ends_at, is_active,
--           times_redeemed)
--   coupon_redemptions(coupon_id, order_id, user_id, amount_cop)
--
-- ----------------------------------------------------------------------------
-- UNIDADES — todo entero, nunca float
-- ----------------------------------------------------------------------------
--   dinero                      : pesos COP enteros
--   store_settings.tax_rate_bps : puntos basicos (1900 = 19%)
--   coupons.value (porcentaje)  : puntos basicos (1000 = 10%)
--   coupons.value (monto_fijo)  : pesos COP enteros
--
-- IVA INCLUIDO (convencion colombiana). Se DESGLOSA, jamas se suma encima:
--   base = round(total * 10000 / (10000 + tax_rate_bps))
--   iva  = total - base
--
-- ----------------------------------------------------------------------------
-- SQLSTATE propios (para mapearlos a HTTP en los route handlers)
-- ----------------------------------------------------------------------------
--   RCA01  store_settings ausente o mal configurada        -> 500
--   RCA02  stock insuficiente                              -> 409
--   RCA03  producto / variante / pedido no disponible      -> 404 / 409
--   RCA04  cupon invalido                                  -> 422
--   RCA05  entrada invalida (carrito vacio, email, token)  -> 400
--   RCA06  carrera irresoluble registrando el evento       -> 503 (reintentar)
--   RCA08  cambio de rol bloqueado                         -> 403
--   RCA09  moderacion de resenas bloqueada                 -> 403
--
--   RCA07 (monto del webhook != total del pedido) YA NO SE LANZA. Ver la nota
--   "PAGOS ANOMALOS" en la seccion 6: lanzar excepcion revertia tambien el
--   registro del pago y dejaba a la pasarela reintentando para siempre, que es
--   justo lo contrario de "un pago cobrado nunca se pierde".
--
-- ----------------------------------------------------------------------------
-- ORDEN GLOBAL DE BLOQUEO — INVARIANTE. No es un comentario decorativo.
-- ----------------------------------------------------------------------------
-- Toda funcion de este archivo que tome mas de un lock los toma SIEMPRE en
-- este orden, y dentro de cada tabla en orden ascendente de id:
--
--     payment_events  ->  orders  ->  payments  ->  product_variants
--                     ->  coupons ->  inventory_reservations
--
-- POR QUE ESTE ORDEN Y NO EL CONTRARIO (orders antes que product_variants):
--
--   1. En el camino del pago manda el pedido. fulfill_paid_order no puede
--      decidir NADA —si es un segundo cobro, si el monto cuadra, si el pedido
--      admite el pago— sin la fila de orders estable. Bloquearla primero es
--      obligatorio; hacerlo despues de las variantes obligaria a leer el pedido
--      SIN lock para saber que variantes bloquear, y esa lectura sucia es justo
--      lo que no se puede permitir donde hay plata cobrada.
--   2. Del lado del checkout el cambio es barato y no invierte ninguna
--      dependencia: el pedido anterior se busca por p_session_token, que es un
--      argumento de la funcion, asi que su bloqueo (5.2b) se puede tomar antes
--      de resolver y bloquear las variantes (5.3).
--   3. De grueso a fino: orders es la raiz del agregado y product_variants las
--      hojas. Cualquier funcion futura que toque las dos tiene una regla clara.
--
-- ANTES ESTABA ROTO: create_pending_order bloqueaba product_variants (5.3) y
-- luego orders (5.7); fulfill_paid_order bloqueaba orders (6.2) y luego
-- product_variants (6.5). Corriendo en paralelo se abrazaban y Postgres mataba
-- una de las dos transacciones — en la reproduccion, la del WEBHOOK. La
-- disciplina "ORDER BY id" que ya existia solo cubria variante-contra-variante.
-- ============================================================================


-- ============================================================================
-- 1. set_updated_at() + triggers
--
-- (La vieja seccion 0 "columnas que faltaban" se elimino: orders.payment_method,
--  store_settings.reservation_ttl_minutes y el indice de expires_at ya los crea
--  0000_schema.sql desde lib/db/schema/*.ts. Parchear con ALTER TABLE lo que el
--  schema ya declara es como se llego a tener dos contratos distintos.)
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;
--> statement-breakpoint

-- Se instala en TODA tabla de public que tenga updated_at. Hacerlo por catalogo
-- en vez de listar los nombres evita que la lista se desincronice del schema, y
-- es idempotente: primero borra cualquier trigger previo que ya apunte a
-- set_updated_at() en esa tabla.
-- Al agregar una tabla nueva con updated_at hay que volver a correr este bloque.
do $do$
declare
  r record;
  t record;
  v_trigger text;
begin
  for r in
    select distinct c.oid, c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attname = 'updated_at'
       and a.attnum > 0
       and not a.attisdropped
     order by c.relname
  loop
    for t in
      select tg.tgname
        from pg_trigger tg
       where tg.tgrelid = r.oid
         and not tg.tgisinternal
         and tg.tgfoid = 'public.set_updated_at'::regproc
    loop
      execute format('drop trigger if exists %I on public.%I', t.tgname, r.table_name);
    end loop;

    v_trigger := 'trg_' || r.table_name || '_updated_at';
    execute format(
      'create trigger %I before update on public.%I '
      'for each row execute function public.set_updated_at()',
      v_trigger, r.table_name);
  end loop;
end
$do$;
--> statement-breakpoint


-- ============================================================================
-- 2. available_stock(variant, session_token)
--
-- BUG 4 CORREGIDO: el original restaba TODAS las reservas vigentes, incluida
-- la del propio solicitante. En un reintento de checkout con el mismo
-- session_token el cliente competia contra si mismo y recibia "Stock
-- insuficiente" sin razon. Ahora, si se pasa p_session_token, las reservas de
-- ESE token no se descuentan: ya son suyas.
--
-- p_session_token NULL = vista publica (catalogo, PDP): descuenta todo.
-- ============================================================================

create or replace function public.available_stock(
  p_variant_id    uuid,
  p_session_token text default null
)
returns integer
language sql
stable
set search_path = public, pg_temp
as $fn$
  select greatest(
           coalesce((select v.stock
                       from public.product_variants v
                      where v.id = p_variant_id), 0)
           - coalesce((select sum(r.quantity)
                         from public.inventory_reservations r
                        where r.variant_id = p_variant_id
                          and r.expires_at > now()
                          and (p_session_token is null
                               or r.session_token is distinct from p_session_token)), 0),
           0
         )::integer;
$fn$;
--> statement-breakpoint


-- ============================================================================
-- 3. release_reservations(session_token)
--
-- Suelta las unidades que retenia un checkout: carrito abandonado, pago
-- rechazado, o pago aprobado (ahi el stock ya se descontó de verdad).
-- Devuelve cuantas reservas borro.
-- ============================================================================

create or replace function public.release_reservations(
  p_session_token text
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_deleted integer;
begin
  if p_session_token is null or btrim(p_session_token) = '' then
    return 0;
  end if;

  delete from public.inventory_reservations r
   where r.session_token = p_session_token;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;
--> statement-breakpoint


-- ============================================================================
-- 4. cleanup_expired_reservations()
--
-- BUG 6: en el original NADIE agendaba esto. Opciones para este VPS, en orden
-- de preferencia:
--   a) pg_cron dentro del contenedor de Postgres (pide shared_preload_libraries):
--        select cron.schedule('limpiar-reservas', '*/5 * * * *',
--                             'select public.cleanup_expired_reservations()');
--   b) cron del host:
--        docker exec -i <postgres> psql -U <usuario> -d <base> \
--          -c "select public.cleanup_expired_reservations();"
--   c) Ruta /api/cron/reservas protegida por CRON_SECRET, llamada por el cron
--      del host con curl.
--
-- Ojo: aunque nadie lo ejecute, available_stock() ya ignora las reservas
-- vencidas (filtra expires_at > now()). Esta limpieza es higiene de tabla,
-- no correccion de disponibilidad. No es una tarea critica.
-- ============================================================================

create or replace function public.cleanup_expired_reservations()
returns integer
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_deleted integer;
begin
  delete from public.inventory_reservations r
   where r.expires_at <= now();

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;
--> statement-breakpoint


-- ============================================================================
-- 5. create_pending_order(...)
--
-- Crea el pedido en estado 'pendiente' y reserva las unidades. Es el unico
-- lugar donde se calcula dinero: el cliente manda product_id + cantidad y
-- NADA MAS. Precios, envio, descuento e IVA se leen de la base.
--
-- Conserva del original:
--   * agregacion de cantidades por producto (dos lineas del mismo producto
--     se suman antes de validar stock)
--   * variante por defecto = la activa con menor position
--   * SELECT ... FOR UPDATE ORDENADO POR id de variante  <- DELIBERADO.
--     Si dos pedidos compiten por los mismos productos en orden distinto y
--     cada uno bloquea en el orden en que el cliente los mando, se abrazan.
--     Bloqueando siempre en orden ascendente de id, el segundo espera al
--     primero en vez de morir por deadlock.
--     OJO: eso solo resuelve variante-contra-variante. El deadlock contra
--     fulfill_paid_order se resuelve con el ORDEN GLOBAL DE BLOQUEO de la
--     cabecera: el pedido anterior del token se bloquea en 5.2b, ANTES de las
--     variantes de 5.3.
--   * re-lectura de precios desde la base
--   * validacion de stock disponible
--   * envio e IVA desde store_settings
--   * insercion de pedido + items + reservas
--
-- Corrige (respecto de la version que no cuadraba con el schema):
--   BUG 1: si store_settings esta vacia o incompleta, EXCEPCION. El original
--          hacia coalesce(v_flat, 0) y cobraba envio $0 mientras la UI mostraba
--          la tarifa configurada.
--   BUG 2: p_payment_method se guarda en orders.payment_method.
--   BUG 3: los cupones se aplican de verdad (discount_cop ya no es 0 fijo).
--   BUG 4: available_stock() recibe el session_token del solicitante.
--   BUG 7: el TTL de la reserva sale de store_settings.reservation_ttl_minutes.
--
--   IVA EN BPS: leia s.iva_rate (columna inexistente) y validaba `< 0 or >= 1`
--          esperando una fraccion; con 1900 esa guarda disparaba SIEMPRE. Ahora
--          lee tax_rate_bps y desglosa con la formula de puntos basicos.
--   TAX_COP: insertaba en orders.tax_cop; la columna es tax_included_cop.
--   CUPON 100x: hacia round(base * value / 100.0) tratando `value` como
--          porcentaje entero, pero el schema lo define en PUNTOS BASICOS. Un
--          cupon del 10% (value=1000) descontaba el 100%. Ahora divide por
--          10000 y respeta max_discount_cop.
--   REDENCION: coupon_redemptions.amount_cop es NOT NULL y no se llenaba, asi
--          que TODA compra con cupon fallaba. Se graba el descuento otorgado.
--   COUPON_ID/CODE: orders tiene el CHECK orders_coupon_coherence_ck (ambos
--          null o ambos no-null) y la funcion no llenaba ninguno.
--   REINTENTO: cancelaba el pedido anterior CONSERVANDO su
--          checkout_session_token y luego insertaba otro con el MISMO token
--          contra el unique parcial orders_checkout_session_uq -> duplicate
--          key. Ahora al cancelar se LIBERA el token.
--
--   TOKEN ENVENENADO: solo la rama del reintento limpiaba el token. Si el
--          pedido lo cancelaba el admin, un barrido de vencidos o la app, el
--          token quedaba pegado a un pedido 'cancelado' y la guarda RCA03
--          disparaba para siempre: ese navegador no volvia a comprar nunca.
--          Ahora 'cancelado' cuenta como token reutilizable (5.2b).
--   RESERVA HUERFANA: el upsert de 5.8 solo tocaba las variantes del carrito
--          NUEVO, asi que un reintento que QUITA un producto dejaba viva su
--          reserva —mismo token, apuntando al pedido cancelado— restandole
--          stock a los demas compradores hasta que venciera el TTL. Con stock 1
--          un solo reintento volvia el producto invendible. Ahora 5.8 borra
--          primero las reservas del token que ya no estan en el carrito.
-- ============================================================================

create or replace function public.create_pending_order(
  p_email            text,
  p_items            jsonb,                  -- [{"product_id": uuid, "quantity": int}, ...]
  p_shipping_address jsonb,
  p_session_token    text,
  p_user_id          uuid default null,      -- null = compra como invitado
  p_payment_method   text default null,
  p_coupon_code      text default null
)
returns table (
  order_id     uuid,
  order_number text,
  total_cop    integer
)
language plpgsql
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_tax_bps        integer;
  v_flat_shipping  integer;
  v_free_threshold integer;
  v_ttl_minutes    integer;

  v_email          text;
  v_resolved       jsonb;
  v_lines          jsonb := '[]'::jsonb;
  v_variant_ids    uuid[];
  v_missing        uuid;

  v_item           record;
  v_row            record;

  v_available      integer;
  v_line_total     integer;

  v_subtotal       integer := 0;
  v_discount       integer := 0;
  v_shipping       integer := 0;
  v_shipping_waived integer := 0;  -- envio que perdono el cupon 'envio_gratis'
  v_tax            integer := 0;
  v_tax_base       integer := 0;
  v_total          integer := 0;

  v_has_coupon     boolean := false;
  v_free_shipping  boolean := false;
  v_coupon         record;
  v_coupon_id      uuid    := null;
  v_coupon_code    text    := null;
  v_coupon_base    integer := 0;
  v_used_total     integer;
  v_used_by_user   integer;

  v_previous       record;
  v_order_id       uuid;
  v_order_number   text;
begin
  ----------------------------------------------------------------------------
  -- 5.0  Entrada
  ----------------------------------------------------------------------------
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'El correo del comprador es obligatorio'
      using errcode = 'RCA05';
  end if;

  if p_session_token is null or btrim(p_session_token) = '' then
    raise exception 'Falta checkout_session_token: sin el no hay reservas ni reintento de checkout'
      using errcode = 'RCA05';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito viene vacio'
      using errcode = 'RCA05';
  end if;

  ----------------------------------------------------------------------------
  -- 5.1  Parametros de la tienda (BUG 1: fallar fuerte, no calcular $0)
  ----------------------------------------------------------------------------
  select s.tax_rate_bps,
         s.flat_shipping_cop,
         s.free_shipping_threshold_cop,
         s.reservation_ttl_minutes
    into v_tax_bps, v_flat_shipping, v_free_threshold, v_ttl_minutes
    from public.store_settings s
   where s.id
   limit 1;

  if not found
     or v_tax_bps is null
     or v_flat_shipping is null
     or v_free_threshold is null
     or v_ttl_minutes is null then
    raise exception
      'store_settings sin configurar (tax_rate_bps=%, flat_shipping_cop=%, free_shipping_threshold_cop=%, reservation_ttl_minutes=%). Corre el seed (0002_seed.sql o pnpm db:seed) antes de aceptar pedidos.',
      v_tax_bps, v_flat_shipping, v_free_threshold, v_ttl_minutes
      using errcode = 'RCA01';
  end if;

  -- PUNTOS BASICOS, no fraccion ni porcentaje: 1900 = 19%.
  if v_tax_bps < 0 or v_tax_bps > 10000 then
    raise exception
      'tax_rate_bps debe estar en puntos basicos entre 0 y 10000 (1900 = 19%%). Valor actual: %', v_tax_bps
      using errcode = 'RCA01';
  end if;

  if v_ttl_minutes <= 0 then
    raise exception 'reservation_ttl_minutes debe ser mayor que cero. Valor actual: %', v_ttl_minutes
      using errcode = 'RCA01';
  end if;

  ----------------------------------------------------------------------------
  -- 5.2  Agregacion por producto + variante por defecto (menor position)
  ----------------------------------------------------------------------------
  with entrada as (
    select (e->>'product_id')::uuid                    as product_id,
           coalesce((e->>'quantity')::integer, 0)      as quantity
      from jsonb_array_elements(p_items) as e
  ),
  agregado as (
    select product_id,
           sum(quantity)::integer as quantity
      from entrada
     where product_id is not null
     group by product_id
    having sum(quantity) > 0
  ),
  resuelto as (
    select a.product_id,
           a.quantity,
           v.id as variant_id
      from agregado a
      left join lateral (
        select pv.id
          from public.product_variants pv
         where pv.product_id = a.product_id
           and pv.is_active
         order by pv.position asc, pv.id asc
         limit 1
      ) v on true
  )
  select jsonb_agg(jsonb_build_object('product_id', product_id,
                                      'quantity',   quantity,
                                      'variant_id', variant_id)
                   order by variant_id)
    into v_resolved
    from resuelto;

  if v_resolved is null then
    raise exception 'El carrito no tiene lineas validas'
      using errcode = 'RCA05';
  end if;

  select (e->>'product_id')::uuid
    into v_missing
    from jsonb_array_elements(v_resolved) e
   where e->>'variant_id' is null
   limit 1;

  if v_missing is not null then
    raise exception 'El producto % no tiene ninguna variante activa', v_missing
      using errcode = 'RCA03';
  end if;

  ----------------------------------------------------------------------------
  -- 5.2b  PRIMER LOCK: el pedido anterior de este token  (orders)
  --
  -- ORDEN GLOBAL DE BLOQUEO (cabecera): orders ANTES que product_variants.
  -- Este bloque vivia en 5.7, DESPUES de bloquear las variantes, mientras
  -- fulfill_paid_order bloqueaba al reves. Dos conexiones en paralelo se
  -- abrazaban y Postgres mataba la transaccion del webhook. Sube aqui porque la
  -- busqueda solo depende de p_session_token y no necesita nada de 5.2/5.3.
  --
  -- REINTENTO DE CHECKOUT con el mismo token: el pedido anterior se cancela y
  -- se le QUITA el checkout_session_token — existe el unique parcial
  -- orders_checkout_session_uq y dejarselo hacia que el INSERT de 5.7 muriera
  -- con duplicate key. Las reservas no se tocan aqui: 5.8 reapunta las que
  -- siguen en el carrito y borra las que ya no estan.
  --
  -- 'cancelado' TAMBIEN libera el token (TOKEN ENVENENADO): da igual quien haya
  -- cancelado —el reintento, el admin, un barrido de vencidos o la app—; un
  -- pedido cancelado no puede secuestrar para siempre la sesion del navegador.
  -- Lo unico que sigue prohibido es reusar el token de un pedido que ya avanzo
  -- (pagado, enviado...): eso seria cobrar dos veces la misma sesion.
  ----------------------------------------------------------------------------
  select o.id, o.status
    into v_previous
    from public.orders o
   where o.checkout_session_token = p_session_token
   limit 1
     for update;

  if found then
    if v_previous.status in ('pendiente', 'cancelado') then
      update public.orders o
         set status                 = case when o.status = 'pendiente'
                                           then 'cancelado'::order_status
                                           else o.status end,
             cancelled_at           = coalesce(o.cancelled_at, now()),
             checkout_session_token = null
       where o.id = v_previous.id;
    else
      raise exception
        'La sesion de checkout % ya tiene el pedido % en estado %; pide un token nuevo',
        p_session_token, v_previous.id, v_previous.status
        using errcode = 'RCA03';
    end if;
  end if;

  ----------------------------------------------------------------------------
  -- 5.3  BLOQUEO ORDENADO POR id  <-- anti-deadlock, no tocar el ORDER BY
  ----------------------------------------------------------------------------
  select array_agg((e->>'variant_id')::uuid order by (e->>'variant_id')::uuid)
    into v_variant_ids
    from jsonb_array_elements(v_resolved) e;

  perform 1
     from public.product_variants pv
    where pv.id = any(v_variant_ids)
    order by pv.id
      for update;

  ----------------------------------------------------------------------------
  -- 5.4  Re-lectura de precios YA CON EL LOCK + validacion de stock
  ----------------------------------------------------------------------------
  for v_item in
    select (e->>'variant_id')::uuid    as variant_id,
           (e->>'quantity')::integer   as quantity
      from jsonb_array_elements(v_resolved) e
     order by 1
  loop
    select pv.id,
           pv.product_id,
           pv.name       as variant_name,
           pv.sku        as sku,
           pv.price_cop  as price_cop,
           pv.is_active  as is_active,
           p.name        as product_name,
           p.status      as product_status,
           p.category_id as category_id
      into v_row
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
     where pv.id = v_item.variant_id;

    if not found then
      raise exception 'La variante % ya no existe', v_item.variant_id
        using errcode = 'RCA03';
    end if;

    if not v_row.is_active or v_row.product_status <> 'activo' then
      raise exception 'El producto "%" ya no esta disponible', v_row.product_name
        using errcode = 'RCA03';
    end if;

    if v_row.price_cop is null or v_row.price_cop <= 0 then
      raise exception 'El producto "%" no tiene precio valido', v_row.product_name
        using errcode = 'RCA03';
    end if;

    -- BUG 4: se excluye la reserva del propio solicitante.
    v_available := public.available_stock(v_item.variant_id, p_session_token);
    if v_available < v_item.quantity then
      raise exception 'Stock insuficiente de "%": disponibles %, solicitadas %',
        v_row.product_name, v_available, v_item.quantity
        using errcode = 'RCA02';
    end if;

    v_line_total := v_row.price_cop * v_item.quantity;
    v_subtotal   := v_subtotal + v_line_total;

    v_lines := v_lines || jsonb_build_object(
      'variant_id',     v_item.variant_id,
      'product_id',     v_row.product_id,
      'category_id',    v_row.category_id,
      'product_name',   v_row.product_name,
      'variant_name',   v_row.variant_name,
      'sku',            v_row.sku,
      'unit_price_cop', v_row.price_cop,
      'quantity',       v_item.quantity,
      'line_total_cop', v_line_total
    );
  end loop;

  ----------------------------------------------------------------------------
  -- 5.5  Cupon (BUG 3: en el original discount_cop iba fijo en 0)
  --
  -- El FOR UPDATE sobre la fila del cupon serializa a dos compradores que
  -- corren por el ultimo uso disponible; el conteo posterior ya ve lo que
  -- comiteo el otro. Los usos NO se leen del contador denormalizado
  -- coupons.times_redeemed: se cuentan las redenciones cuyo pedido no esta
  -- cancelado, asi cancelar un pedido libera el uso solo.
  ----------------------------------------------------------------------------
  if p_coupon_code is not null and btrim(p_coupon_code) <> '' then
    select c.*
      into v_coupon
      from public.coupons c
     where upper(c.code) = upper(btrim(p_coupon_code))
       for update;

    if not found then
      raise exception 'El cupon "%" no existe', btrim(p_coupon_code)
        using errcode = 'RCA04';
    end if;

    v_has_coupon  := true;
    v_coupon_id   := v_coupon.id;
    -- Snapshot del codigo CANONICO (el de la tabla), no el que tecleo el
    -- cliente: el cupon puede renombrarse o borrarse despues.
    v_coupon_code := v_coupon.code;

    if not coalesce(v_coupon.is_active, false) then
      raise exception 'El cupon "%" esta desactivado', v_coupon.code
        using errcode = 'RCA04';
    end if;

    if v_coupon.starts_at is not null and v_coupon.starts_at > now() then
      raise exception 'El cupon "%" todavia no esta vigente', v_coupon.code
        using errcode = 'RCA04';
    end if;

    if v_coupon.ends_at is not null and v_coupon.ends_at <= now() then
      raise exception 'El cupon "%" ya vencio', v_coupon.code
        using errcode = 'RCA04';
    end if;

    if coalesce(v_coupon.min_subtotal_cop, 0) > v_subtotal then
      raise exception 'El cupon "%" exige un subtotal minimo de % COP',
        v_coupon.code, v_coupon.min_subtotal_cop
        using errcode = 'RCA04';
    end if;

    -- schema: usage_limit / usage_limit_per_user (antes max_redemptions*).
    if v_coupon.usage_limit is not null then
      select count(*)::integer
        into v_used_total
        from public.coupon_redemptions cr
        join public.orders o on o.id = cr.order_id
       where cr.coupon_id = v_coupon.id
         and o.status <> 'cancelado';

      if v_used_total >= v_coupon.usage_limit then
        raise exception 'El cupon "%" agoto sus % usos', v_coupon.code, v_coupon.usage_limit
          using errcode = 'RCA04';
      end if;
    end if;

    if v_coupon.usage_limit_per_user is not null then
      select count(*)::integer
        into v_used_by_user
        from public.coupon_redemptions cr
        join public.orders o on o.id = cr.order_id
       where cr.coupon_id = v_coupon.id
         and o.status <> 'cancelado'
         and (o.email = v_email
              or (p_user_id is not null and cr.user_id = p_user_id));

      if v_used_by_user >= v_coupon.usage_limit_per_user then
        raise exception 'Ya usaste el cupon "%" el maximo de veces permitido', v_coupon.code
          using errcode = 'RCA04';
      end if;
    end if;

    -- Base sobre la que aplica el descuento, segun el alcance.
    if v_coupon.scope = 'orden' then
      v_coupon_base := v_subtotal;

    elsif v_coupon.scope = 'categoria' then
      select coalesce(sum((l->>'line_total_cop')::integer), 0)
        into v_coupon_base
        from jsonb_array_elements(v_lines) l
       where exists (select 1
                       from public.coupon_categories cc
                      where cc.coupon_id = v_coupon.id
                        and cc.category_id = (l->>'category_id')::uuid);

    elsif v_coupon.scope = 'producto' then
      select coalesce(sum((l->>'line_total_cop')::integer), 0)
        into v_coupon_base
        from jsonb_array_elements(v_lines) l
       where exists (select 1
                       from public.coupon_products cp
                      where cp.coupon_id = v_coupon.id
                        and cp.product_id = (l->>'product_id')::uuid);
    end if;

    if v_coupon.type <> 'envio_gratis' and v_coupon_base = 0 then
      raise exception 'El cupon "%" no aplica a ningun producto del carrito', v_coupon.code
        using errcode = 'RCA04';
    end if;

    if v_coupon.type = 'envio_gratis' then
      v_free_shipping := true;
      v_discount      := 0;

    elsif v_coupon.type = 'porcentaje' then
      -- `value` esta en PUNTOS BASICOS: 1000 = 10%. Dividir por 10000, NO por
      -- 100. Con /100 un cupon del 10% descontaba el 100% del carrito.
      v_discount := round(v_coupon_base::numeric * v_coupon.value::numeric / 10000.0)::integer;

    elsif v_coupon.type = 'monto_fijo' then
      v_discount := least(v_coupon.value::integer, v_coupon_base);
    end if;

    -- Tope de descuento (columna max_discount_cop; el original la ignoraba).
    if v_coupon.max_discount_cop is not null then
      v_discount := least(v_discount, v_coupon.max_discount_cop);
    end if;

    -- orders_discount_lte_subtotal_ck: nunca mas que el subtotal, nunca < 0.
    v_discount := least(greatest(v_discount, 0), v_subtotal);
  end if;

  ----------------------------------------------------------------------------
  -- 5.6  Envio e IVA
  ----------------------------------------------------------------------------
  -- El umbral de envio gratis se mide sobre el subtotal YA con descuento.
  -- El orden de las ramas importa: si el umbral ya daba envio gratis, el cupon
  -- 'envio_gratis' no perdono NADA y su redencion vale 0. Solo cuando el envio
  -- se iba a cobrar de verdad, lo perdonado es v_flat_shipping.
  if (v_subtotal - v_discount) >= v_free_threshold then
    v_shipping        := 0;
    v_shipping_waived := 0;
  elsif v_free_shipping then
    v_shipping        := 0;
    v_shipping_waived := v_flat_shipping;
  else
    v_shipping        := v_flat_shipping;
    v_shipping_waived := 0;
  end if;

  v_total := v_subtotal - v_discount + v_shipping;

  -- IVA INCLUIDO, en puntos basicos. Se DESPEJA del total, no se suma encima:
  --   base = round(total * 10000 / (10000 + bps))
  --   iva  = total - base
  -- Restar en vez de redondear los dos lados garantiza base + iva = total
  -- exacto, sin el peso de diferencia que aparece al redondear por separado.
  v_tax_base := round(v_total::numeric * 10000.0 / (10000.0 + v_tax_bps))::integer;
  v_tax      := v_total - v_tax_base;

  ----------------------------------------------------------------------------
  -- 5.7  Pedido
  --
  -- El pedido anterior de este token ya se cancelo y solto el token en 5.2b
  -- (arriba), que es donde se toma el PRIMER lock. Aqui solo queda insertar.
  ----------------------------------------------------------------------------
  insert into public.orders (
    user_id, email, status,
    subtotal_cop, discount_cop, shipping_cop, tax_included_cop, total_cop,
    coupon_id, coupon_code,
    shipping_address, checkout_session_token, payment_method
  ) values (
    p_user_id, v_email, 'pendiente',
    v_subtotal, v_discount, v_shipping, v_tax, v_total,
    v_coupon_id, v_coupon_code,
    p_shipping_address, p_session_token, p_payment_method   -- BUG 2
  )
  returning id, order_number
       into v_order_id, v_order_number;

  ----------------------------------------------------------------------------
  -- 5.8  Items + reservas (en orden de variant_id, misma disciplina de lock)
  ----------------------------------------------------------------------------
  -- RESERVA HUERFANA: el upsert de abajo solo toca las variantes del carrito
  -- NUEVO. Si el reintento QUITA un producto, su reserva sobrevivia con el
  -- mismo session_token apuntando al pedido ya cancelado y le seguia restando
  -- stock a los demas compradores hasta que venciera el TTL (con stock 1, un
  -- solo reintento dejaba el producto invendible durante 15 minutos).
  -- v_variant_ids es exactamente el carrito nuevo, calculado en 5.3.
  delete from public.inventory_reservations r
   where r.session_token = p_session_token
     and r.variant_id <> all (v_variant_ids);

  for v_item in
    select (l->>'variant_id')::uuid       as variant_id,
           (l->>'product_id')::uuid       as product_id,
           l->>'product_name'             as product_name,
           l->>'variant_name'             as variant_name,
           l->>'sku'                      as sku,
           (l->>'unit_price_cop')::integer as unit_price_cop,
           (l->>'quantity')::integer      as quantity
      from jsonb_array_elements(v_lines) l
     order by 1
  loop
    insert into public.order_items (
      order_id, product_id, variant_id,
      product_name, variant_name, sku,
      unit_price_cop, quantity
    ) values (
      v_order_id, v_item.product_id, v_item.variant_id,
      v_item.product_name, v_item.variant_name, v_item.sku,
      v_item.unit_price_cop, v_item.quantity
    );

    -- BUG 7: el TTL sale de store_settings.
    insert into public.inventory_reservations (
      variant_id, session_token, order_id, quantity, expires_at
    ) values (
      v_item.variant_id, p_session_token, v_order_id, v_item.quantity,
      now() + make_interval(mins => v_ttl_minutes)
    )
    on conflict (variant_id, session_token) do update
       set quantity   = excluded.quantity,
           expires_at = excluded.expires_at,
           order_id   = excluded.order_id;
  end loop;

  -- coupon_redemptions.amount_cop es NOT NULL sin default: sin este valor toda
  -- compra con cupon fallaba.
  --
  -- UNA SOLA VERDAD (el schema y la funcion decian cosas distintas: el schema
  -- documentaba "lo que el cupon le costo a la tienda, incluido el envio
  -- perdonado" y la funcion grababa 0 para 'envio_gratis'). Manda el schema,
  -- porque es la definicion util: amount_cop responde "cuanta plata concedio
  -- este cupon", y para un envio gratis eso es el valor de flat_shipping_cop, no 0.
  --
  --   amount_cop = discount_cop  +  envio perdonado por el cupon
  --
  -- Para 'porcentaje' y 'monto_fijo' el segundo sumando es 0 y amount_cop sigue
  -- siendo exactamente orders.discount_cop. Para 'envio_gratis' el primero es 0.
  -- Si el pedido ya superaba el umbral de envio gratis, el cupon no concedio
  -- nada y amount_cop queda en 0, que es la verdad.
  if v_has_coupon then
    insert into public.coupon_redemptions (coupon_id, order_id, user_id, amount_cop)
    values (v_coupon.id, v_order_id, p_user_id, v_discount + v_shipping_waived);

    -- Contador DENORMALIZADO, solo para listados del admin. Sube y no baja al
    -- cancelar, asi que puede quedar por encima de la realidad: los LIMITES de
    -- uso NO se validan con el (arriba se cuentan las redenciones cuyo pedido
    -- no esta cancelado, que es la verdad).
    update public.coupons c
       set times_redeemed = c.times_redeemed + 1
     where c.id = v_coupon.id;
  end if;

  return query select v_order_id, v_order_number, v_total;
end;
$fn$;
--> statement-breakpoint


-- ============================================================================
-- 6. fulfill_paid_order(...)
--
-- Punto de entrada del webhook de la pasarela. Idempotente.
--
-- ----------------------------------------------------------------------------
-- DOS IDs DISTINTOS (el original los confundia)
-- ----------------------------------------------------------------------------
-- Wompi manda VARIOS eventos por una misma transaccion. El schema ya los
-- separa y esta funcion tambien:
--   p_event_external_id       -> payment_events.external_id  (ID DEL EVENTO)
--                                unique (gateway, external_id) = idempotencia
--   p_transaction_external_id -> payments.external_id        (ID DE LA TRANSACCION)
--                                unique (gateway, external_id) = un cobro, una fila
-- Usar el mismo valor para los dos, como hacia el original, significaba que el
-- segundo evento de la misma transaccion pasaba la guardia de idempotencia y
-- despues chocaba contra el unique de payments.
--
-- ----------------------------------------------------------------------------
-- POR QUE NO SE PIERDE NI SE DUPLICA UN PAGO
-- ----------------------------------------------------------------------------
--   (a) Una funcion plpgsql corre entera dentro de UNA transaccion. Si el
--       proceso muere en cualquier punto, se revierte TODO: no queda ni la fila
--       de payment_events, ni el pago, ni el cambio de estado. El reintento del
--       webhook entra otra vez por la puerta de adelante y hace el trabajo
--       completo. No existe el estado "evento marcado / pedido sin pagar".
--   (b) Concurrencia: el INSERT ... ON CONFLICT DO NOTHING sobre
--       (gateway, external_id) de payment_events hace de mutex.
--   (c) Auto-reparacion: una fila comiteada con processed_at NULL se toma con
--       FOR UPDATE y se COMPLETA, en vez de descartarla.
--   (d) processed_at se escribe en la ULTIMA sentencia, y processing_started_at
--       al TOMAR el evento. El CHECK payment_events_order_ck exige ese orden
--       (no se puede terminar lo que no se empezo) y la version anterior lo
--       violaba: marcaba processed_at con processing_started_at en null, asi
--       que el webhook entero reventaba y NINGUN pago se registraba nunca.
--   (e) El INSERT en payments es un UPSERT por (gateway, external_id): el
--       segundo evento de la misma transaccion actualiza la fila, no la duplica
--       ni revienta contra el unique.
--   (f) Ese unique es PARCIAL (where external_id is not null), asi que sin id
--       de transaccion no hay idempotencia posible: se exige a la entrada con
--       RCA05, junto al id del evento.
--   (g) Un pago ya aprobado congela monto y evidencia: un evento posterior
--       puede cambiarle el estado (reembolso), nunca reescribir cuanto se
--       cobro.
--
-- ----------------------------------------------------------------------------
-- PAGOS ANOMALOS — decision explicita (antes se perdian en silencio)
-- ----------------------------------------------------------------------------
-- Un pago puede llegar para un pedido que NO puede recibirlo:
--   * el pedido esta 'cancelado' o 'reembolsado' y llega un 'aprobado';
--   * el pedido YA ESTABA PAGADO (o enviado, o entregado) y llega OTRA
--     transaccion aprobada -> SEGUNDO COBRO: se registra, no se aplica, y
--     alguien tiene que reembolsar una de las dos;
--   * la transaccion YA PERTENECE A OTRO PEDIDO -> no se reasigna: reasignarla
--     le borraria el pago al primero y dejaria a los dos mal;
--   * la pasarela NO REPORTO MONTO -> no hay forma de confirmar que se cobro el
--     total; el pago se registra con el total como placeholder y el pedido no
--     avanza;
--   * el monto reportado por la pasarela != total del pedido;
--   * el monto reportado no es positivo.
--
-- Y por debajo de todas, el invariante que no depende de haber previsto el
-- caso: un pedido NO pasa a 'pagado' sin una fila de payments APROBADA Y SUYA.
--
-- La version anterior tenia lo peor de los dos mundos: con el pedido cancelado
-- registraba el pago, marcaba el evento como procesado y devolvia SIN ERROR
-- (plata cobrada, pedido cancelado, nadie se entera); y con el descuadre de
-- monto lanzaba excepcion, lo que revertia TAMBIEN el registro del pago y
-- dejaba a la pasarela reintentando en bucle sin dejar rastro en la base.
--
-- Politica unica ahora, para los tres casos:
--   1. El pago SE REGISTRA (es plata que ya se movio; no se puede "no verla").
--   2. El pedido NO cambia de estado.
--   3. El evento se marca como procesado y su motivo queda en
--      payment_events.last_error -> la pasarela deja de reintentar y el caso
--      aparece en la bandeja de revision del admin
--      (select * from payment_events where last_error is not null).
--   4. Se devuelve needs_review = true y review_reason con el texto. NO es un
--      exito silencioso: el route handler debe responder 200 a la pasarela
--      (el evento SI se recibio) y disparar la alerta a operaciones.
--   5. Se emite un RAISE WARNING para que quede en el log de Postgres.
-- Un reintento del mismo evento vuelve a devolver needs_review = true, porque
-- la razon vive en la fila de payment_events y no en memoria.
--
-- La sobreventa detectada al descontar stock tambien marca needs_review, pero
-- NO bloquea: ahi el pago si se aplica y el pedido pasa a 'pagado'.
-- ============================================================================

-- La firma cambio (se separo el id del evento del id de la transaccion). Sin
-- este drop, `create or replace` dejaria las DOS versiones como sobrecargas y
-- una llamada por nombre quedaria ambigua.
drop function if exists public.fulfill_paid_order(payment_gateway, text, text, payment_status, integer, jsonb);
--> statement-breakpoint

-- p_status y p_amount_cop YA NO TIENEN DEFAULT, a proposito:
--   * p_amount_cop default null hacia que "la pasarela no reporto monto" fuera
--     indistinguible de "el que llama no lo paso". La funcion se inventaba el
--     monto con coalesce(p_amount_cop, v_total) y grababa un pago aprobado por
--     exactamente el total, sin ninguna alerta: los libros afirmaban un cobro
--     que nadie confirmo. Ahora el monto es obligatorio en la llamada y, si
--     llega null, el pago va a revision (6.3).
--   * p_status pierde el default por imposicion de Postgres —despues de un
--     parametro con default todos deben tenerlo— y por higiene: el estado lo
--     dice la pasarela, no lo supone la base.
create or replace function public.fulfill_paid_order(
  p_gateway                 payment_gateway,
  p_event_external_id       text,                              -- ID DEL EVENTO       -> payment_events
  p_transaction_external_id text,                              -- ID DE LA TRANSACCION -> payments
  p_order_reference         text,                              -- order_number o id del pedido
  p_status                  payment_status,
  p_amount_cop              integer,
  p_payload                 jsonb          default '{}'::jsonb,
  p_event_type              text           default null
)
returns table (
  order_id          uuid,
  new_status        order_status,
  already_processed boolean,
  needs_review      boolean,
  review_reason     text
)
language plpgsql
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_event_id     uuid;
  v_processed_at timestamptz;
  v_last_error   text;

  v_order_id     uuid;
  v_order_status order_status;
  v_total        integer;
  v_token        text;
  v_amount       integer;
  v_oversold     integer := 0;

  v_txn_id       text;    -- id de la TRANSACCION, ya normalizado
  v_txn_order    uuid;    -- pedido al que YA pertenece esa transaccion (si existe)

  v_review       text    := null;  -- motivo de revision manual (null = todo bien)
  v_blocked      boolean := false; -- true = el pago no se puede aplicar al pedido
begin
  if p_event_external_id is null or btrim(p_event_external_id) = '' then
    raise exception 'external_id del EVENTO es obligatorio (es la llave de idempotencia)'
      using errcode = 'RCA05';
  end if;

  -- El unique de payments es PARCIAL (where external_id is not null). Con el id
  -- de transaccion en null o vacio la fila no entra en el indice, el ON CONFLICT
  -- de 6.4 no dispara y CADA evento inserta otra fila de cobro: tres reenvios
  -- del mismo webhook = tres pagos aprobados. Se valida a la entrada, igual que
  -- el id del evento, y se rechaza antes de tocar nada.
  v_txn_id := nullif(btrim(coalesce(p_transaction_external_id, '')), '');

  if v_txn_id is null then
    raise exception
      'external_id de la TRANSACCION es obligatorio: sin el, payments no tiene llave de idempotencia y cada evento crea otra fila de cobro'
      using errcode = 'RCA05';
  end if;

  ----------------------------------------------------------------------------
  -- 6.1  Guardia de idempotencia + claim del evento
  --      processing_started_at se marca AQUI porque el CHECK
  --      payment_events_order_ck exige que processed_at (6.6) llegue despues.
  ----------------------------------------------------------------------------
  insert into public.payment_events (
    gateway, external_id, event_type, payload, processing_started_at, attempts
  )
  values (
    p_gateway,
    p_event_external_id,
    nullif(btrim(coalesce(p_event_type, '')), ''),
    coalesce(p_payload, '{}'::jsonb),
    now(),
    1
  )
  on conflict (gateway, external_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select pe.id, pe.processed_at, pe.last_error
      into v_event_id, v_processed_at, v_last_error
      from public.payment_events pe
     where pe.gateway = p_gateway
       and pe.external_id = p_event_external_id
       for update;

    if v_event_id is null then
      -- El otro intento aborto justo entre el insert y el select.
      raise exception 'Carrera registrando el evento %/%: reintentar', p_gateway, p_event_external_id
        using errcode = 'RCA06';
    end if;

    if v_processed_at is not null then
      select o.id, o.status
        into v_order_id, v_order_status
        from public.orders o
       where o.order_number = p_order_reference
          or o.id::text = p_order_reference
       limit 1;

      -- Si el evento quedo marcado para revision, el reintento lo vuelve a
      -- decir: la razon vive en la fila, no en memoria.
      return query select v_order_id, v_order_status, true,
                          v_last_error is not null, v_last_error;
      return;
    end if;

    -- Evento comiteado sin procesar (o rescate de uno colgado): se re-toma y
    -- se completa el trabajo.
    update public.payment_events pe
       set processing_started_at = coalesce(pe.processing_started_at, now()),
           attempts              = pe.attempts + 1
     where pe.id = v_event_id;
  end if;

  ----------------------------------------------------------------------------
  -- 6.2  Pedido bloqueado
  ----------------------------------------------------------------------------
  select o.id, o.status, o.total_cop, o.checkout_session_token
    into v_order_id, v_order_status, v_total, v_token
    from public.orders o
   where o.order_number = p_order_reference
      or o.id::text = p_order_reference
   limit 1
     for update;

  if v_order_id is null then
    -- Sin pedido no hay a que aplicar el pago NI donde dejar rastro util: se
    -- revierte todo (incluido el evento) para que la pasarela reintente y el
    -- fallo quede visible en los logs.
    raise exception 'No existe pedido con referencia "%"', p_order_reference
      using errcode = 'RCA03';
  end if;

  ----------------------------------------------------------------------------
  -- 6.2b  ¿De quien es esta transaccion?  (lock de payments, DESPUES de orders)
  --
  -- El upsert de 6.4 arbitra por (gateway, external_id) GLOBAL y su DO UPDATE
  -- no toca order_id. Si la MISMA transaccion se reporta contra dos pedidos
  -- distintos, el segundo evento actualizaba la fila del PRIMER pedido y el
  -- segundo quedaba 'pagado' con CERO filas en payments, descontando stock y
  -- devolviendo needs_review = false: una sola transaccion de $74.000
  -- despachaba $148.000 en producto.
  --
  -- Se mira antes de escribir, con la fila bloqueada. Si la transaccion ya es
  -- de otro pedido, no se reasigna (eso le borraria el pago al primero) ni se
  -- aplica a este: va a la bandeja de revision.
  ----------------------------------------------------------------------------
  select p.order_id
    into v_txn_order
    from public.payments p
   where p.gateway = p_gateway
     and p.external_id = v_txn_id
     for update;

  if v_txn_order is not null and v_txn_order <> v_order_id then
    v_blocked := true;
    v_review  := concat_ws(' ', v_review, format(
      'TRANSACCION %s YA REGISTRADA EN EL PEDIDO %s: no se reasigna ni se aplica a %s.',
      v_txn_id, v_txn_order, p_order_reference));
  end if;

  ----------------------------------------------------------------------------
  -- 6.3  Deteccion de anomalias (ver "PAGOS ANOMALOS" arriba)
  ----------------------------------------------------------------------------
  -- Sin monto reportado no hay verificacion posible. Antes coalesce() lo
  -- rellenaba con el total del pedido y la guarda de descuadre estaba
  -- condicionada a p_amount_cop is not null, asi que un webhook sin monto
  -- pasaba entero: pedido 'pagado', pago aprobado por el total exacto,
  -- needs_review = false. El pago SI se registra (es plata que se movio y no se
  -- puede "no ver"), pero con el total como PLACEHOLDER y el pedido sin avanzar.
  if p_status = 'aprobado' and p_amount_cop is null then
    v_blocked := true;
    v_review  := concat_ws(' ', v_review, format(
      'LA PASARELA NO REPORTO MONTO para el pedido %s: no se puede confirmar que se cobro el total (%s COP).',
      p_order_reference, v_total));
  end if;

  v_amount := coalesce(p_amount_cop, v_total);

  if p_amount_cop is not null and p_amount_cop <> v_total then
    v_blocked := true;
    v_review  := concat_ws(' ', v_review, format(
      'DESCUADRE DE MONTO: %s reporto %s COP y el pedido %s vale %s COP.',
      p_gateway, p_amount_cop, p_order_reference, v_total));
  end if;

  if p_status = 'aprobado' and v_order_status in ('cancelado', 'reembolsado') then
    v_blocked := true;
    v_review  := concat_ws(' ', v_review, format(
      'PAGO APROBADO SOBRE PEDIDO %s: el pedido %s no cambia de estado y nadie lo va a despachar hasta que operaciones lo resuelva (reembolsar o reabrir).',
      upper(v_order_status::text), p_order_reference));
  end if;

  -- SEGUNDO COBRO. La guarda de arriba solo miraba 'cancelado' y 'reembolsado':
  -- si el pedido ya estaba 'pagado' (o enviado, o entregado) y llegaba OTRA
  -- transaccion aprobada, entraba entera —segunda fila en payments, sum del
  -- doble del pedido— y devolvia needs_review = false con last_error null. Es
  -- el cliente que reintenta el link de pago porque la interfaz le dio timeout:
  -- se le cobraba dos veces y nadie se enteraba nunca.
  --
  -- El `not exists` deja pasar el caso legitimo: un segundo evento de la MISMA
  -- transaccion (la pasarela manda varios), que solo hace upsert sobre su fila.
  if p_status = 'aprobado'
     and v_order_status not in ('pendiente', 'cancelado', 'reembolsado')
     and not exists (
       select 1
         from public.payments p
        where p.order_id = v_order_id
          and p.gateway  = p_gateway
          and p.external_id is not distinct from v_txn_id)
  then
    v_blocked := true;
    v_review  := concat_ws(' ', v_review, format(
      'SEGUNDO COBRO: el pedido %s ya estaba en %s y llega OTRA transaccion aprobada (%s). No se aplica al pedido; hay que reembolsar una.',
      p_order_reference, v_order_status, v_txn_id));
  end if;

  if v_amount <= 0 then
    v_blocked := true;
    v_review  := concat_ws(' ', v_review, format(
      'MONTO NO POSITIVO (%s COP) para el pedido %s.', v_amount, p_order_reference));
  end if;

  ----------------------------------------------------------------------------
  -- 6.4  Registro del pago  (UPSERT: varios eventos, una sola transaccion)
  ----------------------------------------------------------------------------
  -- La transaccion solo se escribe si es de ESTE pedido (o si es nueva). Si ya
  -- pertenece a otro, tocarla le borraria el pago al primer pedido.
  if v_amount > 0 and (v_txn_order is null or v_txn_order = v_order_id) then
    insert into public.payments (
      order_id, gateway, status, amount_cop,
      external_id, external_reference, raw_response, paid_at
    )
    values (
      v_order_id, p_gateway, p_status, v_amount,
      v_txn_id,
      p_order_reference,
      coalesce(p_payload, '{}'::jsonb),
      case when p_status = 'aprobado' then now() else null end
    )
    on conflict (gateway, external_id) where external_id is not null
    do update set
      -- Un pago aprobado NUNCA retrocede a rechazado por un evento que llegue
      -- fuera de orden. Cualquier otra transicion si se refleja (un reembolso
      -- posterior sobre la misma transaccion es legitimo).
      status             = case when payments.status = 'aprobado'
                                 and excluded.status = 'rechazado'
                                then payments.status
                                else excluded.status end,
      -- EVENTO FUERA DE ORDEN: el status estaba protegido pero el monto no.
      -- Con 'aprobado 74.000' seguido de 'rechazado 30.000' de la MISMA
      -- transaccion, la fila quedaba aprobada, con paid_at, y afirmando 30.000:
      -- 44.000 cobrados que la tabla negaba, con el status intacto para que
      -- nada lo delatara. Un cobro aprobado congela su monto.
      amount_cop         = case when payments.status = 'aprobado'
                                then payments.amount_cop
                                else excluded.amount_cop end,
      -- Misma logica para la EVIDENCIA: raw_response y la referencia enviada
      -- son la prueba de una disputa y se sobreescribian con el ultimo evento.
      -- El historico completo evento por evento vive en payment_events.payload,
      -- asi que congelar aqui no pierde informacion.
      external_reference = case when payments.status = 'aprobado'
                                then payments.external_reference
                                else excluded.external_reference end,
      raw_response       = case when payments.status = 'aprobado'
                                then payments.raw_response
                                else excluded.raw_response end,
      paid_at            = coalesce(payments.paid_at, excluded.paid_at)
    -- ARMADURA CONTRA LA CARRERA: dos eventos de la misma transaccion nueva
    -- contra pedidos distintos entran los dos con v_txn_order null (ninguno ve
    -- la fila del otro sin comitear) y el segundo cae aqui por el unique. Sin
    -- este WHERE le reasignaria el pago al otro pedido. Con el, el UPDATE no
    -- afecta filas y el invariante de 6.5 manda el caso a revision.
    where payments.order_id = excluded.order_id;
  end if;

  ----------------------------------------------------------------------------
  -- 6.5  Transicion del pedido (solo si el pago SI se puede aplicar)
  ----------------------------------------------------------------------------
  if v_blocked then
    raise warning 'Pedido % / evento %: %', p_order_reference, p_event_external_id, v_review;

  elsif p_status = 'aprobado' and not exists (
          select 1
            from public.payments p
           where p.order_id = v_order_id
             and p.status   = 'aprobado') then

    -- INVARIANTE DE FONDO: un pedido NO pasa a 'pagado' si no existe una fila
    -- de payments aprobada PARA ESE PEDIDO. Es la red que atrapa cualquier
    -- camino —conocido o no— por el que el registro del pago no haya quedado
    -- donde debia: pedido 'pagado' con cero pagos es exactamente el estado que
    -- despacho producto sin haber cobrado.
    v_review := concat_ws(' ', v_review, format(
      'SIN PAGO PROPIO REGISTRADO: no hay ninguna fila de payments aprobada para el pedido %s (transaccion %s). NO se marca como pagado ni se descuenta stock.',
      p_order_reference, v_txn_id));
    raise warning 'Pedido % / evento %: %', p_order_reference, p_event_external_id, v_review;

  elsif p_status = 'aprobado' then

    if v_order_status = 'pendiente' then
      -- Mismo bloqueo ordenado por id que en create_pending_order.
      perform 1
         from public.product_variants pv
        where pv.id in (select oi.variant_id
                          from public.order_items oi
                         where oi.order_id = v_order_id
                           and oi.variant_id is not null)
        order by pv.id
          for update;

      select count(*)::integer
        into v_oversold
        from public.product_variants pv
        join (select oi.variant_id, sum(oi.quantity)::integer as quantity
                from public.order_items oi
               where oi.order_id = v_order_id
                 and oi.variant_id is not null
               group by oi.variant_id) agg
          on agg.variant_id = pv.id
       where pv.stock < agg.quantity;

      if v_oversold > 0 then
        -- El pago ya se cobro: no se puede abortar. Se deja el stock en 0, el
        -- pedido SI pasa a pagado (la plata entro) y se marca para revision.
        v_review := concat_ws(' ', v_review, format(
          'SOBREVENTA: %s variante(s) del pedido %s quedaron con stock 0; hay que reponer o avisar al cliente.',
          v_oversold, p_order_reference));
        raise warning 'Pedido %: % variante(s) sobrevendida(s), su stock queda en 0',
          p_order_reference, v_oversold;
      end if;

      update public.product_variants pv
         set stock = greatest(pv.stock - agg.quantity, 0)
        from (select oi.variant_id, sum(oi.quantity)::integer as quantity
                from public.order_items oi
               where oi.order_id = v_order_id
                 and oi.variant_id is not null
               group by oi.variant_id) agg
       where pv.id = agg.variant_id;

      -- orders_paid_at_ck: 'pagado' sin paid_at viola el CHECK y tumbaba el
      -- webhook entero, asi que ningun pago llegaba a registrarse nunca.
      update public.orders o
         set status  = 'pagado',
             paid_at = coalesce(o.paid_at, now())
       where o.id = v_order_id;

      v_order_status := 'pagado';
    end if;

    -- El stock ya se descontó de verdad: la reserva sobra.
    perform public.release_reservations(v_token);

  elsif p_status = 'rechazado' then
    -- El pedido queda 'pendiente' para que el cliente reintente, pero se
    -- sueltan las unidades para no bloquear inventario.
    perform public.release_reservations(v_token);

  elsif p_status = 'reembolsado' then
    if v_order_status in ('pagado', 'en_preparacion', 'enviado', 'entregado') then
      update public.orders o
         set status = 'reembolsado'
       where o.id = v_order_id;
      v_order_status := 'reembolsado';
    end if;
    -- El stock NO se devuelve automaticamente: un reembolso no siempre
    -- significa producto reutilizable. Si hay que reponerlo, se hace
    -- desde el admin.

  end if;

  ----------------------------------------------------------------------------
  -- 6.6  AL FINAL: marcar el evento como procesado (BUG 5)
  ----------------------------------------------------------------------------
  update public.payment_events pe
     set processed_at = now(),
         last_error   = v_review     -- null = nada que revisar
   where pe.id = v_event_id;

  return query select v_order_id, v_order_status, false,
                      v_review is not null, v_review;
end;
$fn$;
--> statement-breakpoint


-- ============================================================================
-- 7. Triggers de proteccion, reescritos sin auth.uid()
--
-- El actor se declara en la variable de sesion `app.user_id`.
--
-- RIESGOS DE ESTA ELECCION — leerlos antes de confiar en el mecanismo:
--
--  1. NO ES UN LIMITE DE SEGURIDAD. La misma conexion que ejecuta el UPDATE es
--     la que declara quien es el actor: cualquier codigo con acceso a la
--     conexion puede poner el uuid que quiera. Esto atrapa BUGS de la
--     aplicacion —el caso tipico: un PATCH /api/mi-cuenta que reenvia el body
--     completo del formulario e incluye "role"— y no atrapa a un atacante que
--     ya ejecuta SQL arbitrario. Con auth.uid() de Supabase el valor lo firmaba
--     el JWT y el usuario no podia falsificarlo; aqui no. La autorizacion de
--     verdad sigue viviendo en los route handlers.
--
--  2. FUGA ENTRE PETICIONES. Con un pool, la conexion se reutiliza. Si se usa
--     `SET app.user_id` (sin LOCAL), el valor sobrevive a la devolucion de la
--     conexion al pool y la SIGUIENTE peticion —posiblemente de otro usuario—
--     hereda ese actor. Es el modo de fallo mas probable de todo este archivo.
--     REGLA: siempre SET LOCAL y siempre dentro de una transaccion explicita.
--     Con Drizzle:
--
--       await db.transaction(async (tx) => {
--         await tx.execute(sql`select set_config('app.user_id', ${actorId}, true)`);
--         await tx.update(users).set({ role: 'staff' }).where(eq(users.id, targetId));
--       });
--
--     El tercer argumento `true` de set_config equivale a SET LOCAL: muere con
--     la transaccion. Fuera de una transaccion solo dura la sentencia, lo cual
--     es fail-closed (el trigger bloquea) y por tanto el fallo correcto.
--
--  3. FAIL-CLOSED A PROPOSITO. Sin app.user_id el cambio se bloquea. El primer
--     admin se crea con INSERT (estos triggers no miran INSERT en users), y
--     para una intervencion de emergencia el dueno de la tabla siempre puede
--     ALTER TABLE users DISABLE TRIGGER trg_users_prevent_role_escalation,
--     que queda registrado. Un unico mecanismo, sin puertas traseras por
--     variable de sesion adicional.
-- ============================================================================

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_raw        text;
  v_actor      uuid;
  v_actor_role user_role;
begin
  if new.role is not distinct from old.role then
    return new;
  end if;

  v_raw := nullif(btrim(coalesce(current_setting('app.user_id', true), '')), '');

  if v_raw is null then
    raise exception
      'Cambio de rol bloqueado: la conexion no declaro app.user_id (usa SET LOCAL app.user_id dentro de la transaccion)'
      using errcode = 'RCA08';
  end if;

  begin
    v_actor := v_raw::uuid;
  exception when invalid_text_representation then
    raise exception 'app.user_id no es un uuid valido: %', v_raw
      using errcode = 'RCA08';
  end;

  if v_actor = new.id then
    raise exception 'Un usuario no puede cambiar su propio rol (% -> %)', old.role, new.role
      using errcode = 'RCA08';
  end if;

  select u.role into v_actor_role
    from public.users u
   where u.id = v_actor;

  if v_actor_role is distinct from 'admin'::user_role then
    raise exception 'Solo un admin cambia roles; app.user_id=% tiene rol %',
      v_actor, coalesce(v_actor_role::text, '(usuario inexistente)')
      using errcode = 'RCA08';
  end if;

  return new;
end;
$fn$;
--> statement-breakpoint

drop trigger if exists trg_users_prevent_role_escalation on public.users;
--> statement-breakpoint

create trigger trg_users_prevent_role_escalation
before update of role on public.users
for each row
when (old.role is distinct from new.role)
execute function public.prevent_role_escalation();
--> statement-breakpoint


-- Nadie aprueba ni rechaza su propia resena, y solo admin/staff moderan.
-- Publicar una resena en 'pendiente' no pasa por ninguna de estas puertas:
-- ese es el camino normal del cliente y no necesita app.user_id.
create or replace function public.prevent_review_self_approval()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_raw        text;
  v_actor      uuid;
  v_actor_role user_role;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'pendiente' then
    return new;
  end if;

  v_raw := nullif(btrim(coalesce(current_setting('app.user_id', true), '')), '');

  if v_raw is null then
    raise exception
      'Moderacion de resenas bloqueada: la conexion no declaro app.user_id'
      using errcode = 'RCA09';
  end if;

  begin
    v_actor := v_raw::uuid;
  exception when invalid_text_representation then
    raise exception 'app.user_id no es un uuid valido: %', v_raw
      using errcode = 'RCA09';
  end;

  if new.user_id is not null and v_actor = new.user_id then
    raise exception 'El autor de una resena no puede moderarla el mismo (resena %)', new.id
      using errcode = 'RCA09';
  end if;

  select u.role into v_actor_role
    from public.users u
   where u.id = v_actor;

  if v_actor_role is null or v_actor_role not in ('admin', 'staff') then
    raise exception 'Solo admin o staff moderan resenas; app.user_id=% tiene rol %',
      v_actor, coalesce(v_actor_role::text, '(usuario inexistente)')
      using errcode = 'RCA09';
  end if;

  return new;
end;
$fn$;
--> statement-breakpoint

drop trigger if exists trg_reviews_prevent_self_approval on public.reviews;
--> statement-breakpoint

create trigger trg_reviews_prevent_self_approval
before insert or update of status on public.reviews
for each row
execute function public.prevent_review_self_approval();
