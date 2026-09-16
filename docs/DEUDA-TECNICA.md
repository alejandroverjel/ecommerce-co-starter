# Deuda técnica

Inventario honesto de lo que falta o queda a medias en este starter. No es un producto terminado: es una base con las partes difíciles (dinero, concurrencia, idempotencia de pagos) ya resueltas y algunas partes de producto y de operación todavía pendientes.

## Bugs conocidos

### 1. `fulfill_paid_order` puede fallar por el `CHECK` de stock en un pago tardío

`0008_guardas_pago.sql` redefine `fulfill_paid_order` con `set stock = pv.stock - oi.quantity` (sin `greatest(..., 0)`, a diferencia de la resta de stock que sí lo tenía en `0001_funciones.sql`). Si entre el checkout y la confirmación del pago el stock de esa variante bajó a menos de lo pedido —otro pedido se lo llevó, o un administrador lo ajustó a mano—, la resta deja la columna negativa y **el `CHECK product_variants_stock_ck` (`stock >= 0`) revienta la transacción entera**: el pago queda registrado en la pasarela pero el pedido nunca pasa a `pagado`, y el webhook lo reintentará sin éxito hasta que alguien note el `payment_events` atascado.

**Corrección pendiente:** decidir la política de negocio para este caso (¿se acepta el pedido en negativo con una alerta al admin? ¿se marca para revisión manual sin tocar stock?) y hacerlo con una migración `0013` nueva, con su propia prueba de integración — nunca editando `0008` directamente.

### 2. Líneas duplicadas por variante en `create_pending_order`

Si el arreglo de items del checkout trae **la misma variante en dos líneas separadas** (en vez de una sola línea con la cantidad sumada), `create_pending_order` inserta dos filas en `order_items` —correcto para el histórico— pero la reserva de inventario en `inventory_reservations` tiene `unique(variant_id, session_token)` con `on conflict (...) do update set quantity = excluded.quantity`: la segunda línea **sobrescribe** la cantidad reservada de la primera en vez de sumarla. El pedido queda con la cantidad total correcta en `order_items`, pero reservando menos stock del que en realidad comprometió.

**Corrección pendiente:** agregar las cantidades por `variant_id` antes de armar `p_items`, ya sea en la capa de aplicación (el carrito no debería nunca mandar la misma variante en dos líneas) o dentro de la función con un `group by` explícito antes del bucle de inserción.

## Funcionalidad de producto ausente o a medias

| Falta | Detalle |
|---|---|
| **CRUD de categorías en el panel** | Prioritaria. Hoy las categorías solo se crean sembrando `tienda.config.ts → catalogo.categoriasIniciales` con `pnpm db:seed`; no hay pantalla de administración para crear, renombrar o reordenar categorías después del lanzamiento. |
| **Modo oscuro sin interruptor** | Los tokens `.dark` de `app/globals.css` están definidos (heredados del tema de shadcn/ui) pero no hay ningún control que los active — `next-themes` se quitó de las dependencias. Alguien con `prefers-color-scheme: dark` en el sistema operativo no lo nota porque nada activa la clase. |
| **Productos borrados sin redirección** | `destinoDeProductoRetirado()` genera un 301 cuando un producto se **archiva** (`status = 'archivado'`), pero si la fila se borra de verdad de la base no hay nada de qué redirigir: la URL simplemente empieza a dar 404. Archivar, no borrar, es la única forma soportada de retirar un producto sin perder la URL indexada. |
| **`/_not-found` puede mostrar el menú sin categorías** | La página 404 raíz de Next.js se puede prerenderizar de forma estática en el build, antes de que exista ninguna categoría en la base (o contra una base distinta a la de producción). El menú que trae esa página estática puede quedar vacío hasta el próximo build. |
| **ePayco declarado, sin integrar** | El enum y el seed lo contemplan (`isEnabled: false`); no existe el módulo de firma/verificación. Ver [PAGOS.md](PAGOS.md). |
| **"Sin envío gratis" se resuelve con un umbral alto, no con `NULL`** | `store_settings.free_shipping_threshold_cop` es `NOT NULL`; una tienda sin envío gratis usa un umbral deliberadamente inalcanzable (por ejemplo `999999999`) en vez de un valor que signifique "no aplica". Funciona, pero un reporte que sume ese umbral literal quedaría con un número sin sentido si no se documenta la convención. |
| **Sin transportadoras nacionales ni tracking** | Ver [COLOMBIA.md](COLOMBIA.md). |
| **Sin lista DANE de departamentos y municipios** | Ver [COLOMBIA.md](COLOMBIA.md). |
| **Sin cédula/NIT en el checkout** | Bloquea, en la práctica, cualquier necesidad de facturación electrónica. Ver [COLOMBIA.md](COLOMBIA.md). |
| **Facturación electrónica DIAN** | No implementada; ruta recomendada es integrar un proveedor autorizado, no el protocolo directo. |

