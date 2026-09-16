# Base de datos

PostgreSQL 16 self-hosted. Un contenedor de Postgres completo por tienda (ver [ARQUITECTURA.md](ARQUITECTURA.md)), nunca una base compartida dentro de un motor multi-tenant.

## Por qué las funciones críticas viven en plpgsql

`drizzle/migrations/0001_funciones.sql` contiene lógica que sería fácil reimplementar mal en TypeScript:

- **`create_pending_order`** bloquea las filas de `product_variants` con `SELECT ... FOR UPDATE` **ordenadas por id de variante**. Ese orden es lo que evita un deadlock cuando dos pedidos compiten por los mismos productos pero los piden en orden distinto. Re-lee los precios del servidor: nunca confía en lo que manda el cliente.
- **`fulfill_paid_order`** es idempotente por `(gateway, external_id)` sobre `payment_events`: un webhook reenviado por la pasarela no duplica el pago ni descuenta stock dos veces. Marca `processed_at` **al final** de la transacción que hace el trabajo, no al recibir el evento — si el proceso muere a mitad, el rollback deja el evento otra vez disponible para el reintento de la pasarela.
- **`available_stock(variant_id, session_token)`** calcula el stock disponible descontando las reservas activas **de otras sesiones**; excluye la reserva del propio `session_token` para que un reintento de checkout no vea su propia reserva como competencia.

Se llaman desde Drizzle con `db.execute(sql\`select * from create_pending_order(...)\`)`; Drizzle se usa para todo lo demás y para las migraciones.

### Errores opacos: RCA01–RCA09

Las funciones levantan `SQLSTATE` propios (`RCA01`…`RCA09`, ver `raise exception ... using errcode = 'RCA0x'` en las migraciones) en vez de dejar que se filtre un error genérico de Postgres. `lib/db/errores.ts` los desenvuelve desde `DrizzleQueryError.cause` (Drizzle 0.45 envuelve cada error de `pg` y esconde el código real) para que la capa de aplicación decida qué hacer con cada uno — por ejemplo, un `RCA03` de "el pedido ya no existe" se maneja distinto a un `RCA05` de "no hay stock suficiente". **Nunca** se devuelve `e.message` crudo al cliente: esa cadena incluye la sentencia SQL completa con sus parámetros, que en el checkout son nombre, correo, teléfono y dirección del comprador.

## Sin RLS

No hay Row-Level Security. El navegador nunca toca Postgres directamente — todo pasa por route handlers de Next.js con un pool del lado servidor — así que la autorización se hace en la capa de aplicación:

- Cada route handler y Server Action que escribe verifica sesión de Auth.js antes de tocar nada.
- Las queries de Drizzle filtran siempre por `user_id` o `session_token` explícito, nunca confían en un parámetro que llega del cliente.
- Las rutas `/admin/*` están protegidas releyendo el rol desde la base (`rolReal()`), no desde el JWT — ver [AUTH.md](AUTH.md).

## Esquema

### Enums (única fuente de verdad; los tipos de TypeScript se derivan, nunca se escriben a mano)

```
user_role        : admin | staff | cliente
product_status   : borrador | activo | archivado
order_status     : pendiente | pagado | en_preparacion | enviado | entregado | cancelado | reembolsado
payment_gateway  : wompi | epayco | mercadopago | manual
payment_status   : pendiente | aprobado | rechazado | reembolsado
coupon_type      : porcentaje | monto_fijo | envio_gratis
coupon_scope     : orden | categoria | producto
review_status    : pendiente | aprobada | rechazada
```

`manual` no es una pasarela: es dinero que entra por fuera de una (efectivo de contra entrega, una transferencia), para que también viva en `payments` y la suma de cobros cuadre con la suma de pedidos pagados.

### Tablas por dominio

