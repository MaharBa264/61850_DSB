# Despliegue de DSB en Rocky Linux 8.10 (172.17.1.170)

La app es 100 % estática (HTML/JS): en el servidor solo hace falta **nginx**. No requiere Node, Java ni base de datos.

**Puerto: 8095** (el 80 ya lo usa otra aplicación). Se instala un nginx **dedicado** (servicio `dsb-nginx`, config en `/etc/dsb/`) que
**no modifica** `/etc/nginx` ni el servicio existente. Antes de instalar, ver si el puerto está libre:
`ss -ltnp | grep :8095` (sin salida = libre; el script también lo comprueba y aborta si está ocupado).

## 1. Obtener el paquete

GitHub genera `dsb-dist.tar.gz` en cada push a `main` (workflow **DSB Build**):

1. Repo → pestaña **Actions** → corrida más reciente de *DSB Build* → **Artifacts → dsb-dist**.
2. Descargar y descomprimir el ZIP que entrega GitHub: adentro está `dsb-dist.tar.gz`.

> Alternativa sin GitHub Actions: en una máquina con internet, `pnpm install && pnpm build`, y
> `tar -czf dsb-dist.tar.gz -C dist .` (el `pnpm install` descarga plugins externos desde la red).

## 2. Copiar e instalar

Desde una máquina de la LAN (PowerShell/Windows 10+ trae `scp`), con la carpeta `deploy/` del repo:

```bash
scp -r deploy dsb-dist.tar.gz usuario@172.17.1.170:/tmp/
ssh usuario@172.17.1.170
sudo bash /tmp/deploy/install-rocky.sh /tmp/dsb-dist.tar.gz
```

El script: instala el paquete `nginx` (sin habilitar el servicio estándar), crea el servicio `dsb-nginx`, publica la app en
`/var/www/dsb` de forma atómica (conserva las 3 versiones previas), etiqueta SELinux (incluido el permiso del puerto, con
`semanage`), abre el puerto en firewalld y arranca el servicio. Otro puerto: `sudo DSB_PORT=8096 bash /tmp/deploy/install-rocky.sh ...`

## 3. Verificar

```bash
curl -I http://172.17.1.170:8095/
systemctl status dsb-nginx
cat /var/www/dsb/VERSION        # commit publicado
```

Abrir `http://172.17.1.170:8095/` → *Open project* → cargar un SCD → pestaña **Editor GOOSE (DSB)**.

## Actualizar a una versión nueva
Repetir los pasos 1 y 2 (el script es idempotente). Para volver atrás:
`mv /var/www/dsb /var/www/dsb.bad && mv /var/www/dsb.prev-<fecha> /var/www/dsb && systemctl reload dsb-nginx`.

## Desinstalar
`systemctl disable --now dsb-nginx && rm -rf /etc/systemd/system/dsb-nginx.service /etc/dsb /var/www/dsb* && systemctl daemon-reload`
(y `firewall-cmd --permanent --remove-port=8095/tcp && firewall-cmd --reload`). La otra app del puerto 80 no se ve afectada.

## Estado de verificación
- Probado: build de producción servido de forma estática en un entorno Linux; la pestaña DSB abre un SCD real.
- **No probado**: `install-rocky.sh` y `nginx.conf` en un Rocky 8.10 real (no hay acceso desde donde se desarrolló;
  tampoco se pudo correr `nginx -t`). Ante cualquier error, `journalctl -u dsb-nginx -n 30` indica el motivo.
- Si un firewall de red entre tu PC y el servidor bloquea el 8095, habrá que habilitarlo ahí (no depende del Rocky).
