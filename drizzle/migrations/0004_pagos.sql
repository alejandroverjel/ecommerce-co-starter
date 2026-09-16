-- ============================================================================
-- Camino de pago: maquina de estados explicita
--
-- POR QUE SE REESCRIBE
--
-- La version anterior se corrigio tres veces contra reproducciones concretas y
-- la clase de fallo volvia por otra puerta cada vez. El diagnostico de fondo:
-- las guardas preguntaban por el ESTADO DEL PEDIDO en vez de por el invariante,
-- y de las doce transiciones posibles entre los cuatro valores de
-- payment_status solo habia una contemplada.
--
-- Fallos confirmados EJECUTANDO que esto cierra:
--
--  1. DOBLE COBRO SILENCIOSO. Un pedido que quedaba en 'pendiente' por otro
--     bloqueo aceptaba una segunda transaccion aprobada sin alertar.
--     Reproducido: 159.999 COP cobrados contra un pedido de 86.000, con el
--     segundo evento fuera de la bandeja de revision.
--  2. PEDIDO 'pagado' CON CERO PAGOS. El upsert arbitraba por
--     (gateway, external_id) global sin mirar el pedido, asi que la misma
--     transaccion reportada contra dos pedidos dejaba al segundo pagado y sin
--     ninguna fila de cobro. Una transaccion de 74.000 despachaba 148.000.
--  3. MONTO INVENTADO. coalesce(p_amount_cop, v_total) grababa un pago
--     aprobado por el total del pedido cuando la pasarela no reportaba monto.
--  4. EVENTO FUERA DE ORDEN QUE PISA EL COBRO. 'aprobado' seguido de
--     'pendiente' reescribia monto y raw_response, borrando la evidencia de
--     una disputa. Y 'reembolsado' seguido de 'aprobado' resucitaba un pago
--     devuelto y despachaba el producto.
--  5. STOCK DESCONTADO DOS VECES. El descuento dependia de que el pedido
--     estuviera 'pendiente'; si operaciones reabria un pedido pagado, el
--     siguiente evento volvia a descontar inventario.
--  6. REEMBOLSO SIN COBRO PREVIO aceptado en silencio.
--
-- REGLA QUE GOBIERNA TODO: un pago cobrado nunca se pierde, nunca se registra
-- dos veces, y nunca queda sin que alguien se entere. Ante la duda se registra
-- y se marca para revision; jamas se devuelve exito en silencio.
--
-- Mantiene el ORDEN GLOBAL DE BLOQUEO de 0001:
--   payment_events -> orders -> payments -> product_variants -> ...
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Marca de inventario ya descontado
--
-- El descuento de stock dependia del estado del pedido, que operaciones puede
-- cambiar a mano. Una marca propia e irreversible es lo unico que garantiza
-- que se descuente exactamente una vez, sin importar cuantos eventos lleguen
-- ni quien reabra el pedido.
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists stock_descontado_at timestamptz;

comment on column public.orders.stock_descontado_at is
  'Cuando se descontó el inventario de este pedido. Marca única e irreversible: '
  'el descuento nunca se repite aunque el pedido se reabra o lleguen más eventos.';

-- Pedidos ya pagados antes de esta migración: se marcan como descontados para
-- que un webhook reenviado no vuelva a bajarles el stock.
update public.orders
   set stock_descontado_at = coalesce(paid_at, updated_at)
 where stock_descontado_at is null
   and status in ('pagado', 'en_preparacion', 'enviado', 'entregado');

-- ============================================================================
-- fulfill_paid_order
-- ============================================================================

drop function if exists public.fulfill_paid_order(
  payment_gateway, text, text, text, payment_status, integer, jsonb, text);

