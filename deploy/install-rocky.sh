#!/usr/bin/env bash
# DSB — instala/actualiza la app web en Rocky Linux 8.x con un nginx DEDICADO (servicio dsb-nginx).
# No modifica /etc/nginx ni el servicio nginx existente. Puerto por defecto: 8095.
#
# Uso (como root):
#   ./install-rocky.sh dsb-dist.tar.gz
#   DSB_PORT=8096 ./install-rocky.sh dsb-dist.tar.gz     # otro puerto
set -euo pipefail

PKG="${1:-}"
PORT="${DSB_PORT:-8095}"
API_PORT="${DSB_API_PORT:-3095}"
WEBROOT=/var/www/dsb
CONF=/etc/dsb/nginx.conf
UNIT=/etc/systemd/system/dsb-nginx.service
HERE="$(cd "$(dirname "$0")" && pwd)"

[[ $EUID -eq 0 ]] || { echo "Ejecutar como root (o con sudo)."; exit 1; }
[[ -f "$PKG" ]]   || { echo "Uso: $0 <dsb-dist.tar.gz>"; exit 1; }
[[ "$PORT" =~ ^[0-9]+$ && $PORT -ge 1024 && $PORT -le 65535 ]] || { echo "Puerto inválido: $PORT"; exit 1; }

# 1) El puerto debe estar libre (salvo que lo esté usando nuestro propio servicio, en una actualización)
if ss -ltn "( sport = :$PORT )" | grep -q LISTEN && ! systemctl is-active --quiet dsb-nginx; then
  echo "El puerto $PORT ya está en uso por otro servicio:"; ss -ltnp "( sport = :$PORT )" || true
  echo "Elegí otro:  DSB_PORT=<puerto> $0 $PKG"; exit 1
fi

# 2) nginx (solo el paquete; NO se habilita ni se toca nginx.service)
command -v /usr/sbin/nginx >/dev/null || dnf -y install nginx

# 3) Configuración y servicio propios
install -d -m 755 /etc/dsb
sed -e "s/@PORT@/${PORT}/g" -e "s/@API_PORT@/${API_PORT}/g" "$HERE/dsb-nginx.conf" > "$CONF"
chmod 644 "$CONF"
install -m 644 "$HERE/dsb-nginx.service" "$UNIT"

# 4) Publicación atómica del contenido
STAMP="$(date +%Y%m%d-%H%M%S)"
NEW="${WEBROOT}.new-${STAMP}"
mkdir -p "$NEW"
tar -xzf "$PKG" -C "$NEW"
[[ -f "$NEW/index.html" ]] || { echo "El paquete no contiene index.html"; rm -rf "$NEW"; exit 1; }
[[ -d "$WEBROOT" ]] && mv "$WEBROOT" "${WEBROOT}.prev-${STAMP}"
mv "$NEW" "$WEBROOT"
chown -R root:root "$WEBROOT"
find "$WEBROOT" -type d -exec chmod 755 {} +
find "$WEBROOT" -type f -exec chmod 644 {} +

# 5) SELinux: etiqueta del contenido y permiso para que nginx use el puerto
if command -v getenforce >/dev/null && [[ "$(getenforce)" != "Disabled" ]]; then
  restorecon -R "$WEBROOT"
  if ! semanage port -l 2>/dev/null | grep -E "^http_port_t" | grep -qw "$PORT"; then
    command -v semanage >/dev/null || dnf -y install policycoreutils-python-utils
    semanage port -a -t http_port_t -p tcp "$PORT" 2>/dev/null || semanage port -m -t http_port_t -p tcp "$PORT"
  fi
fi

# nginx (httpd_t) debe poder conectarse al servidor de la API en 127.0.0.1:$API_PORT
if command -v getenforce >/dev/null && [[ "$(getenforce)" != "Disabled" ]]; then
  if ! semanage port -l 2>/dev/null | grep -E "^http_port_t" | grep -qw "$API_PORT"; then
    command -v semanage >/dev/null || dnf -y install policycoreutils-python-utils
    semanage port -a -t http_port_t -p tcp "$API_PORT" 2>/dev/null || semanage port -m -t http_port_t -p tcp "$API_PORT"
  fi
fi

# 6) Firewall
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-port="${PORT}/tcp" >/dev/null
  firewall-cmd --reload >/dev/null
fi

# 7) Servicio
nginx -t -c "$CONF" -g 'daemon off;'
# 'nginx -t' crea el archivo PID con la etiqueta SELinux de ESTA shell; el servicio (httpd_t) no podria usarlo
rm -f /run/dsb-nginx.pid
systemctl reset-failed dsb-nginx 2>/dev/null || true
systemctl daemon-reload
systemctl enable dsb-nginx >/dev/null
systemctl restart dsb-nginx

# Conserva solo las 3 versiones previas más recientes
ls -dt ${WEBROOT}.prev-* 2>/dev/null | tail -n +4 | xargs -r rm -rf

echo "OK. Versión publicada: $(cat "$WEBROOT/VERSION" 2>/dev/null || echo desconocida)"
echo "Abrir:   http://$(hostname -I | awk '{print $1}'):${PORT}/"
echo "Estado:  systemctl status dsb-nginx   |   Logs: /var/log/nginx/dsb-*.log"
