#!/usr/bin/env bash
# DSB — instala/actualiza la app web en Rocky Linux 8.x
# Uso (como root):  ./install-rocky.sh dsb-dist.tar.gz
set -euo pipefail

PKG="${1:-}"
WEBROOT=/var/www/dsb
HERE="$(cd "$(dirname "$0")" && pwd)"

[[ $EUID -eq 0 ]] || { echo "Ejecutar como root (o con sudo)."; exit 1; }
[[ -f "$PKG" ]]   || { echo "Uso: $0 <dsb-dist.tar.gz>"; exit 1; }

if ! command -v nginx >/dev/null; then
  dnf -y install nginx
fi

# Backup de la config previa (una sola vez)
[[ -f /etc/nginx/nginx.conf.orig ]] || cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.orig
install -m 644 "$HERE/nginx/nginx.conf" /etc/nginx/nginx.conf

# Publicación atómica: se extrae en un directorio nuevo y se intercambia
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

# SELinux: etiqueta de contenido web
if command -v restorecon >/dev/null; then restorecon -R "$WEBROOT"; fi

# Firewall
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http >/dev/null
  firewall-cmd --reload >/dev/null
fi

nginx -t
systemctl enable --now nginx
systemctl reload nginx

# Conserva solo las 3 versiones previas más recientes
ls -dt ${WEBROOT}.prev-* 2>/dev/null | tail -n +4 | xargs -r rm -rf

echo "OK. Versión publicada: $(cat "$WEBROOT/VERSION" 2>/dev/null || echo desconocida)"
echo "Probar:  curl -I http://localhost/"
