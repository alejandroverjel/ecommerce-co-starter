# Ficha técnica — \<Nombre de la tienda\>

Plantilla de ficha por tienda. Copiar y completar los marcadores al crear una tienda nueva a partir de [ecommerce-co-starter](https://github.com/<owner>/ecommerce-co-starter); lo que no cambia entre tiendas está en el README y en `docs/` de ese repositorio.

## Identidad

| Campo | Valor |
|---|---|
| Nombre | \<Nombre de la tienda\> |
| Dominio | \<dominio.co\> |
| Repositorio | \<owner\>/\<repo\> |
| Moneda / idioma | COP / es-CO |
| Zona horaria | America/Bogota |

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router, salida `standalone`) + React 19 |
| Base de datos | PostgreSQL 16, contenedor propio de esta tienda |
| ORM | Drizzle ORM 0.45 + drizzle-kit 0.31 |
| Auth | Auth.js v5 + adaptador de Drizzle + argon2id |
| UI | shadcn/ui sobre Base UI + Tailwind CSS v4 + Lucide |
| Estado del carrito | Zustand + persist |
| Validación | Zod v4 + react-hook-form |
| Proxy y SSL | Traefik v3 + Let's Encrypt (desafío DNS-01) |
| Deploy | Docker + GitHub Actions → ghcr.io → timer de systemd |
| CDN / WAF | Cloudflare (proxy activado) |
| Email | Resend |

## Pagos

**Mercado Pago** (Checkout Pro) y **Wompi** (checkout hospedado) integrados y pluggables: ambos se activan cargando sus llaves desde `/admin/ajustes`, sin desplegar código nuevo. El pago contra entrega existe como valor histórico en la base (`payment_method`), pero **no se ofrece** en el checkout de esta base — actívalo solo si el negocio realmente hace entregas propias y puedes operar el cobro en efectivo.

| Pasarela | Estado | Notas |
|---|---|---|
| Mercado Pago | \<activa / pendiente de llaves\> | Principal. Ver [docs/PAGOS.md](docs/PAGOS.md). |
| Wompi | \<activa / pendiente de llaves\> | Integrada, se enciende sola al cargar llaves. |
| Contra entrega | Inactiva | Soportada en el schema; no expuesta en el formulario de pago. |

## Infraestructura de esta tienda

| Campo | Valor |
|---|---|
| VPS | \<host o referencia interna, sin IP en este documento\> |
| Contenedor de app | `<tienda>-app` |
| Contenedor de Postgres | `<tienda>-postgres` |
| Red privada | `<tienda>-privada` (`internal: true`) |
| Timer de deploy | `deploy@<tienda>.timer` |
| Zona de Cloudflare | \<referencia al secreto en el VPS, nunca el token aquí\> |

## Personalización aplicada

Resumen de lo que distingue a esta tienda del starter, para quien retome el proyecto:

- \<cambios sobre `tienda.config.ts`: franjas de entrega, cobertura, textos legales…\>
- \<componentes o páginas que se salen de lo genérico, si los hay\>
- \<integraciones adicionales, si las hay\>

## Estado

- [ ] Infraestructura del VPS
- [ ] Aplicación base (schema, auth, Dockerfile, deploy)
- [ ] Contenido (catálogo real cargado)
- [ ] Frontend a medida
- [ ] SEO y lanzamiento
