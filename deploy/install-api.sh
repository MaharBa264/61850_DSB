#!/usr/bin/env bash
# DSB — instala/actualiza el servidor de usuarios, proyectos y versiones en Rocky Linux 8.x.
# Lo llama build-and-install.sh; también se puede usar solo:
#   sudo bash install-api.sh dsb-server.tar.gz
# Hace: usa el PostgreSQL existente (o lo instala si no hay) + base "dsb" con acceso por socket local (sin contraseñas de base),
# servicio dsb-api, respaldo diario. No toca otras bases de datos ni otros servicios.
set -euo pipefail

PKG="${1:-}"
API_PORT="${DSB_API_PORT:-3095}"
APP=/opt/dsb/server
ENVF=/etc/dsb/api.env
HERE="$(cd "$(dirname "$0")" && pwd)"

[[ $EUID -eq 0 ]] || { echo "Ejecutar como root (o con sudo)."; exit 1; }
[[ -f "$PKG" ]]   || { echo "Uso: $0 <dsb-server.tar.gz>"; exit 1; }
[[ "$API_PORT" =~ ^[0-9]+$ && $API_PORT -ge 1024 && $API_PORT -le 65535 ]] || { echo "Puerto de API inválido: $API_PORT"; exit 1; }
NODE="$(command -v node)" || { echo "Falta Node.js >= 22"; exit 1; }
cd /

# 1) PostgreSQL: se usa el que ya exista en el servidor (cualquier origen: AppStream, PGDG, etc.)
#    y solo si no hay ninguno se instala el módulo de Rocky. Nunca se toca una instancia existente.
PGUNIT="${DSB_PGUNIT:-}"
if [[ -z "$PGUNIT" ]]; then
  PGUNIT="$(systemctl list-units --type=service --state=active --no-legend 'postgresql*' 2>/dev/null | awk '{print $1}' | head -n1)"
fi
if [[ -z "$PGUNIT" ]]; then
  if ss -ltn '( sport = :5432 )' 2>/dev/null | grep -q LISTEN; then
    echo "Hay un servicio escuchando en el puerto 5432 que no es una unidad systemd 'postgresql*'."
    echo "Indique su unidad:  DSB_PGUNIT=nombre.service $0 $PKG"; exit 1
  fi
  echo "No hay PostgreSQL: instalando PostgreSQL 15 (módulo de Rocky)..."
  rpm -q postgresql-server >/dev/null 2>&1 || { dnf -y module enable postgresql:15; dnf -y install postgresql-server; }
  [[ -d /var/lib/pgsql/data/base ]] || postgresql-setup --initdb
  systemctl enable --now postgresql
  PGUNIT=postgresql.service
fi
echo "PostgreSQL existente: ${PGUNIT}"
# binarios del PostgreSQL en uso (PGDG los instala en /usr/pgsql-NN/bin; el de AppStream, en /usr/bin)
PGBIN="$(ls -d /usr/pgsql-*/bin 2>/dev/null | sort -V | tail -n1 || true)"
[[ -x "${PGBIN:-/nonexistent}/psql" ]] || PGBIN="$(dirname "$(command -v psql)")"

