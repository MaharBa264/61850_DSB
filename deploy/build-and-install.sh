#!/usr/bin/env bash
# DSB — compila la app y la instala, todo desde el propio servidor (Rocky 8.x).
# Ejecutar como usuario normal con sudo, desde cualquier lugar del repo clonado:
#   ./deploy/build-and-install.sh                 # git pull + compilar + instalar (puerto 8095)
#   DSB_PORT=8096 ./deploy/build-and-install.sh   # otro puerto
#   DSB_NO_PULL=1 ./deploy/build-and-install.sh   # sin git pull (usar lo que ya está clonado)
# Requisitos: git, Node.js >= 22, salida a internet (npm y plugins externos).
set -euo pipefail
cd "$(dirname "$0")/.."

command -v node >/dev/null || { echo "Falta Node.js >= 22. Ver deploy/README.md (sección 'Preparar el servidor')."; exit 1; }
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
(( NODE_MAJOR >= 22 )) || { echo "Node $(node -v) es muy viejo: se necesita >= 22."; exit 1; }
command -v pnpm >/dev/null || sudo npm install -g pnpm@11.5.0

[[ "${DSB_NO_PULL:-0}" == 1 ]] || git pull --ff-only

pnpm install --frozen-lockfile
pnpm run build
git rev-parse HEAD > dist/VERSION

TAR=/tmp/dsb-dist.tar.gz
tar -czf "$TAR" -C dist .
sudo env DSB_PORT="${DSB_PORT:-8095}" bash deploy/install-rocky.sh "$TAR"
