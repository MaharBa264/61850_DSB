#!/usr/bin/env bash
# DSB — compila la app y la instala, todo desde el propio servidor (Rocky 8.x).
# Ejecutar como usuario normal con sudo, desde cualquier lugar del repo clonado:
#   ./deploy/build-and-install.sh                 # git pull + compilar + instalar
#   DSB_PORT=8096 ./deploy/build-and-install.sh   # puerto distinto del 8095
#   DSB_NO_PULL=1 ./deploy/build-and-install.sh   # sin git pull (usar lo que ya está clonado)
# Requisitos: git, Node.js >= 22 y npm (sudo dnf install -y nodejs npm), salida a internet.
# pnpm se instala SOLO en tu usuario (~/.local), sin tocar el sistema.
set -euo pipefail

main() {
  cd "$(dirname "$0")/.."

  command -v node >/dev/null || { echo "Falta Node.js >= 22:  sudo dnf module enable -y nodejs:22 && sudo dnf install -y nodejs npm"; exit 1; }
  command -v npm  >/dev/null || { echo "Falta npm:  sudo dnf install -y npm"; exit 1; }
  local node_major
  node_major="$(node -p "process.versions.node.split('.')[0]")"
  (( node_major >= 22 )) || { echo "Node $(node -v) es muy viejo: se necesita >= 22."; exit 1; }

  # pnpm local al usuario (no global)
  local want=11.5.0
  export PATH="$HOME/.local/bin:$PATH"
  if [[ "$(pnpm --version 2>/dev/null || true)" != "$want" ]]; then
    npm install -g "pnpm@${want}" --prefix "$HOME/.local"
  fi

  [[ "${DSB_NO_PULL:-0}" == 1 ]] || git pull --ff-only

  pnpm install --frozen-lockfile
  pnpm run build
  git rev-parse HEAD > dist/VERSION

  local tar=/tmp/dsb-dist.tar.gz
  tar -czf "$tar" -C dist .
  sudo env DSB_PORT="${DSB_PORT:-8095}" bash deploy/install-rocky.sh "$tar"
}
# Todo el cuerpo está en una función para que 'git pull' no altere el script mientras se ejecuta
main "$@"
exit $?
