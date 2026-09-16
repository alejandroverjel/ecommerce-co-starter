# Crear una tienda nueva

Procedimiento completo para levantar una tienda desde cero sobre este starter: repositorio, infraestructura del VPS, migraciones, primer administrador y cutover. Sustituye `<tienda>` por el slug de la tienda (el mismo valor que `tienda.config.ts` → `slug`) y `<dominio>` por su ápex (`example.com`, sin esquema ni `www`).

Cada tienda es una **instancia completamente aislada**: su propio contenedor de app, su propio contenedor de Postgres, su propia red privada (`internal: true`), su propio volumen de imágenes y sus propias credenciales de pasarela. Lo único compartido con otras tiendas del mismo VPS es Traefik, a través de la red `traefik-public`, donde entra **solo la app**, nunca la base de datos. El despliegue lo hace `deploy.sh` desde un timer de systemd — no hay Watchtower ni control-plane.

> **Prerrequisito externo a este repositorio.** Este procedimiento asume que el VPS ya tiene montada la infraestructura compartida (repositorio `vps-infra`, fuera de este starter): la red `traefik-public`, Traefik con el entrypoint `websecure`, el certresolver `letsencrypt` (DNS-01 vía Cloudflare) y el middleware `ratelimit-estricto@file`; `/opt/infra/scripts/deploy.sh` y `/opt/infra/scripts/purgar-cache.sh`; y las unidades systemd `deploy@<tienda>.service`/`.timer` que el paso 9 activa. Sin eso montado de antemano, los pasos 9 y 13 y `pnpm subir`/`scripts/purgar-cache.sh` no tienen nada que ejecutar. Este starter no incluye esas plantillas: se construyen o se obtienen aparte, en la infraestructura compartida del VPS.

## 1. Repositorio y configuración

```bash
# Clonar el starter con el nombre de la tienda nueva
git clone https://github.com/<owner>/ecommerce-co-starter.git <tienda>
cd <tienda>
git remote remove origin
git remote add origin https://github.com/<owner>/<tienda>.git
```

Editar `tienda.config.ts` — es el único archivo de código que cambia por tienda: nombre, contacto, cobertura, franjas de entrega, categorías iniciales y textos legales. Revisar `env.example` y copiar lo que aplique a `.env.local` para desarrollo (drizzle-kit, el seed y `crear-admin` solo leen `.env.local`; `.env` es exclusivo del servidor).

## 2. Variables de repositorio para GitHub Actions

En el repo nuevo → Settings → Secrets and variables → Actions → pestaña **Variables**:

| Variable | Obligatoria | Notas |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | **Sí** | Debe empezar por `https://` y no contener `localhost`. El job de build del workflow **falla explícitamente** si falta o no cumple el formato — mejor ahí que con el dominio equivocado horneado en cada página. |
| `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_GTM_ID` | No | Vacías, el sitio construye sin analítica. |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | No | Vacía en desarrollo; ponerla aquí para no perder la verificación de Search Console en cada build. |

El push a `main` dispara el workflow. Debe quedar en verde y publicar `ghcr.io/<owner>/<tienda>:latest`.

## 3. Cloudflare y el registro de contenedores

**Token DNS de Cloudflare** (para que Traefik emita certificados por DNS-01): Cloudflare → Mi perfil → Tokens de API → permiso *Zona · DNS · Editar*, restringido a la zona de `<dominio>`. Se guarda en el `.env` de la infraestructura compartida del VPS (fuera de este repositorio), no en el de la tienda.

**Login de ghcr en el VPS**, con un token clásico de GitHub con **solo `read:packages`**:

```bash
ssh <usuario>@<vps>
echo '<token>' | docker login ghcr.io -u <usuario-github> --password-stdin
```

## 4. Montar la tienda en el VPS

```bash
ssh <usuario>@<vps>
mkdir -p /opt/tiendas/<tienda>/{secrets,uploads,cache-imagenes}
# El contenedor corre como uid 1001 (usuario "nextjs" del Dockerfile); sin este
# chown, la app no puede escribir imágenes subidas ni la caché del optimizador.
chown -R 1001:1001 /opt/tiendas/<tienda>/uploads /opt/tiendas/<tienda>/cache-imagenes

# -hex, no -base64: base64 puede traer "/" y esa contraseña rompe el parseo
# de DATABASE_URL (pg-connection-string) casi 4 de cada 10 veces.
openssl rand -hex 24 > /opt/tiendas/<tienda>/secrets/db_password.txt
chmod 600 /opt/tiendas/<tienda>/secrets/db_password.txt
```

