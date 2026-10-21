# Despliegue de DSB en Rocky Linux 8.10 (172.17.1.170)

La app es 100 % estática (HTML/JS): en el servidor solo hace falta **nginx**. No requiere Node, Java ni base de datos.

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

El script instala nginx (dnf), publica en `/var/www/dsb` de forma atómica (conserva las 3 versiones
previas), ajusta SELinux (`restorecon`), abre el puerto 80 en firewalld y recarga nginx.
**Reemplaza `/etc/nginx/nginx.conf`** (deja copia en `nginx.conf.orig`).

## 3. Verificar

```bash
curl -I http://172.17.1.170/
cat /var/www/dsb/VERSION        # commit publicado
```

Abrir `http://172.17.1.170/` → *Open project* → cargar un SCD → pestaña **Editor GOOSE (DSB)**.

## Actualizar a una versión nueva
Repetir los pasos 1 y 2 (el script es idempotente). Para volver atrás:
`mv /var/www/dsb /var/www/dsb.bad && mv /var/www/dsb.prev-<fecha> /var/www/dsb && systemctl reload nginx`.

## Estado de verificación
- Probado: build de producción servido de forma estática en un entorno Linux; la pestaña DSB abre un SCD real.
- **No probado**: `install-rocky.sh` y `nginx.conf` en un Rocky 8.10 real (no hay acceso desde donde se desarrolló;
  tampoco se pudo correr `nginx -t`). Ante cualquier error, `nginx -t` indica la línea.
- Si el firewall o un proxy corporativo bloquea el puerto 80, ajustar `listen` en `nginx.conf`.
