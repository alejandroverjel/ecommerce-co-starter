# ecommerce-co-starter

Base self-hosted, lista para producción, para vender en línea en Colombia sin depender de un PaaS externo (Vercel, Supabase). Next.js standalone en Docker, Postgres propio por tienda, pagos con Mercado Pago y Wompi, y un panel de administración funcional — no una maqueta.

**Molde, no framework.** Cada tienda nace copiando este repositorio, se personaliza editando un único archivo (`tienda.config.ts`) y se despliega como instancia completamente aislada: su propio contenedor de app, su propio Postgres, su propia red privada, sus propias credenciales de pasarela.

## Qué incluye

- **Catálogo** — categorías, productos con variantes (precio y stock viven ahí, nunca en el producto), imágenes, búsqueda y filtros.
- **Carrito y checkout** — reserva de inventario con expiración, cupones, entrega programada por franjas horarias, mensaje de regalo opcional.
- **Pagos pluggables** — Mercado Pago (Checkout Pro) y Wompi (checkout hospedado) integrados y funcionando; los datos de tarjeta nunca tocan este servidor. Las llaves se cargan desde `/admin/ajustes`, cifradas en la base.
- **Carrito abandonado** — captura el correo antes de que la persona termine la compra y envía un recordatorio si no vuelve.
- **Campañas de temporada** — franjas promocionales con fecha de inicio y fin, editables desde el panel, sin tocar código.
- **Cuentas y admin** — Auth.js v5 con contraseña (argon2id), roles `admin` / `staff` / `cliente`, y un panel con CRUD real de productos, pedidos, cupones, campañas y ajustes.
- **SEO** — sitemap, robots.txt, datos estructurados (JSON-LD), `llms.txt` para agentes de IA, cabeceras de seguridad y caché de imágenes.

Ver [docs/DEUDA-TECNICA.md](docs/DEUDA-TECNICA.md) para lo que falta, sin maquillar.

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router, salida `standalone`) + React 19 |
| Base de datos | PostgreSQL 16 — un contenedor propio por tienda |
| ORM | Drizzle ORM 0.45 + drizzle-kit 0.31 |
| Driver | `pg` (node-postgres) |
| Funciones críticas | plpgsql: reserva de inventario sin deadlocks, confirmación de pago idempotente |
| Auth | Auth.js v5 + adaptador de Drizzle + argon2id |
| UI | shadcn/ui sobre Base UI + Tailwind CSS v4 + Lucide |
| Estado del carrito | Zustand + persist |
| Validación | Zod v4 + react-hook-form |
| Pagos | Mercado Pago (Checkout Pro) + Wompi (checkout hospedado), pluggables |
| Email transaccional | Resend |
| Proxy y SSL | Traefik v3 + Let's Encrypt (desafío DNS-01) |
| CDN / WAF | Cloudflare (proxy activado) |
| Deploy | Docker + GitHub Actions → ghcr.io → timer de systemd |

**Descartado explícitamente:** Vercel, Supabase, Watchtower, control-planes tipo Coolify/CapRover.

## Requisitos

- Node.js ≥ 24 y pnpm (`corepack enable` es suficiente; la versión exacta está fijada en `package.json`)
- Docker y Docker Compose, para levantar Postgres local y para el build de producción
- Una cuenta en Mercado Pago y/o Wompi si vas a probar pagos de verdad (el resto de la tienda funciona sin ellas)

## Inicio rápido local

```bash
git clone <url-de-este-repo> mi-tienda
cd mi-tienda
pnpm install

cp env.example .env.local
# Editar .env.local: como mínimo DATABASE_URL, AUTH_SECRET, y cambiar a
# localhost las dos variables que env.example deja con el dominio de ejemplo:
#   NEXT_PUBLIC_SITE_URL=http://localhost:3000
#   AUTH_URL=http://localhost:3000
# Si vas a subir imágenes desde /admin en local, cambia también:
#   UPLOADS_DIR=./uploads
#   openssl rand -base64 32   →  AUTH_SECRET

docker run -d --name mi-tienda-postgres \
  -e POSTGRES_USER=tienda -e POSTGRES_PASSWORD=tienda -e POSTGRES_DB=tienda \
  -p 5432:5432 postgres:16-alpine

pnpm db:migrate
SEED_DEMO=1 pnpm db:seed      # crea la fila de ajustes de fábrica + 2 productos de ejemplo
pnpm crear-admin tu@example.com

pnpm dev                      # http://localhost:3000
```