Copiar `docker-compose.yml` del repositorio a `/opt/tiendas/<tienda>/docker-compose.yml`.

## 5. Variables de entorno del servidor

Crear `/opt/tiendas/<tienda>/.env` (`chmod 600`, nunca en git):

```bash
# Interpoladas por docker-compose.yml
TIENDA=<tienda>
DOMINIO=<dominio>                      # ápex, SIN esquema ni www
IMAGEN=ghcr.io/<owner>/<tienda>:latest

# Usuario y base = TIENDA. La contraseña es la de secrets/db_password.txt.
DATABASE_URL=postgresql://<tienda>:<la-de-secrets/db_password.txt>@postgres:5432/<tienda>

NEXT_PUBLIC_SITE_URL=https://www.<dominio>
AUTH_SECRET=            # openssl rand -base64 32 — nuevo, no el de desarrollo
AUTH_TRUST_HOST=true
AUTH_URL=https://www.<dominio>

PAYMENT_SECRETS_ENCRYPTION_KEY=   # openssl rand -base64 32 — nuevo

RESEND_API_KEY=
EMAIL_FROM=pedidos@<dominio>
# Obligatoria: sin ella no salen los avisos internos de pedidos (se registra el
# error con console.error; el correo al cliente sí sale igual).
EMAIL_TIENDA=
EMAIL_COPIA=            # opcional

CRON_SECRET=            # openssl rand -hex 24 — protege el barrido de carritos abandonados

CLOUDFLARE_ZONE_ID=
CLOUDFLARE_PURGE_TOKEN=
```

## 6. Levantar los contenedores

```bash
cd /opt/tiendas/<tienda>
docker compose up -d postgres
docker compose ps           # esperar "healthy"
docker compose up -d        # la app
```

La app queda `unhealthy` hasta que las migraciones corran (más abajo), porque `/api/salud/` consulta la base.

## 7. Migraciones

El mismo bucle que corre CI, adaptado al VPS: se extraen los `.sql` ya empaquetados dentro de la imagen (no hace falta clonar el repositorio) y se aplican con `psql` dentro del contenedor de Postgres.

```bash
docker compose cp app:/app/drizzle/migrations ./migraciones
for f in ./migraciones/*.sql; do
  echo "-- $f"
  # $POSTGRES_USER y $POSTGRES_DB, no $TIENDA: son variables del ENTORNO DEL
  # CONTENEDOR postgres (docker-compose.yml las interpola desde TIENDA), no de
  # esta shell SSH — aquí "$TIENDA" está vacío y psql conectaría sin usuario.
  sed 's/--> statement-breakpoint//' "$f" \
    | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q'
done
```

La migración `0002` ya deja `store_settings` con valores neutros de fábrica (envío, umbral, IVA, minutos de reserva) — la tienda no da 500 ni siquiera antes del seed.

