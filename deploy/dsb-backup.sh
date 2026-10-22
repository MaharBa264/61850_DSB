#!/usr/bin/env bash
# DSB — respaldo diario de la base (usuarios, proyectos y TODAS las versiones).
# Lo ejecuta el temporizador dsb-backup.timer. Guarda 30 días en /var/backups/dsb.
# Restaurar:  sudo -u postgres /usr/pgsql-NN/bin/pg_restore --clean --if-exists -d dsb /var/backups/dsb/ARCHIVO.dump
set -euo pipefail
DIR=/var/backups/dsb
install -d -m 700 "$DIR"
OUT="$DIR/dsb-$(date +%Y-%m-%d_%H%M).dump"
cd /
# el PostgreSQL puede ser de PGDG (/usr/pgsql-NN/bin); el instalador lo deja en api.env
PGBIN="${DSB_PGBIN:-}"
runuser -u postgres -- "${PGBIN:+$PGBIN/}pg_dump" --format=custom dsb > "$OUT.part"
mv "$OUT.part" "$OUT"
find "$DIR" -name 'dsb-*.dump' -mtime +30 -delete
echo "Respaldo: $OUT ($(du -h "$OUT" | cut -f1))"