Comandos que vas a usar seguido:

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Servidor de desarrollo |
| `pnpm build` / `pnpm start` | Build y arranque de producción locales |
| `pnpm typecheck` / `pnpm lint` | Las dos comprobaciones que corre CI antes de construir la imagen |
| `pnpm test` / `pnpm test:unidad` | Pruebas (integración + unitarias) / solo las que no tocan la base |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio` | Flujo de Drizzle |
| `pnpm db:seed` | Alinea `store_settings` y las categorías iniciales con `tienda.config.ts` |
| `pnpm crear-admin <correo>` | Da de alta el primer usuario `admin` (no se puede crear desde la app) |
| `pnpm subir "mensaje"` | Commit + push + espera de CI + deploy en el VPS + verificación, en un solo comando (ver [docs/NUEVA-TIENDA.md](docs/NUEVA-TIENDA.md)) |

## Crear una tienda nueva

1. Clona este repositorio con el nombre de la tienda nueva y crea su propio remoto en GitHub.
2. Edita `tienda.config.ts` — es el único archivo de código que hay que tocar: nombre, contacto, cobertura, franjas de entrega, textos legales, categorías iniciales. Está tipado y comentado campo por campo.
3. Copia `env.example` a `/opt/tiendas/<tienda>/.env` en el servidor y complétalo (dominio, credenciales de base de datos, llaves de correo) — es el `.env` de producción, no el `.env.local` de desarrollo del paso anterior.
4. Sigue [docs/NUEVA-TIENDA.md](docs/NUEVA-TIENDA.md) para el resto: infraestructura del VPS, variables de CI, migraciones, primer administrador y cutover.
5. Lo que no se toca en código: precios de envío, umbral de envío gratis, IVA y minutos de reserva viven en `store_settings` y se editan desde `/admin/ajustes` una vez la tienda está viva.

Este repositorio **no publica imagen de Docker** por sí mismo (el workflow de CI corre las pruebas pero salta el build/publicación cuando el repositorio es este starter). Cada tienda, al vivir en su propio repositorio, sí publica la suya.

## Estructura del proyecto

```
tienda.config.ts       Identidad y operación de la tienda (único archivo a editar)
app/                    Rutas (App Router): tienda pública, checkout, cuenta, admin, API
components/             Componentes de UI, por dominio (carrito, producto, admin, layout…)
lib/
  db/                   Cliente de Drizzle, schema por dominio, seed
  pagos/                Mercado Pago y Wompi, con la firma/verificación en módulos puros
  auth/, validaciones/  Autenticación y esquemas Zod
  data/                 Capa de acceso a datos que usan las páginas y route handlers
drizzle/
  migrations/           Cadena de migraciones SQL, nunca editada a mano en producción
docs/                   Documentación de arquitectura, base de datos, pagos, deuda técnica
scripts/                crear-admin, subir.sh (deploy), purgar-cache.sh
.github/workflows/      CI: typecheck, lint, pruebas de integración, build y publicación
```

## Documentación

| Documento | Contenido |
|---|---|
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Modelo de aislamiento por tienda, infraestructura del VPS, redes Docker, deploy |
| [docs/BASE-DE-DATOS.md](docs/BASE-DE-DATOS.md) | Schema, funciones plpgsql, estrategia de migraciones |
| [docs/PAGOS.md](docs/PAGOS.md) | Arquitectura pluggable de pasarelas, flujo de webhooks, idempotencia |
| [docs/AUTH.md](docs/AUTH.md) | Auth.js, roles, protección de rutas |
| [docs/COLOMBIA.md](docs/COLOMBIA.md) | IVA, COP, envíos, direcciones, lo específico del mercado colombiano |
| [docs/NUEVA-TIENDA.md](docs/NUEVA-TIENDA.md) | Procedimiento completo para crear y desplegar una tienda |
| [docs/MIGRACION-WOOCOMMERCE.md](docs/MIGRACION-WOOCOMMERCE.md) | Migrar desde WordPress/WooCommerce sin perder posicionamiento |
| [docs/DEUDA-TECNICA.md](docs/DEUDA-TECNICA.md) | Qué falta y qué se sabe que está incompleto, sin maquillar |
| [CLAUDE.md](CLAUDE.md) | Plantilla de instrucciones para un asistente de código trabajando sobre una tienda concreta |
| [STACK.md](STACK.md) | Plantilla de ficha técnica por tienda |

## Licencia

[MIT](LICENSE).