# 2) Usuario del servicio y base. El rol "dsb" entra por el socket local (autenticación "peer": sin contraseña).
id dsb >/dev/null 2>&1 || useradd --system --home-dir /opt/dsb --shell /sbin/nologin dsb
psql_pg() { runuser -u postgres -- "$PGBIN/psql" -v ON_ERROR_STOP=1 -tA "$@"; }
PGSOCK="$(psql_pg -c "SHOW unix_socket_directories" | cut -d, -f1 | tr -d ' ')"
[[ "$PGSOCK" == /* ]] || PGSOCK=/var/run/postgresql
[[ "$(psql_pg -c "SELECT 1 FROM pg_roles WHERE rolname='dsb'")" == 1 ]] || psql_pg -c "CREATE ROLE dsb LOGIN"
[[ "$(psql_pg -c "SELECT 1 FROM pg_database WHERE datname='dsb'")" == 1 ]] || psql_pg -c "CREATE DATABASE dsb OWNER dsb"

# 3) Configuración (se crea una sola vez; los cambios del administrador se conservan)
install -d -m 755 /etc/dsb
if [[ ! -f "$ENVF" ]]; then
  ADMIN_PW="$(head -c 12 /dev/urandom | base64 | tr -d '/+=' | head -c 14)"
  cat > "$ENVF" <<ENV
DSB_DATABASE_URL=postgres://dsb@/dsb?host=${PGSOCK}
# Binarios de PostgreSQL usados por el respaldo.
DSB_PGBIN=${PGBIN}
DSB_API_HOST=127.0.0.1
DSB_API_PORT=${API_PORT}
# Se usa solo mientras no exista ningún usuario; el instalador la borra después del primer arranque.
DSB_ADMIN_PASSWORD=${ADMIN_PW}
# Poner 1 cuando la app se sirva por HTTPS.
DSB_SECURE_COOKIE=0
ENV
  chmod 600 "$ENVF"
fi
# el puerto del env manda (por si se instaló antes con otro)
API_PORT="$(grep -E '^DSB_API_PORT=' "$ENVF" | cut -d= -f2)"

# 4) Código del servidor, publicado de forma atómica
STAMP="$(date +%Y%m%d-%H%M%S)"
NEW="${APP}.new-${STAMP}"
mkdir -p "$NEW"
tar -xzf "$PKG" -C "$NEW"
[[ -f "$NEW/src/main.mjs" ]] || { echo "El paquete no contiene src/main.mjs"; rm -rf "$NEW"; exit 1; }
( cd "$NEW" && npm ci --omit=dev --no-audit --no-fund )
chown -R root:root "$NEW"
chmod -R go+rX "$NEW"
[[ -d "$APP" ]] && mv "$APP" "${APP}.prev-${STAMP}"
mv "$NEW" "$APP"
ls -dt ${APP}.prev-* 2>/dev/null | tail -n +4 | xargs -r rm -rf || true

# 5) Servicio
sed -e "s#@NODE@#${NODE}#" -e "s#@PGUNIT@#${PGUNIT}#" "$HERE/dsb-api.service" > /etc/systemd/system/dsb-api.service
chmod 644 /etc/systemd/system/dsb-api.service
install -m 755 "$HERE/dsb-backup.sh" /usr/local/sbin/dsb-backup.sh
install -m 644 "$HERE/dsb-backup.service" /etc/systemd/system/dsb-backup.service
install -m 644 "$HERE/dsb-backup.timer" /etc/systemd/system/dsb-backup.timer
if command -v getenforce >/dev/null && [[ "$(getenforce)" != "Disabled" ]]; then restorecon -R /opt/dsb /usr/local/sbin/dsb-backup.sh 2>/dev/null || true; fi
systemctl daemon-reload
systemctl enable dsb-api >/dev/null
systemctl enable --now dsb-backup.timer >/dev/null
systemctl restart dsb-api

# 6) Esperar a que responda
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 1
done
if [[ "${OK:-0}" != 1 ]]; then
  echo "El servidor no respondió. Revisar:  journalctl -u dsb-api -n 40   |   sudo ausearch -m avc -ts recent"
  exit 1
fi

# 7) Primer arranque: mostrar la clave inicial una sola vez
if grep -q '^DSB_ADMIN_PASSWORD=' "$ENVF"; then
  PW="$(grep '^DSB_ADMIN_PASSWORD=' "$ENVF" | cut -d= -f2)"
  sed -i '/^DSB_ADMIN_PASSWORD=/d;/^# Se usa solo mientras/d' "$ENVF"
  echo "=================================================================="
  echo " Usuario inicial:  admin"
  echo " Contraseña:       ${PW}"
  echo " (se pide cambiarla al ingresar; no se vuelve a mostrar)"
  echo "=================================================================="
fi
echo "OK. Servidor de proyectos: systemctl status dsb-api   |   Respaldos: /var/backups/dsb (diario 02:30)"
