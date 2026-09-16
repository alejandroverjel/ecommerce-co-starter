#!/usr/bin/env bash
#
# Purga la caché de Cloudflare de esta tienda.
#
# Va SIEMPRE después de un deploy: Cloudflare cachea HTML y estáticos en su
# borde, así que sin purgar la gente sigue viendo la versión anterior aunque el
# contenedor ya tenga la nueva. Es el paso que más veces se olvida y el que
# hace parecer que "el deploy no sirvió".
#
# El token y la zona NO viven aquí: los resuelve /opt/infra/scripts/purgar-cache.sh
# en el VPS, con el mismo token que ya está ahí para los certificados (permisos
# de DNS + Cache Purge). Este script solo dispara esa purga por SSH.
#
# Uso:
#   VPS=usuario@ip TIENDA=mi-tienda ./scripts/purgar-cache.sh
set -euo pipefail

VPS="${VPS:?Define VPS=usuario@ip}"
TIENDA="${TIENDA:?Define TIENDA}"

ssh -o BatchMode=yes "$VPS" "/opt/infra/scripts/purgar-cache.sh $TIENDA"