**Catálogo** (`lib/db/schema/catalog.ts`)
- `categories` — árbol auto-referencial (`parent_id`, `on delete set null`). Sin CRUD en el panel; se siembran desde `tienda.config.ts → catalogo.categoriasIniciales`.
- `products` — **sin precio ni stock**, a propósito: viven en las variantes.
- `product_variants` — `price_cop` (con IVA incluido), `compare_at_price_cop`, `stock` (`CHECK >= 0`, última red bajo el plpgsql).
- `product_images`, `reviews` (con `CHECK` de que nadie aprueba su propia reseña, espejo del trigger), `wishlist_items`.

**Usuarios y auth** (`lib/db/schema/auth.ts`) — ver [AUTH.md](AUTH.md)
- `users` (fusiona identidad + perfil), `accounts`, `sessions`, `verification_tokens` (adaptador de Auth.js), `addresses`.

**Carrito y pedidos** (`lib/db/schema/commerce.ts`)
- `carts`, `cart_items` — apuntan a la variante, no al producto.
- `orders` — `user_id` nullable (compra como invitado), `email` NOT NULL, snapshot jsonb de la dirección de envío, columnas propias para entrega programada (`delivery_date`, `delivery_slot`, `recipient_*`) en vez de campos dentro del jsonb, porque se consultan a diario.
- `order_items` — snapshot de nombre, sku y precio; `line_total_cop` es columna **generada** por Postgres (no se puede insertar un total que no sea `precio * cantidad`).
- `coupons`, `coupon_categories`, `coupon_products`, `coupon_redemptions`.
- `inventory_reservations`, `payment_events` (idempotencia de webhooks, ver [PAGOS.md](PAGOS.md)).
- `abandoned_carts` — snapshot de la intención de compra capturada antes de confirmar; solo se escribe con `consent = true` (Ley 1581 de 2012).

**Configuración** (`lib/db/schema/settings.ts`)
- `store_settings` — singleton (`id boolean primary key default true`, `CHECK (id)`; el dominio efectivo de la columna es `{true}`, así que la unicidad del PK hace el singleton estructural, sin trigger).
- `payment_gateways` — PK = el enum `payment_gateway`.

**Campañas** (`lib/db/schema/campanas.ts`)
- `campaigns` — franjas de temporada editables desde `/admin`, con `CHECK` de que la fecha de fin no sea anterior al inicio y de que el color de fondo sea un hexadecimal válido (se interpola dentro de un `linear-gradient`; texto libre abriría la puerta a inyectar CSS).

### Franjas de entrega

`orders.delivery_slot` es **texto con `CHECK`**, no un enum: `orders_delivery_slot_ck` limita los valores a `manana | tarde | noche` (máximo 3), pero cuáles de esas tres usa cada tienda, sus horarios y sus etiquetas se configuran en `tienda.config.ts → entregas.franjas`, sin migración. Agregar una franja *distinta* de esas tres sí exige una migración nueva que amplíe el `CHECK`.

### Regla de `updated_at` en `store_settings`

El seed alinea `store_settings` con `tienda.config.ts → envioInicial` comparando `updated_at = created_at` — es decir, solo mientras la fila siga exactamente como la dejó la migración. Mientras esa condición se cumpla, el seed sí reescribe **las dos** columnas (`created_at` y `updated_at`) al mismo `now()` en cada corrida, justamente para que sigan iguales entre sí — por eso `created_at` de `store_settings` no guarda la fecha real en que se creó la fila. `/admin/ajustes` rompe la igualdad al guardar (solo actualiza `updated_at`). Consecuencia: **tras la primera edición desde el panel, el seed deja de tocar esa fila para siempre**, aunque `tienda.config.ts` cambie después. Es intencional — evita que un redeploy pise una tarifa que el negocio ya ajustó a mano — pero hay que saberlo antes de preguntarse por qué un cambio en `envioInicial` no se refleja, o por qué `created_at` no coincide con la fecha real de creación de la tienda.

## Migraciones

