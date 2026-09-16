# Arquitectura

## Diagrama

```
Internet
   │
   ▼
Cloudflare (proxy + WAF + CDN, DNS)
   │  HTTPS
   ▼
Traefik (reverse proxy + Let's Encrypt, red traefik-public)
   │  HTTP interno
   ▼
<tienda>-app  ───────────────  red <tienda>-privada (internal: true)  ───────────────  <tienda>-postgres
```

```
push a main
  → GitHub Actions: typecheck, lint, pruebas de integración contra Postgres real
  → build de la imagen Docker (salida standalone) y push a ghcr.io/<owner>/<tienda>:latest
  → timer de systemd (deploy@<tienda>.timer) corre deploy.sh en el VPS:
      docker compose pull → up -d → espera healthcheck → purga Cloudflare
```

`pnpm subir` (ver [NUEVA-TIENDA.md](NUEVA-TIENDA.md)) hace el mismo camino sin esperar los 5 minutos del timer: push, espera a que la imagen de ese commit exacto quede publicada, dispara el deploy y verifica que producción responde.

## Principio de aislamiento

**Una instancia completa por tienda.** Cada tienda tiene:

- Su propio contenedor de aplicación Next.js
- **Su propio contenedor de PostgreSQL** (no una base dentro de un motor compartido)
- Su propia red privada `internal: true`, sin salida a internet ni alcanzable por otras tiendas del mismo servidor
- Su propio volumen de imágenes subidas y su propia caché de imágenes optimizadas
- Sus propias credenciales de pasarela de pago (cifradas en su propia base)
- Su propio archivo `.env`

**Comparten solamente infraestructura:** Traefik, a través de `traefik-public`, donde entra solo la app de cada tienda — nunca la base de datos.

### Por qué instancias separadas y no multi-tenant

El schema es estructuralmente mono-tienda, a propósito:

- `store_settings` tiene PK booleana (`id boolean primary key default true`, con `CHECK (id)`) — físicamente imposible una segunda fila.
- `payment_gateways.gateway` es el enum `payment_gateway` como PK — agregar una pasarela nueva exige `ALTER TYPE`.
- `products.slug`, `categories.slug`, `product_variants.sku`, `coupons.code` son únicos globales dentro de la base.
- `order_number_seq` es una secuencia por base, con prefijo `ORD-`.

Convertirlo a multi-tenant exigiría tocar la mayoría de las tablas, volver compuestos los constraints únicos y agregar un filtro de tenant en cada query. Con instancias separadas, cero cambio de schema — el costo se paga en despliegues a mantener, no en complejidad de datos.

**Ventaja:** una tienda comprometida, caída o con una migración a medio aplicar no afecta a las demás. Backups y restauraciones son por tienda.

**Costo asumido:** N despliegues que mantener y el riesgo de que el código de una tienda diverja del starter. Se mitiga trayendo los arreglos de fondo primero al starter y después con `git cherry-pick` a cada tienda (ver el `CLAUDE.md` de cada tienda).

## Redes Docker

| Red | Miembros | Propósito |
|---|---|---|
| `traefik-public` | Traefik + el contenedor de **app** de cada tienda | Ingress HTTP/HTTPS |
| `<tienda>-privada` (`internal: true`) | La app de esa tienda + su Postgres | Tráfico interno, sin salida a internet |

Cada tienda tiene **su propia** red privada, nombrada con su slug (`${TIENDA}-privada`), así que ninguna otra tienda puede unirse por accidente. Postgres **nunca** entra en `traefik-public` ni publica puerto al host: solo lo alcanza la app de su misma tienda.

## Límites de recursos

`docker-compose.yml` declara límites explícitos por contenedor, para que un pico de tráfico en una tienda no ahogue a las demás en el mismo servidor:

```yaml
deploy:
  resources:
    limits:
      cpus: "2.0"
      memory: 768M
    reservations:
      memory: 256M
```

Postgres corre con parámetros ajustados para una tienda pequeña (`shared_buffers=128MB`, `max_connections=50`, sin `log_statement=ddl` para no dejar contraseñas de `CREATE ROLE` en el log). Dimensionar hacia arriba cuando el tráfico real lo pida, no antes.

## Traefik

- Termina TLS con certificados de Let's Encrypt automáticos, desafío **DNS-01** vía Cloudflare (HTTP-01 no sirve si el firewall del host solo deja pasar tráfico de Cloudflare, no del validador de Let's Encrypt).
- Enruta por `Host()` hacia el contenedor de cada tienda; las rutas sensibles (`/api`, `/finalizar-compra`, `/mi-cuenta`, `/entrar`, `/crear-cuenta`) llevan un límite de peticiones más estricto, declarado como router aparte con mayor prioridad.
- Redirige HTTP → HTTPS y agrega cabeceras de seguridad (HSTS, `X-Frame-Options`, etc.) — la app las repite en `next.config.ts` para que siga siendo segura incluso si se sirve sin el proxy delante.

### IP real del visitante con Cloudflare

