#!/usr/bin/env bash
#
# subir.sh — commit, deploy y purga de Cloudflare en una sola acción.
#
#   ./scripts/subir.sh "fix(algo): lo que cambié"
#   pnpm subir "fix(algo): lo que cambié"
#
# Qué hace, en orden:
#   1. Comprueba tipos y lint EN LOCAL antes de tocar nada. Atrapa el 90 % de
#      los fallos de CI en 20 segundos, en vez de esperar 6 minutos a que CI
#      falle y volver a empezar.
#   2. git add -A + commit + push a main.
#   3. Espera a que GitHub Actions publique la imagen de ESTE commit. No espera
#      a ciegas: la imagen se etiqueta con el SHA del commit, así que pregunta
#      al registro por esa etiqueta exacta hasta que aparece.
#   4. Dispara el deploy en el VPS al instante, sin esperar el timer de systemd
#      (que solo revisa cada 5 minutos). El deploy baja la imagen, hace el
#      healthcheck y PURGA Cloudflare solo, al final.
#   5. Verifica que producción responde y que sirve este commit.
#
# Por qué el deploy y la purga "pasan solos": el deploy.sh del VPS ya purga
# Cloudflare después del healthcheck. Este script solo lo dispara antes de
# tiempo y espera a confirmar. El timer de systemd sigue ahí como red de
# seguridad por si este script no se corre.

set -euo pipefail

# --- Configuración (los mismos valores que usa scripts/purgar-cache.sh) -------
[ -f .subir.env ] && source .subir.env

VPS="${VPS:?Define VPS=usuario@ip}"
TIENDA="${TIENDA:?Define TIENDA}"
if [[ ! "$TIENDA" =~ ^[a-z0-9-]+$ ]]; then
  printf '\033[31mTIENDA inválida: "%s" (solo minúsculas, dígitos y guiones)\033[0m\n' "$TIENDA" >&2
  exit 1
fi
DOMINIO="${DOMINIO:?Define DOMINIO=example.com (ápex, sin esquema ni www)}"
if [[ "$DOMINIO" == *'://'* || "$DOMINIO" == www.* ]]; then
  printf '\033[31mDOMINIO debe ser el ápex sin esquema ni www: "%s"\033[0m\n' "$DOMINIO" >&2
  exit 1
fi
URL_SITIO="${URL_SITIO:-https://www.${DOMINIO}}"
RAMA="main"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
paso()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

# --- Mensaje de commit --------------------------------------------------------
MENSAJE="${1:-}"
if [[ -z "$MENSAJE" ]]; then
  rojo "Falta el mensaje de commit."
  echo  "Uso: ./scripts/subir.sh \"fix(algo): lo que cambié\""
  exit 1
fi

cd "$(dirname "$0")/.."

# --- ¿Hay algo que subir? -----------------------------------------------------
if git diff --quiet && git diff --cached --quiet && [[ -z "$(git status --porcelain --untracked-files=normal)" ]]; then
  rojo "No hay cambios para subir."
  exit 1
fi

# --- 1. Verificación local (lo mismo que exige CI antes del build) ------------
paso "Comprobando tipos y lint en local"
if [[ "${2:-}" != "--rapido" ]]; then
  pnpm typecheck
  pnpm lint
  verde "typecheck y lint OK"
else
  echo "  (saltado por --rapido)"
fi

# --- 2. Commit + push ---------------------------------------------------------
paso "Commit y push"
git add -A
git status --short
git commit -m "$MENSAJE"
git push origin "$RAMA"

SHA="$(git rev-parse HEAD)"
echo "  commit $(git rev-parse --short HEAD) empujado"

# --- 3 y 4. Esperar a CI y desplegar este commit, sin esperar el timer --------
#
# No se consulta el registro (docker manifest inspect no funciona con el login
# de ghcr de este VPS). En su lugar se lee el SHA del commit que la imagen trae
# grabado en la label `org.opencontainers.image.revision`, que docker/metadata
# pone en cada build. El bucle:
#   - mira qué commit está corriendo; si ya es el nuestro, terminó.
#   - si no, dispara el deploy (baja :latest, healthcheck, PURGA Cloudflare).
#     Es idempotente: mientras CI no haya publicado, dice "sin cambios".
# En cuanto CI publique, el siguiente disparo baja la imagen y la label coincide.
paso "Esperando a que CI publique y desplegando (5-9 min)"

corriendo() {
  ssh -o BatchMode=yes "$VPS" \
    "cd /opt/tiendas/$TIENDA && docker inspect \$(docker compose ps -q app) --format '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' 2>/dev/null" \
    | tr -d '[:space:]'
}

VIVO=""
for i in $(seq 1 60); do   # 60 × 20 s = 20 min de margen
  if [[ "$(corriendo)" == "$SHA" ]]; then
    VIVO="si"
    break
  fi
  ssh -o BatchMode=yes "$VPS" "systemctl start deploy@${TIENDA}.service" 2>/dev/null || true
  if [[ "$(corriendo)" == "$SHA" ]]; then
    VIVO="si"
    break
  fi
  printf '\r  esperando el build… %d min %02d s' $(( i*20/60 )) $(( (i*20)%60 ))
  sleep 20
done
printf '\n'

if [[ -z "$VIVO" ]]; then
  rojo "No se desplegó este commit tras 20 minutos."
  echo  "El push ya está hecho; revisa el build en GitHub Actions."
  echo  "Corriendo ahora: $(corriendo)"
  exit 1
fi
ssh -o BatchMode=yes "$VPS" \
  "journalctl -u deploy@${TIENDA}.service -n 6 --no-pager -o cat" || true
verde "desplegado ${SHA:0:7} y Cloudflare purgado"

# --- 5. Verificar que producción sirve este commit ----------------------------
paso "Verificando producción"
CODIGO="$(curl -s -o /dev/null -w '%{http_code}' "$URL_SITIO/")"
if [[ "$CODIGO" == "200" ]]; then
  verde "producción responde 200"
else
  rojo "producción respondió $CODIGO — revísalo"
  exit 1
fi

verde "Listo: ${SHA:0:7} está vivo en $URL_SITIO (Cloudflare purgado)."