**Estrategia: la cadena `0000` → `0012` no se consolida.** Cada migración queda como el registro histórico de una decisión, verificada en CI contra un Postgres real (no simulado) en cada push. Consolidar perdería ese registro y arriesgaría reintroducir un bug ya corregido en el camino. Las funciones plpgsql (`create_pending_order`, `fulfill_paid_order`) llegan a su versión final en `0007`/`0008` y no se vuelven a tocar salvo con una migración nueva y su propia prueba de integración.

`0012_linea_base_snapshot.sql` es una **migración sin efecto** (`SELECT 1`): existe solo para que el snapshot de `drizzle-kit` vuelva a coincidir con el schema de TypeScript después de que `lib/db/schema/commerce.ts` empezara a declarar en TS piezas que antes solo existían en SQL crudo (la columna `stock_descontado_at`, los `CHECK` de coherencia de entrega, el índice parcial de `orders_delivery_date_idx`). Si algún día `drizzle-kit generate` propone algo *distinto* de `SELECT 1` contra una base ya migrada, hay una deriva real entre el SQL y el schema de TS que corregir en la fuente, no una migración nueva que ignorar.

**`db:push` no existe como script, a propósito.** Borraría silenciosamente columnas y `CHECK` que solo viven en SQL crudo si `drizzle-kit` no los ve reflejados en el schema de TypeScript. El único camino para generar una migración nueva es `drizzle-kit generate`.

```bash
pnpm db:generate   # genera una migración nueva a partir del diff de schema
pnpm db:migrate    # aplica las migraciones pendientes (SOLO en desarrollo)
pnpm db:studio     # explorador visual
```

Nunca editar el schema en producción a mano.

### Dos caminos para APLICAR migraciones — no se mezclan

Generar una migración (`drizzle-kit generate`) es siempre igual. Aplicarla no:

- **Desarrollo:** `pnpm db:migrate` (`drizzle-kit migrate`). Registra cada migración aplicada en `public.__drizzle_migrations`, con el hash del archivo — así sabe cuáles faltan la próxima vez.
- **Producción y CI:** el bucle `psql` de [NUEVA-TIENDA.md](NUEVA-TIENDA.md#7-migraciones) y de `.github/workflows/desplegar.yml`. Extrae los `.sql` ya empaquetados en la imagen y los aplica directo con `psql`. **No toca `public.__drizzle_migrations`.**

Por eso **nunca se debe correr `pnpm db:migrate` contra una base que ya recibió el bucle `psql`**: como `__drizzle_migrations` está vacía, `drizzle-kit migrate` cree que ninguna migración se aplicó, intenta repetir `0000_schema.sql` (que no tiene guardas: empieza con `CREATE TYPE`) y falla con `type "..." already exists` — sin mostrar el error en pantalla, solo un código de salida distinto de cero detrás del spinner.

**Para aplicar una migración nueva (una futura `0013_algo.sql`) en producción**, se repite el mismo patrón del paso 7 de NUEVA-TIENDA.md pero solo con el archivo nuevo, nunca con todo el directorio:

```bash
docker compose cp app:/app/drizzle/migrations/0013_algo.sql ./migraciones/
sed 's/--> statement-breakpoint//' ./migraciones/0013_algo.sql \
  | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q'
```

No reaplicar `0000_schema.sql`: empieza con `CREATE TYPE` sin guarda (`if not exists`) y falla contra una base que ya lo tiene. Las migraciones posteriores sí protegen sus sentencias (`if not exists`, `if exists`), pero no vale la pena arriesgarse — aplicar solo el archivo nuevo es igual de simple y evita el problema de raíz.

## Backups

Este starter no incluye un mecanismo de backup — es responsabilidad de la infraestructura del VPS donde se despliega cada tienda (fuera de este repositorio). Como mínimo: `pg_dump` periódico del volumen de Postgres y del volumen de `uploads`, cifrado, con retención y **con una restauración probada de verdad**, no solo verificada por tamaño de archivo.