## Seguridad y cuentas

| Falta | Detalle |
|---|---|
| **Revocación real de sesión** | La sesión es JWT (ver [AUTH.md](AUTH.md)); no hay forma de invalidar el token de alguien antes de que expire (7 días). `rolReal()` mitiga el caso de administración quitando permisos al instante, pero el token en sí sigue siendo válido. |
| **Sin rate limit explícito en `/entrar/`** | El costo de argon2id ya ralentiza cada intento y no hay filtración por tiempo entre correo inexistente y contraseña incorrecta (ver [AUTH.md](AUTH.md)), pero no hay un límite de intentos por IP o por cuenta a nivel de aplicación; Traefik sí aplica un límite de peticiones más estricto a `/entrar` y `/crear-cuenta` como capa de infraestructura (ver [ARQUITECTURA.md](ARQUITECTURA.md)), que no es lo mismo que un bloqueo por cuenta. |

## Limitaciones estructurales conocidas y aceptadas

Estas no son bugs: son decisiones de diseño con un costo conocido.

- **`payment_gateways.gateway` como PK del enum** — agregar una pasarela nueva de verdad exige `ALTER TYPE` en la base de cada tienda que la use.
- **Una instancia completa por tienda** — sin multi-tenant; el costo es N despliegues, no complejidad de datos compartidos. Ver [ARQUITECTURA.md](ARQUITECTURA.md).
- **Contra entrega soportado en el schema, no ofrecido en el checkout** — reactivarlo es una decisión de negocio, no solo un cambio de configuración.
- **Una sola tarifa de IVA por tienda** — suficiente para catálogos de un solo tipo de producto.

## Tema sin identidad de marca

`app/globals.css` trae el tema neutro de shadcn/ui, sin identidad visual propia. Para mantener la base reutilizable:

- Nada de tokens o clases con nombre de una marca concreta: los colores se ajustan en los tokens de `:root` y `.dark`.
- Nada de hex o `rgba(...)` de marca escritos directo en componentes.
- Nada de `@font-face` propios en la base: cada tienda añade su tipografía (por ejemplo con `next/font`).

También se retiraron `next-themes` (no hay interruptor de modo oscuro: los tokens `.dark` existen pero nada los activa) y `motion` (solo quedan las transiciones funcionales del panel del carrito). Una tienda nueva configura su color en `tienda.config.ts` (`seo.colorTema`) y, si necesita más, reemplaza los tokens del tema.

## Lo que sí está bien resuelto

Vale la pena decirlo, porque es la parte más fácil de subestimar leyendo solo la lista de arriba:

- **`create_pending_order`** re-lee precios del servidor y bloquea variantes en orden de id para evitar deadlocks entre pedidos que compiten.
- **`fulfill_paid_order`** es idempotente por `(gateway, external_id)`, con `processed_at` marcado al final de la transacción, no al principio.
- **Dinero en enteros COP** en todo el sistema, con una sola función de formato.
- **IVA inclusive con desglose por puntos básicos**, calculado en el servidor y congelado por pedido.
- **Envío con una sola fuente de verdad** (`store_settings`), sin constantes duplicadas en el frontend.
- **Snapshot en `order_items`** — el historial de pedidos no se corrompe si cambia el catálogo después.
- **Secretos de pasarela cifrados** con AES-256-GCM, nunca en texto plano ni de vuelta al navegador.
- **Auth.js completo** con argon2id, protección contra enumeración de cuentas por tiempo de respuesta, y el rol siempre releído de la base para las rutas sensibles.
- **CI real**: typecheck, lint y pruebas de integración contra un Postgres real en cada push, antes de publicar cualquier imagen.
