-- ============================================================================
-- 0002_seed.sql
--
-- Seed OBLIGATORIO. En el starter original este archivo se referenciaba en dos
-- documentos pero nunca se escribio: store_settings quedaba vacia,
-- create_pending_order hacia coalesce(v_flat, 0) y el servidor cobraba envio
-- $0 mientras la interfaz mostraba el valor de flat_shipping_cop (BUG 1). Ahora
-- la tabla se llena aqui y create_pending_order lanza excepcion si falta algo,
-- asi que el bug no puede volver en silencio.
--
-- Idempotente: se puede correr N veces sin romper nada y sin pisar lo que un
-- admin haya cambiado desde el panel.
--
-- ----------------------------------------------------------------------------
-- ALINEADO AL SCHEMA (lib/db/schema/*.ts). Lo que estaba mal:
--   store_settings.iva_rate 0.19   -> tax_rate_bps 1900 (puntos basicos, entero)
--   categories.sort_order          -> position
--   payment_gateways.display_name  -> es NOT NULL y no se pasaba
-- Las cuatro sentencias del seed viejo fallaban por eso.
--
-- ----------------------------------------------------------------------------
-- RELACION CON lib/db/seed.ts
--   Este archivo es la BASE MINIMA para que la migracion deje una base usable
--   (envio, IVA, TTL, pasarelas declaradas y APAGADAS). Las categorias las
--   siembra lib/db/seed.ts desde TIENDA.catalogo.categoriasIniciales, porque
--   el panel no tiene CRUD de categorias.
--   lib/db/seed.ts corre despues, en cada deploy. Las pasarelas solo se
--   encienden desde /admin/ajustes (cargando sus llaves ahi), nunca desde el
--   entorno ni desde una migracion. seed.ts SI actualiza display_name y
--   position de payment_gateways en cada corrida (ver alinearPasarelas), con
--   el mismo orden que este archivo deja de fabrica.
-- ============================================================================


-- ============================================================================
-- 1. store_settings — singleton (id boolean pk default true check (id))
--
-- Todas las columnas son NOT NULL con DEFAULT en el schema, asi que no existe
-- el caso "fila presente con hueco": o hay fila completa, o no hay fila. Por
-- eso el conflicto es DO NOTHING y no un coalesce columna por columna: si la
-- fila ya existe, sus valores son los que el admin decidio y no se tocan.
-- ============================================================================

insert into public.store_settings (
  id,
  tax_rate_bps,
  flat_shipping_cop,
  free_shipping_threshold_cop,
  reservation_ttl_minutes
) values (
  true,
  1900,      -- IVA 19% en PUNTOS BASICOS, INCLUIDO en el precio mostrado.
             -- Se desglosa: base = round(total*10000/(10000+1900)); iva = total-base.
  10000,     -- envio plano COP $10.000 (valor neutro de fabrica; editable en /admin/ajustes)
  200000,    -- envio gratis desde COP $200.000 (valor neutro de fabrica; editable en /admin/ajustes)
  15         -- TTL de reserva de inventario, en minutos (unica fuente de verdad)
)
on conflict (id) do nothing;
--> statement-breakpoint

-- Red de seguridad: que la migracion falle aqui y no en el primer checkout real.
do $do$
declare
  v_ok boolean;
begin
  select count(*) = 1
    into v_ok
    from public.store_settings s
   where s.id
     and s.tax_rate_bps is not null
     and s.flat_shipping_cop is not null
     and s.free_shipping_threshold_cop is not null
     and s.reservation_ttl_minutes > 0;

  if not v_ok then
    raise exception
      'El seed de store_settings quedo incompleto: sin el, create_pending_order calcularia envio $0. Revisa 0002_seed.sql.'
      using errcode = 'RCA01';
  end if;
end
$do$;
--> statement-breakpoint


-- ============================================================================
-- 2. payment_gateways — las tres declaradas, TODAS apagadas y SIN LLAVES
--
-- display_name es NOT NULL (el seed viejo no lo pasaba y la sentencia moria).
--
-- Las llaves (public/private/events/integrity) no van en el repositorio ni en
-- una migracion: entran por variables de entorno (lib/db/seed.ts las lee) o se
-- cargan desde el panel de admin. Las filas se crean deshabilitadas para que
-- exista la referencia sin que se pueda cobrar por accidente en el primer
-- arranque. Se habilita desde /admin/ajustes al cargar las llaves, o a mano:
--   update payment_gateways set is_enabled = true where gateway = 'wompi';
-- ============================================================================

insert into public.payment_gateways (gateway, display_name, is_enabled, is_sandbox, position) values
  ('mercadopago', 'Mercado Pago', false, true, 0),
  ('wompi',       'Wompi',        false, true, 1),
  ('epayco',      'ePayco',       false, true, 2)
on conflict (gateway) do update set
  display_name = excluded.display_name,
  position     = excluded.position;
-- is_enabled / is_sandbox / public_key NO se pisan: son operativos, los maneja
-- lib/db/seed.ts o el panel, no una migracion.