create or replace function public.fulfill_paid_order(
  p_gateway                 payment_gateway,
  p_event_external_id       text,           -- ID DEL EVENTO       -> payment_events
  p_transaction_external_id text,           -- ID DE LA TRANSACCION -> payments
  p_order_reference         text,           -- order_number o id
  p_status                  payment_status,
  p_amount_cop              integer,
  p_payload                 jsonb default '{}'::jsonb,
  p_event_type              text  default null
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
  v_event_id      uuid;
  v_processed_at  timestamptz;
  v_last_error    text;

  v_order_id      uuid;
  v_order_status  order_status;
  v_total         integer;
  v_token         text;
  v_stock_hecho   timestamptz;

  v_txn_id        text;
  v_txn_order     uuid;
  v_pago_id       uuid;
  v_pago_estado   payment_status;
  v_pago_monto    integer;
  v_pago_pagado   timestamptz;

  v_aplicar       boolean := false;  -- ¿la transición se escribe en payments?
  v_review        text    := null;
  v_bloqueado     boolean := false;  -- ¿el pago NO puede mover el pedido?
  v_oversold      integer := 0;
  v_filas         integer;
begin
  ----------------------------------------------------------------------------
  -- 0. Entradas obligatorias
  ----------------------------------------------------------------------------
  if p_event_external_id is null or btrim(p_event_external_id) = '' then
    raise exception 'external_id del EVENTO es obligatorio (es la llave de idempotencia)'
      using errcode = 'RCA05';
  end if;

  -- El unique de payments es PARCIAL (where external_id is not null). Sin id de
  -- transacción la fila queda fuera del índice y cada evento inserta otro cobro.
  v_txn_id := nullif(btrim(coalesce(p_transaction_external_id, '')), '');
  if v_txn_id is null then
    raise exception
      'external_id de la TRANSACCION es obligatorio: sin el, payments no tiene llave de idempotencia'
      using errcode = 'RCA05';
  end if;

  ----------------------------------------------------------------------------
  -- 1. Claim del evento (idempotencia)
  ----------------------------------------------------------------------------
  insert into public.payment_events (
    gateway, external_id, event_type, payload, processing_started_at, attempts
  )
  values (
    p_gateway, p_event_external_id,
    nullif(btrim(coalesce(p_event_type, '')), ''),
    coalesce(p_payload, '{}'::jsonb), now(), 1
  )
  on conflict (gateway, external_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    -- El evento ya existía. Puede estar procesado, o colgado de un intento que
    -- murió a mitad.
    select pe.id, pe.processed_at, pe.last_error
      into v_event_id, v_processed_at, v_last_error
      from public.payment_events pe
     where pe.gateway = p_gateway
       and pe.external_id = p_event_external_id
       for update;

    if v_processed_at is not null then
      -- Ya se procesó: se responde lo mismo que la primera vez. Se resuelve el
      -- pedido SIN bloquear ni tocar nada.
      select o.id, o.status into v_order_id, v_order_status
        from public.orders o
       where o.order_number = p_order_reference or o.id::text = p_order_reference
       limit 1;

      return query select
        v_order_id, v_order_status, true,
        (v_last_error is not null), v_last_error;
      return;
    end if;

    -- Colgado: se retoma.
    update public.payment_events pe
       set processing_started_at = now(),
           attempts = pe.attempts + 1
     where pe.id = v_event_id;
  end if;

  ----------------------------------------------------------------------------
  -- 2. Pedido (segundo en el orden global de bloqueo)
  ----------------------------------------------------------------------------
  select o.id, o.status, o.total_cop, o.checkout_session_token, o.stock_descontado_at
    into v_order_id, v_order_status, v_total, v_token, v_stock_hecho
    from public.orders o
   where o.order_number = p_order_reference or o.id::text = p_order_reference
   limit 1
     for update;

  if v_order_id is null then
    update public.payment_events pe
       set last_error = format('No existe el pedido %s', p_order_reference),
           processed_at = now()
     where pe.id = v_event_id;

    raise exception 'No existe el pedido %', p_order_reference using errcode = 'RCA03';
  end if;

  ----------------------------------------------------------------------------
  -- 3. Pago existente de ESTA transacción (tercero en el orden de bloqueo)
  ----------------------------------------------------------------------------
  select p.id, p.order_id, p.status, p.amount_cop, p.paid_at
    into v_pago_id, v_txn_order, v_pago_estado, v_pago_monto, v_pago_pagado
    from public.payments p
   where p.gateway = p_gateway and p.external_id = v_txn_id
   limit 1
     for update;

  ----------------------------------------------------------------------------
  -- 4. MATRIZ DE TRANSICIONES
  --
  -- payment_status tiene cuatro valores: doce transiciones posibles. La versión
  -- anterior cubría UNA. Aquí están las doce, y el `else` final atrapa
  -- cualquier valor nuevo que se añada al enum en el futuro.
  --
  -- `v_aplicar` decide si la fila de payments se escribe.
  -- `v_bloqueado` decide si el pedido puede moverse.
  ----------------------------------------------------------------------------

  if v_pago_id is null then
    -- Primera vez que se ve esta transacción.
    v_aplicar := true;

  elsif v_txn_order is distinct from v_order_id then
    -- La transacción ya está registrada CONTRA OTRO PEDIDO. Nunca se reasigna:
    -- eso dejaba un pedido 'pagado' con cero filas de cobro.
    v_aplicar   := false;
    v_bloqueado := true;
    v_review := concat_ws(' ', v_review, format(
      'TRANSACCION %s YA REGISTRADA EN OTRO PEDIDO (%s): no se aplica a %s.',
      v_txn_id, v_txn_order, p_order_reference));

  elsif v_pago_estado = p_status then
    -- Mismo estado: evento reenviado. No es error, pero tampoco se reescribe.
    v_aplicar := false;

  elsif v_pago_estado = 'reembolsado' then
    -- Terminal. Un 'aprobado' posterior resucitaba el pago Y despachaba el
    -- producto de algo que ya se devolvió.
    v_aplicar   := false;
    v_bloqueado := true;
    v_review := concat_ws(' ', v_review, format(
      'EVENTO SOBRE PAGO YA REEMBOLSADO: llega "%s" para la transaccion %s, que estaba reembolsada. No se aplica.',
      p_status, v_txn_id));

  elsif v_pago_estado = 'aprobado' then
    if p_status = 'reembolsado' then
      v_aplicar := true;   -- única salida legítima de 'aprobado'
    else
      -- aprobado -> pendiente / rechazado: evento fuera de orden. Se ignora y
      -- se avisa, en vez de pisar el registro del cobro.
      v_aplicar   := false;
      v_bloqueado := true;
      v_review := concat_ws(' ', v_review, format(
        'EVENTO FUERA DE ORDEN: la transaccion %s ya estaba aprobada y llega "%s". Se conserva el cobro.',
        v_txn_id, p_status));
    end if;

  elsif v_pago_estado = 'rechazado' then
    if p_status = 'aprobado' then
      v_aplicar := true;   -- reintento con otra tarjeta: caso normal
    else
      v_aplicar := false;  -- rechazado -> pendiente: fuera de orden, sin daño
    end if;

  elsif v_pago_estado = 'pendiente' then
    if p_status = 'reembolsado' then
      v_aplicar   := false;
      v_bloqueado := true;
      v_review := concat_ws(' ', v_review,
        'REEMBOLSO SOBRE UN PAGO QUE NUNCA SE COBRO.');
    else
      v_aplicar := true;   -- pendiente -> aprobado / rechazado
    end if;

  else
    -- Valor de payment_status no contemplado. Se registra y se revisa: nunca
    -- se deja pasar en silencio algo que este código no entiende.
    v_aplicar   := false;
    v_bloqueado := true;
    v_review := concat_ws(' ', v_review, format(
      'ESTADO DE PAGO NO CONTEMPLADO: %s -> %s.', v_pago_estado, p_status));
  end if;

  ----------------------------------------------------------------------------
  -- 5. Guardas de negocio
  ----------------------------------------------------------------------------

  -- 5.a  Monto obligatorio en un aprobado.
  --      La versión anterior hacía coalesce(p_amount_cop, v_total): grababa un
  --      cobro aprobado por una cifra que la pasarela nunca confirmó.
  if p_status = 'aprobado' and p_amount_cop is null then
    v_aplicar   := false;
    v_bloqueado := true;
    v_review := concat_ws(' ', v_review, format(
      'LA PASARELA NO REPORTO MONTO para %s: no se puede confirmar el cobro de %s COP.',
      p_order_reference, v_total));
  end if;

  -- 5.b  El monto debe ser positivo (lo exige payments_amount_ck).
  if p_amount_cop is not null and p_amount_cop <= 0 then
    v_aplicar   := false;
    v_bloqueado := true;
    v_review := concat_ws(' ', v_review, format(
      'MONTO NO POSITIVO (%s) para %s: no es un cobro.', p_amount_cop, p_order_reference));
  end if;

  -- 5.c  SEGUNDO COBRO. Preguntando por el INVARIANTE, no por el estado del
  --      pedido: existe otro pago aprobado de OTRA transacción para este
  --      pedido. Así ninguna puerta lo deja pasar, esté el pedido como esté.
  if p_status = 'aprobado' and not v_bloqueado and exists (
       select 1 from public.payments p
        where p.order_id = v_order_id
          and p.status   = 'aprobado'
          and not (p.gateway = p_gateway and p.external_id = v_txn_id))
  then
    v_aplicar   := false;
    v_bloqueado := true;
    v_review := concat_ws(' ', v_review, format(
      'SEGUNDO COBRO: el pedido %s YA tiene un pago aprobado de otra transaccion y llega %s. Hay que reembolsar uno.',
      p_order_reference, v_txn_id));
  end if;

  -- 5.d  Descuadre de monto. No bloquea (la plata se movió y hay que verla),
  --      pero sí se revisa.
  if p_status = 'aprobado' and p_amount_cop is not null and p_amount_cop <> v_total then
    v_review := concat_ws(' ', v_review, format(
      'DESCUADRE: %s reporto %s COP y el pedido %s vale %s COP.',
      p_gateway, p_amount_cop, p_order_reference, v_total));
  end if;

  -- 5.e  Reembolso sin cobro previo contra este pedido.
  if p_status = 'reembolsado' and not exists (
       select 1 from public.payments p
        where p.order_id = v_order_id and p.paid_at is not null)
  then
    v_aplicar   := false;
    v_bloqueado := true;
    v_review := concat_ws(' ', v_review, format(
      'REEMBOLSO SIN COBRO: el pedido %s no tiene ningun pago cobrado.', p_order_reference));
  end if;

  -- 5.f  Pedido en estado terminal.
  if v_order_status in ('cancelado', 'reembolsado') and p_status = 'aprobado' then
    v_bloqueado := true;
    v_review := concat_ws(' ', v_review, format(
      'PAGO SOBRE PEDIDO %s: el pedido %s ya estaba en ese estado. El cobro SE REGISTRA pero no se aplica.',
      v_order_status, p_order_reference));
  end if;

  ----------------------------------------------------------------------------
  -- 6. Escritura del pago
  --
  -- Se registra AUNQUE esté bloqueado para el pedido: la plata existe y tiene
  -- que verse. Lo que el bloqueo impide es mover el pedido, no ver el dinero.
  ----------------------------------------------------------------------------
  if v_pago_id is null and p_amount_cop is not null and p_amount_cop > 0 then
    insert into public.payments (
      order_id, gateway, external_id, external_reference,
      amount_cop, status, paid_at, raw_response
    ) values (
      v_order_id, p_gateway, v_txn_id, p_order_reference,
      p_amount_cop, p_status,
      case when p_status = 'aprobado' then now() else null end,
      coalesce(p_payload, '{}'::jsonb)
    );

  elsif v_pago_id is not null and v_aplicar then
    -- El monto y la evidencia se congelan en cuanto hubo cobro. La condición es
    -- `paid_at is not null` y NO `status = 'aprobado'`: el propio evento puede
    -- haber degradado el status un instante antes, y entonces el congelamiento
    -- dejaría de proteger justo cuando hace falta.
    update public.payments p
       set status     = p_status,
           amount_cop = case when p.paid_at is not null
                             then p.amount_cop
                             else coalesce(p_amount_cop, p.amount_cop) end,
           raw_response = case when p.paid_at is not null
                               then p.raw_response
                               else coalesce(p_payload, p.raw_response) end,
           paid_at = case when p_status = 'aprobado'
                          then coalesce(p.paid_at, now())
                          else p.paid_at end,
           updated_at = now()
     where p.id = v_pago_id;
  end if;

  ----------------------------------------------------------------------------
  -- 7. Transición del pedido
  ----------------------------------------------------------------------------
  if not v_bloqueado and p_status = 'aprobado' then

    -- INVARIANTE: ningún pedido pasa a 'pagado' sin una fila de cobro aprobada
    -- SUYA. Sin esto, una transacción reasignada dejaba pedidos pagados con
    -- cero pagos y la mercancía salía sin cobrar.
    if not exists (
      select 1 from public.payments p
       where p.order_id = v_order_id and p.status = 'aprobado')
    then
      v_review := concat_ws(' ', v_review, format(
        'SIN PAGO PROPIO REGISTRADO: el pedido %s no se marca como pagado.', p_order_reference));

    elsif v_order_status = 'pendiente' then
      update public.orders o
         set status  = 'pagado',
             paid_at = coalesce(o.paid_at, now())   -- lo exige orders_paid_at_ck
       where o.id = v_order_id;

      v_order_status := 'pagado';

      -- Stock: SOLO si nunca se descontó. La marca es la garantía, no el estado
      -- del pedido, que operaciones puede cambiar a mano.
      if v_stock_hecho is null then
        for v_filas in
          select 1 from public.order_items oi
           where oi.order_id = v_order_id and oi.variant_id is not null
        loop
          null;  -- se recorre solo para saber si hay items
        end loop;

        -- Bloqueo de variantes en orden ascendente de id (orden global).
        perform 1
           from public.product_variants pv
          where pv.id in (select oi.variant_id from public.order_items oi
                           where oi.order_id = v_order_id and oi.variant_id is not null)
          order by pv.id
            for update;

        update public.product_variants pv
           set stock = pv.stock - oi.quantity,
               updated_at = now()
          from public.order_items oi
         where oi.order_id = v_order_id
           and oi.variant_id = pv.id;

        -- Sobreventa: no se aborta —el dinero ya entró— pero se avisa.
        select count(*) into v_oversold
          from public.product_variants pv
          join public.order_items oi on oi.variant_id = pv.id
         where oi.order_id = v_order_id and pv.stock < 0;

        if v_oversold > 0 then
          v_review := concat_ws(' ', v_review, format(
            'SOBREVENTA: %s variante(s) quedaron con stock negativo tras el pedido %s.',
            v_oversold, p_order_reference));
        end if;

        update public.orders o set stock_descontado_at = now() where o.id = v_order_id;
      end if;

      -- Las reservas ya no hacen falta: el stock se descontó de verdad.
      if v_token is not null then
        delete from public.inventory_reservations r where r.session_token = v_token;
      end if;
    end if;

  elsif not v_bloqueado and p_status = 'reembolsado' then
    update public.orders o
       set status = 'reembolsado'
     where o.id = v_order_id;
    v_order_status := 'reembolsado';
  end if;

  ----------------------------------------------------------------------------
  -- 8. Cierre del evento — AL FINAL
  --
  -- processed_at se marca aquí y no al principio: si el proceso muere a mitad,
  -- el evento queda sin marcar y el reintento de la pasarela lo retoma. Al
  -- revés, un pedido podía quedar sin pagar con el evento dado por procesado.
  ----------------------------------------------------------------------------
  update public.payment_events pe
     set processed_at = now(),
         last_error   = nullif(btrim(coalesce(v_review, '')), '')
   where pe.id = v_event_id;

  return query select
    v_order_id, v_order_status, false,
    (v_review is not null), v_review;
end;
$fn$;

comment on function public.fulfill_paid_order is
  'Aplica un evento de la pasarela. Matriz de transiciones explícita sobre los '
  'cuatro valores de payment_status. Un pago cobrado nunca se pierde, nunca se '
  'registra dos veces y nunca queda sin alertar: ante la duda se registra el '
  'pago y se marca en payment_events.last_error para revisión manual.';