Con el proxy de Cloudflare activado, Traefik ve la IP de Cloudflare, no la del visitante. Sin configurar `forwardedHeaders.trustedIPs` con los rangos de Cloudflare en la configuración estática de Traefik, los logs y cualquier rate-limiting quedan inútiles. Cloudflare entrega la IP real en el header `CF-Connecting-IP`.

## Cloudflare

**Proxy activado (nube naranja).** El VPS no necesita CDN, WAF ni protección DDoS propia — Cloudflare los aporta. SSL/TLS en modo *Full (Strict)*: Traefik sirve el certificado real de Let's Encrypt, nunca uno autofirmado.

**La purga de caché va siempre después del healthcheck**, no antes: `deploy.sh` la dispara solo cuando el contenedor nuevo ya respondió sano. Purgar antes serviría el HTML de una versión que todavía podría no levantar. `scripts/purgar-cache.sh` de este repositorio solo dispara esa purga por SSH; el token y la zona viven en el `.env` de la infraestructura compartida del VPS, no en el repositorio de ninguna tienda.

## Reparto de la configuración

Tres capas, cada una con un dueño distinto:

| Capa | Contiene | Se edita |
|---|---|---|
| `tienda.config.ts` | Identidad y operación: nombre, contacto, cobertura, franjas de entrega, textos legales, categorías iniciales | En código, por quien despliega la tienda |
| `store_settings` (Postgres) | El dinero editable en caliente: tarifa de envío, umbral de envío gratis, IVA en puntos básicos, minutos de reserva de inventario | Desde `/admin/ajustes`, sin desplegar nada |
| `.env` / variables de Actions | Secretos, dominio, credenciales de infraestructura | Por tienda, nunca en git |

La migración `0002` siembra `store_settings` con valores neutros de fábrica; el seed (`lib/db/seed.ts`) los alinea con `tienda.config.ts → envioInicial` **solo mientras nadie los haya editado desde el panel** (compara `updated_at = created_at`). Tras la primera edición en `/admin/ajustes`, el seed deja de tocar esa fila. Ver [BASE-DE-DATOS.md](BASE-DE-DATOS.md).

## Categorías, caché y páginas dinámicas

Las categorías viven en la tabla `categories` (no hay CRUD de categorías en el panel; se siembran desde `tienda.config.ts → catalogo.categoriasIniciales`) y se leen con `unstable_cache`, invalidadas por tag cuando cambia el catálogo. El menú y el pie de página dependen de esa consulta cacheada.

Las páginas legales y el grupo `(auth)` (`/entrar/`, `/crear-cuenta/`, `/recuperar/`) se marcan `export const dynamic = "force-dynamic"`: si se dejaran prerenderizar en el build, el HTML congelaría el menú de categorías tal como estaba *en ese momento del build*, que puede ser antes de que exista ninguna categoría real.

## Seguridad base del host

| Control | Herramienta |
|---|---|
| Firewall del host | firewalld / ufw — solo 22, 80, 443 |
| Firewall de Docker | Regla en la cadena `DOCKER-USER` |
| Fuerza bruta SSH | fail2ban |
| Acceso SSH | Solo llave pública |
| Secretos | Ficheros de secreto (`chmod 600`) o Docker secrets, nunca en git ni como variable de entorno plana cuando hay alternativa |

> **Ojo:** el firewall del host **no** filtra los puertos que Docker publica — Docker inserta sus reglas DNAT antes de que firewalld/ufw las vea, así que un `ports: 5432:5432` quedaría abierto a internet aunque el firewall tenga ese puerto cerrado. Por eso ningún servicio de este starter publica puerto al host salvo Traefik (80/443); Postgres solo es alcanzable por la red privada de su propia tienda.

## Componentes descartados y por qué

| Componente | Razón |
|---|---|
| **Postgres compartido entre tiendas** | El schema es mono-tienda a propósito (ver arriba); un motor compartido solo añade el riesgo de que una tienda vea o afecte a otra. |
| **Watchtower / control-plane con auto-actualización** | El deploy lo dispara un timer de systemd que corre `deploy.sh` con healthcheck y purga explícitos; una actualización automática sin esos dos pasos sirve una versión rota en silencio. |
| **Coolify / CapRover** | Consumen RAM en control-plane que, con configuración manual, va a las tiendas. |
| **Vercel / Supabase** | Objetivo explícito de no depender de PaaS externo. |
| **Redis / PgBouncer** | Sin caso de uso concreto todavía: Auth.js guarda sesión en JWT y Next.js en contenedor persistente maneja su propio pool de conexiones. Se agregan cuando aparezca una necesidad medible, no antes. |

## Servicios externos que sí son necesarios

| Servicio | Por qué es obligatoriamente externo |
|---|---|
| DNS (Cloudflare) | La resolución de dominios es distribuida por naturaleza |
| CA de SSL (Let's Encrypt) | Un certificado autofirmado no lo acepta ningún navegador |
| Pasarela de pago (Mercado Pago / Wompi) | Cumplimiento PCI — los datos de tarjeta nunca deben tocar este servidor |
| Email transaccional (Resend) | Montar SMTP propio es pelea perdida: reputación de IP, SPF/DKIM/DMARC |