**Nota para migraciones futuras:** este bucle NO registra nada en `public.__drizzle_migrations` (esa tabla la usa `pnpm db:migrate`, que es solo para desarrollo). Para aplicar una migración nueva más adelante (una futura `0013_algo.sql`), repetir este mismo patrón pero solo con el archivo nuevo, nunca reaplicando `0000_schema.sql` (no tiene guarda y falla con "already exists" contra una base que ya lo tiene). Ver [BASE-DE-DATOS.md](BASE-DE-DATOS.md#dos-caminos-para-aplicar-migraciones--no-se-mezclan).

## 8. Seed y primer administrador

```bash
docker compose exec app node herramientas/seed.cjs
```

Alinea `store_settings` con `tienda.config.ts → envioInicial` (solo mientras nadie lo haya editado desde `/admin/ajustes`) y siembra las categorías de `tienda.config.ts → catalogo.categoriasIniciales`.

```bash
docker compose exec -e ADMIN_EMAIL=<correo-del-admin> app node herramientas/crear-admin.cjs
```

El primer administrador se crea así, nunca desde la aplicación: el trigger `prevent_role_escalation` exige que quien cambia un rol *ya sea* admin.

## 9. Deploy continuo

```bash
systemctl enable --now deploy@<tienda>.timer
```

El timer revisa cada 5 minutos si `ghcr.io` tiene una imagen nueva; `pnpm subir` (ver el `CLAUDE.md` de la tienda) lo dispara al instante en vez de esperar.

## 10. Carritos abandonados (opcional)

Si la tienda va a mandar recordatorios de carrito abandonado, agregar el timer que golpea el endpoint protegido por `CRON_SECRET`:

```ini
# /etc/systemd/system/carritos-<tienda>.service
[Service]
Type=oneshot
ExecStart=/usr/bin/curl -fsS -X POST \
  https://<dominio>/api/tareas/carritos-abandonados/ \
  -H "authorization: Bearer <EL_MISMO_CRON_SECRET_DEL_.env>"
```

```ini
# /etc/systemd/system/carritos-<tienda>.timer
[Timer]
OnCalendar=hourly
Persistent=true
[Install]
WantedBy=timers.target
```

```bash
systemctl enable --now carritos-<tienda>.timer
```

Sin `CRON_SECRET` el endpoint responde 401; sin `RESEND_API_KEY` responde 503 sin tocar ninguna fila. La corrida es idempotente: se puede llamar cada hora sin miedo a mandar el recordatorio dos veces.

## 11. Probar antes de anunciar el dominio

El certificado ya se puede emitir (DNS-01 no depende de a dónde apunte el registro A). Sin tocar el DNS público:

```bash
curl --resolve www.<dominio>:443:<ip-del-vps> https://www.<dominio>/ -sI
```

Checklist mínimo: portada 200 · una ficha de producto 200 · certificado válido · `/sitemap.xml` y `/robots.txt` responden · un pedido de prueba completo de punta a punta.

## 12. Pagos

Con la tienda ya viva, entrar a `/admin/ajustes` y cargar las llaves de **producción** de Mercado Pago y/o Wompi (nunca las de pruebas). Configurar el webhook de cada pasarela apuntando a:

```
https://<dominio>/api/pagos/mercadopago/
https://<dominio>/api/pagos/wompi/
```

Con la barra final — `trailingSlash: true` la exige también en las rutas de API. Ver [PAGOS.md](PAGOS.md) para el resto del flujo.

## 13. Reversión

Si el deploy publicado falla el healthcheck o se detecta un problema después:

```bash
ssh <usuario>@<vps> '/opt/infra/scripts/deploy.sh <tienda> --revertir'
```

`deploy.sh` guarda el digest anterior antes de cada deploy; revertir vuelve a ese digest fijándolo con un override, en vez de relanzar el `:latest` roto.

## Checklist de la primera semana

- [ ] Renovar cualquier credencial de pasarela que haya pasado por un chat o correo durante el desarrollo, y actualizarla en `/admin/ajustes`.
- [ ] Rotar la contraseña del administrador creado durante el desarrollo.
- [ ] Verificar dominio en Resend y confirmar que los correos transaccionales salen de verdad.
- [ ] **Revisión jurídica de los textos legales antes de anunciar la tienda**: `tienda.config.ts → legal` (razón social, NIT, plazos de reclamo y reembolso, excepción de retracto) alimenta las páginas de términos, privacidad, devoluciones y entrega, pero el texto generado no reemplaza una revisión con un abogado — en particular el derecho de retracto (Ley 1480, Estatuto del Consumidor) y el tratamiento de datos personales (Ley 1581 de 2012, Habeas Data).
- [ ] Vigilar Search Console / Cloudflare Analytics por 404 inesperados si la tienda viene de una migración (ver [MIGRACION-WOOCOMMERCE.md](MIGRACION-WOOCOMMERCE.md)).
- [ ] Backups de la base y del volumen de `uploads` configurados y con una restauración probada al menos una vez.

## Una advertencia sobre `TIENDA`

`TIENDA` es el usuario, la base de datos, el nombre de los contenedores, la red privada y el volumen de Postgres, todo a la vez. **Dos tiendas en el mismo VPS no pueden compartir el mismo valor de `TIENDA`** — el `docker-compose.yml` de la segunda pisaría los recursos de la primera. Verificar que el slug es único en el servidor antes de desplegar.
