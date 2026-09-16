# \<Nombre de la tienda\> — tienda basada en ecommerce-co-starter

Instancia propia, desplegada de forma aislada (su propia app, su propio Postgres). La base reutilizable —lo que no es específico de esta tienda— está documentada en el repositorio [ecommerce-co-starter](https://github.com/<owner>/ecommerce-co-starter).

**Negocio:** \<una línea: qué vende y a quién\>.
**Moneda:** COP · **Idioma:** es-CO · **Dominio:** \<dominio.co\>

## Qué se edita aquí y qué no

- **`tienda.config.ts`** es el único archivo de código que cambia entre tiendas: nombre, contacto, cobertura, franjas de entrega, textos legales, categorías iniciales. No lleva imports ni alias `@/`.
- **`/admin/ajustes`** cambia el dinero editable en caliente: tarifa de envío, umbral de envío gratis, IVA en puntos básicos, minutos de reserva de inventario. Vive en `store_settings`, no en código.
- El resto del código es la base compartida. Un arreglo de fondo se hace primero en `ecommerce-co-starter` y se trae aquí con `git cherry-pick`, nunca al revés.

## Convenciones de dinero

- Todo en **enteros COP**. Nunca `float` ni `numeric`. `price_cop`, `total_cop`, `shipping_cop` son `integer`.
- IVA y cualquier porcentaje en **puntos básicos** (1900 = 19%, 1000 = 10%), coherente con lo anterior.
- **IVA incluido** en el precio mostrado. Se desglosa para mostrarlo (`store_settings.tax_rate_bps`); jamás se suma encima del precio.
- Precio y stock viven **solo en `product_variants`**. Un producto simple es un producto con una variante. Nunca se le agrega precio o stock a `products`.
- `order_items` guarda **snapshot** de nombre, sku y precio: el historial de pedidos no se corrompe si el catálogo cambia después.

## Funciones plpgsql (no reescribir en TypeScript)

- **`create_pending_order`** bloquea las variantes con `SELECT ... FOR UPDATE` **ordenado por id de variante**, para que dos pedidos que compiten por los mismos productos en orden distinto no se bloqueen entre sí (deadlock). Re-lee precios del servidor; nunca confía en lo que manda el cliente.
- **`fulfill_paid_order`** es idempotente por `(gateway, external_id)` en `payment_events`: un webhook reenviado por la pasarela no duplica el pago ni descuenta stock dos veces. Marca `processed_at` al final de la transacción, no al principio — si algo revienta a mitad, el reintento de la pasarela encuentra el evento otra vez disponible.

Cambiar estas funciones exige una migración nueva con su propia prueba de integración, nunca editar el SQL de una migración ya aplicada.

## Sin RLS

La autorización se hace en los route handlers (sesión de Auth.js + `rolReal()` releyendo el rol de la base), no en políticas de Postgres. Las queries siempre filtran por `user_id` o `session_token` explícito, nunca confían en un parámetro que llega del cliente.

## Convenciones de código

- Componentes de negocio en español (`CarritoModal`, `SelectorVariante`); genéricos en inglés (`Button`, `Card`).
- Precios: `formatearCOP()` de `lib/formato.ts` (o `formatearCifra()` sin el símbolo), nunca `toLocaleString()` directo.
- Zona horaria **America/Bogota**, fijada en el contenedor y en el motor de Postgres.
- `trailingSlash: true` en `next.config.ts`: toda ruta interna termina en `/`. Es convención del proyecto, no un accidente — cámbiala y rompes cada enlace interno y cualquier URL ya indexada.
- Un **Client Component nunca importa** un módulo marcado `server-only` (Drizzle, `lib/pagos/*.ts` con acceso a base, `lib/admin/secretos.ts`). Si un componente cliente necesita esa lógica, se expone por una Server Action o un route handler.
- Migraciones vía `drizzle-kit`, nunca editar el schema en producción a mano ni correr `db:push` (no existe el script a propósito).
- Commits en español, convención conventional commits.

## Rutas en español que no se mueven

Son URLs con SEO acumulado o contratos con la pasarela de pago. No se traducen ni se renombran sin evaluar el costo de una redirección:

`/`, `/tienda/`, `/tienda/{categoria}/`, `/tienda/{categoria}/{producto}/`, `/carrito/`, `/finalizar-compra/`, `/finalizar-compra/gracias/`, `/recuperar-carrito/`, `/baja-correos/`, `/entrar/`, `/crear-cuenta/`, `/recuperar/`, `/recuperar/cambiar/`, `/mi-cuenta/`, `/contactenos/`, `/terminos-y-condiciones/`, `/politica-de-privacidad/`, `/politica-de-devoluciones/`, `/politica-de-entrega/`, `/admin/**`.

## Slugs de categoría reservados

`lib/db/seed.ts` rechaza con `exit 1` cualquier categoría inicial cuyo slug colisione con una ruta de la app: `tienda`, `carrito`, `finalizar-compra`, `contactenos`, `mi-cuenta`, `admin`, `entrar`, `crear-cuenta`, `recuperar`, `recuperar-carrito`, `baja-correos`, `api`, `uploads`, `sitemap.xml`, `robots.txt`, `llms.txt`, `terminos-y-condiciones`, `politica-de-privacidad`, `politica-de-devoluciones`, `politica-de-entrega`. Lo mismo aplica a cualquier categoría que se cree después a mano en la base.

## Tema visual: sin marca hardcodeada

`app/globals.css` trae el tema neutro de shadcn/ui (tokens `oklch`, base color `neutral`) más una capa de alias semánticos (`--fondo`, `--texto`, `--acento`, `--borde`, `--peligro`…). Al personalizar una tienda:

- Los colores de marca se ajustan **en los tokens de `:root` y `.dark`**, no con hex sueltos en componentes.
- Quedan prohibidos en el código: variables o clases con el nombre de una marca concreta, y cualquier hex o `rgba(...)` de marca escrito directo en un componente en vez de en un token. Si una tienda necesita utilidades o animaciones propias, se definen en `app/globals.css` con nombres genéricos.

## Despliegue

`DOMINIO` es siempre el **ápex sin esquema ni www** (`example.com`, nunca `https://example.com` ni `www.example.com`); `scripts/subir.sh` lo valida y falla si no lo es (`docker-compose.yml` solo exige que la variable no esté vacía, no revisa su formato).

```bash
pnpm subir "fix(algo): lo que cambié"     # o: ./scripts/subir.sh "…"
```

Requiere `VPS=usuario@ip`, `TIENDA` y `DOMINIO` en el entorno local de quien lo ejecuta. Hace, en orden: typecheck + lint en local → commit y push → espera a que Actions publique la imagen de este commit (lo confirma leyendo la label `org.opencontainers.image.revision` del contenedor vivo, no adivinando) → dispara el deploy en el VPS sin esperar el timer de systemd → verifica que producción responde. Añade `--rapido` para saltar typecheck + lint cuando ya se corrieron a mano.

**La purga de Cloudflare la hace `deploy.sh` en el VPS, siempre después del healthcheck**, nunca antes: purgar antes de confirmar que el contenedor nuevo está sano deja el borde sirviendo caché vacía o el HTML de una versión que todavía no pasó su chequeo de salud. Ver [docs/NUEVA-TIENDA.md](docs/NUEVA-TIENDA.md) para el detalle completo del despliegue y [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) para el resto de la infraestructura.
