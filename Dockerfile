# ==============================================================================
# Imagen de producción
#
# Multi-etapa con salida standalone de Next.js: la imagen final solo lleva el
# runtime y las dependencias que el servidor realmente usa, no todo node_modules.
# ==============================================================================

# ------------------------------------------------------------------------------
# Etapa 1: dependencias
# ------------------------------------------------------------------------------
FROM node:24-alpine AS deps

# libc6-compat: algunas dependencias nativas lo necesitan en Alpine.
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Solo los manifiestos: así esta capa se reutiliza mientras no cambien
# las dependencias, aunque cambie el código.
COPY package.json pnpm-lock.yaml* ./

RUN corepack enable pnpm && \
    pnpm install --frozen-lockfile

# ------------------------------------------------------------------------------
# Etapa 2: compilación
# ------------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Desactiva la telemetría de Next.js durante el build.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Las NEXT_PUBLIC_* se HORNEAN en el bundle durante el build, no se leen en
# tiempo de ejecución: si no llegan aquí, el contenedor las tendrá vacías por
# mucho que estén en su .env.
#
# NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: etiqueta de verificación de Google
# Search Console. Vacía, Search Console pierde la verificación de la
# propiedad y con ella el historial acumulado de posicionamiento.
ARG NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=""
ENV NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=$NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION

# Dominio canónico del sitio: fuente de SITIO.dominio y de
# serverActions.allowedOrigins. El workflow de CI falla si llega vacía.
ARG NEXT_PUBLIC_SITE_URL=""
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# Analítica opcional: sin valor, el sitio construye sin analítica.
ARG NEXT_PUBLIC_GA_ID=""
ENV NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID

ARG NEXT_PUBLIC_GTM_ID=""
ENV NEXT_PUBLIC_GTM_ID=$NEXT_PUBLIC_GTM_ID

RUN corepack enable pnpm && \
    pnpm build

# Empaqueta el seed y la creación de admin como CJS, para poder correrlos en
# el VPS sin necesitar todo el árbol de fuentes ni tsx.
RUN pnpm herramientas

# public/ puede no traer archivos (git no guarda carpetas vacías): se garantiza
# que exista para que el COPY de la etapa de producción no falle.
RUN mkdir -p public

# ------------------------------------------------------------------------------
# Etapa 3: producción
# ------------------------------------------------------------------------------
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV TZ=America/Bogota

# dumb-init evita que Node quede como PID 1 sin gestionar señales.
# Sin esto, `docker stop` espera el tiempo de gracia completo y luego mata el
# proceso a la fuerza, en vez de cerrarlo limpio.
RUN apk add --no-cache dumb-init

# Usuario sin privilegios. Nunca correr la aplicación como root: si alguien
# logra ejecución de código, no debe tener permisos sobre el sistema.
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Directorio de imágenes subidas. Se monta como volumen, pero el directorio
# debe existir con el dueño correcto antes de montar.
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data

COPY --from=builder /app/public ./public

# La salida standalone ya trae el servidor y solo las dependencias necesarias.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migraciones y herramientas de operación, para correrlas desde el propio
# contenedor: drizzle/ trae el SQL, que se aplica con psql (ver
# .github/workflows/desplegar.yml). herramientas/seed.cjs y crear-admin.cjs
# son el seed y la creación de administradores ya empaquetados en CJS; se
# ejecutan con `docker compose exec app node herramientas/<script>.cjs` y
# resuelven @node-rs/argon2, pg-native y el resto de externos desde el
# node_modules que trae la salida standalone.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/herramientas ./herramientas

# Caché de Next (fetch-cache, unstable_cache, optimizador de imágenes). Si no
# existe con el dueño correcto, el bind mount de la caché de imágenes la crea
# como root y Next falla con EACCES al escribir en ella.
RUN mkdir -p /app/.next/cache && chown nextjs:nodejs /app/.next /app/.next/cache

USER nextjs

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
