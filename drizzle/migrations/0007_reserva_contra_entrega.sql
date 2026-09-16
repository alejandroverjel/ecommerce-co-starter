-- ============================================================================
-- Sobreventa en contra entrega: la reserva dura lo que dura el pedido
--
-- QUE ESTABA ROTO
--
-- `reservation_ttl_minutes` (15) esta dimensionado para alguien llenando el
-- formulario de checkout. Con contra entrega el pedido se queda 'pendiente'
-- hasta que alguien registra el cobro a mano —cuando el mensajero vuelve, o al
-- dia siguiente—, pero la reserva moria a los 15 minutos. En esa ventana la
-- unidad volvia a contarse como disponible y se podia vender de nuevo.
--
-- Reproduccion: stock 1. A pide contra entrega a las 10:00. A las 10:20 la
-- reserva vencio y B compra lo mismo. A las 18:00 se cobra el de A: stock 0. A
-- las 19:00 se cobra el de B: stock -1, y `fulfill_paid_order` escribe
-- SOBREVENTA en payment_events. Se detecta, si, pero con dos clientes
-- esperando un producto que existe una sola vez.
--
-- QUE CAMBIA
--
-- Solo el vencimiento de `inventory_reservations`, y solo cuando el metodo es
-- contra entrega: 30 dias en vez de 15 minutos. Nada mas de la funcion se
-- toca. Un pedido contra entrega es una venta comprometida, no un checkout a
-- medias, y su inventario tiene que seguir apartado hasta que se cobre o se
-- cancele. Cancelar el pedido libera la reserva como siempre.
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
  v_ttl_efectivo   integer;   -- el de esta reserva, segun el metodo de pago

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
           nullif(e->>'variant_id', '')::uuid          as variant_id,
           coalesce((e->>'quantity')::integer, 0)      as quantity
      from jsonb_array_elements(p_items) as e
  ),
  agregado as (
    -- Agrupa por producto Y variante. Antes agrupaba solo por producto, asi
    -- que dos variantes distintas del mismo producto se fusionaban en una sola
    -- linea de la variante por defecto (H2). Ahora cada variante es su linea.
    select product_id,
           variant_id,
           sum(quantity)::integer as quantity
      from entrada
     where product_id is not null
     group by product_id, variant_id
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
           -- Si el cliente mando una variante se respeta, pero SOLO si es de
           -- este producto y esta activa; si no mando, cae a la de menor
           -- position. Una variante ajena o inactiva deja variant_id null y
           -- dispara RCA03 mas abajo, en vez de cobrar otra cosa.
           and (a.variant_id is null or pv.id = a.variant_id)
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

    -- El TTL sale de store_settings (BUG 7), pero NO es el mismo para todos
    -- los metodos de pago.
    --
    -- SOBREVENTA EN CONTRA ENTREGA: reservation_ttl_minutes esta pensado para
    -- alguien que esta llenando el checkout (15 minutos de sobra). Con contra
    -- entrega el pedido queda 'pendiente' hasta que ALGUIEN REGISTRA EL COBRO A
    -- MANO, y eso pasa cuando el mensajero vuelve: horas o dias despues. Al
    -- cuarto de hora la reserva vencia, la unidad volvia a aparecer libre y se
    -- podia vender otra vez. El descuadre solo se veia al cobrar el segundo
    -- pedido, con las dos personas ya esperando el mismo producto.
    --
    -- Un pedido contra entrega no es un checkout a medias: es una venta
    -- comprometida que se va a armar y despachar. Su reserva dura hasta que se
    -- cobra o se cancela, no quince minutos. El tope de 30 dias evita que un
    -- pedido olvidado retenga inventario para siempre.
    v_ttl_efectivo := case
      when p_payment_method = 'contra-entrega' then 60 * 24 * 30
      else v_ttl_minutes
    end;

    insert into public.inventory_reservations (
      variant_id, session_token, order_id, quantity, expires_at
    ) values (
      v_item.variant_id, p_session_token, v_order_id, v_item.quantity,
      now() + make_interval(mins => v_ttl_efectivo)
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
