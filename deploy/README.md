# Despliegue de DSB en Rocky Linux 8.10 (172.17.1.170)

La app web es estática (HTML/JS) y se sirve con **nginx**. Desde la versión con usuarios y proyectos hay además un **servidor de proyectos**
(servicio `dsb-api`: Node.js + PostgreSQL) al que nginx le pasa `/api`. Ver la sección "Usuarios, proyectos y versiones" más abajo.

**Puerto: 8095** (el 80 ya lo usa otra aplicación). Se instala un nginx **dedicado** (servicio `dsb-nginx`, config en `/etc/dsb/`) que
**no modifica** `/etc/nginx` ni el servicio existente. Antes de instalar, ver si el puerto está libre:
`ss -ltnp | grep :8095` (sin salida = libre; el script también lo comprueba y aborta si está ocupado).

## Opción A (recomendada): clonar y compilar en el servidor

Requiere que el servidor tenga **salida a internet** (GitHub y npm). Todo desde PowerShell, por SSH.

```powershell
ssh TU_USUARIO@172.17.1.170
```

**Preparar el servidor (una sola vez)**

```bash
sudo dnf install -y git
dnf module list nodejs            # ver qué streams hay; se necesita Node 22 o superior
sudo dnf module enable -y nodejs:22 && sudo dnf install -y nodejs npm
node -v                           # debe mostrar v22.x o mayor
```

Si `nodejs:22` no existe en ese listado, usar NodeSource:
`sudo dnf module reset -y nodejs && curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo dnf install -y nodejs`
(en Rocky 8, `npm` es un paquete aparte con el stream de AppStream: `nodejs npm`; NodeSource lo trae incluido)

**Clonar, compilar e instalar**

```bash
ss -ltnp | grep :8095             # sin salida = puerto libre
git clone https://github.com/MaharBa264/61850_DSB.git
cd 61850_DSB
./deploy/build-and-install.sh
```

pnpm se instala solo en tu usuario (`~/.local`), sin `sudo` ni cambios globales. Tarda varios minutos la primera vez (descarga dependencias). Al terminar imprime la URL. Probar en el navegador:
`http://172.17.1.170:8095/`

**Actualizar más adelante** (cuando haya cambios nuevos en GitHub):

```bash
ssh TU_USUARIO@172.17.1.170
cd ~/61850_DSB && ./deploy/build-and-install.sh
```

Si el servidor sale a internet por proxy: `export https_proxy=http://PROXY:PUERTO` antes de `git clone` y del script, y
`npm config set proxy` / `https-proxy` para npm.

## Opción B: si el servidor NO tiene internet

El paquete se genera en GitHub (workflow **DSB Build**): repo → **Actions** → última corrida de *DSB Build* →
**Artifacts → dsb-dist** (hay que iniciar sesión en GitHub). Descomprimir el ZIP: adentro está `dsb-dist.tar.gz`.
También necesitás la carpeta `deploy/` (en el repo, "Code → Download ZIP", o un `git clone` en tu PC). Desde PowerShell:

```powershell
scp .\dsb-dist.tar.gz TU_USUARIO@172.17.1.170:/tmp/
scp -r .\deploy TU_USUARIO@172.17.1.170:/tmp/
ssh TU_USUARIO@172.17.1.170
sudo bash /tmp/deploy/install-rocky.sh /tmp/dsb-dist.tar.gz
```

## Usuarios, proyectos y versiones (servicio `dsb-api`)

`build-and-install.sh` instala también el servidor de proyectos (`deploy/install-api.sh`):

- **PostgreSQL**: si el servidor ya lo tiene instalado se usa tal cual (solo se agrega el rol y la base `dsb`; no se toca nada más); si no, instala el módulo `postgresql:15` de Rocky.
  El servicio entra a la base por el **socket local** con el usuario del sistema `dsb` (autenticación `peer`): no hay contraseña de base que guardar.
- **Servicio** `dsb-api` (usuario `dsb`, solo escucha en `127.0.0.1:3095`), código en `/opt/dsb/server`, configuración en `/etc/dsb/api.env`.
- **Usuario inicial**: al terminar el primer despliegue se muestra **una sola vez** el usuario `admin` y su contraseña temporal (se obliga a cambiarla al ingresar).
  Si se pierde: `sudo -u postgres psql dsb -c "DELETE FROM users WHERE username='admin'"` y `sudo systemctl restart dsb-api` genera uno nuevo solo si no queda ningún usuario;
  en otro caso, otro administrador la restablece desde la pestaña *Usuarios*.
- **Respaldo diario** a las 02:30 (`dsb-backup.timer`) en `/var/backups/dsb`, 30 días. Contiene usuarios, proyectos y **todas las versiones**.
  Probar a mano: `sudo /usr/local/sbin/dsb-backup.sh`. Restaurar: `sudo -u postgres pg_restore --clean --if-exists -d dsb /var/backups/dsb/ARCHIVO.dump`.
  Conviene copiar esa carpeta periódicamente a otro equipo.
- **HTTPS**: hoy se sirve por HTTP en la red interna, por lo que la contraseña y la sesión viajan sin cifrar. Antes de uso real conviene un certificado interno en el nginx
  y poner `DSB_SECURE_COOKIE=1` en `/etc/dsb/api.env` (luego `sudo systemctl restart dsb-api`).
- Diagnóstico: `systemctl status dsb-api`, `journalctl -u dsb-api -n 40`, `curl http://127.0.0.1:3095/api/health`, `sudo ausearch -m avc -ts recent` (SELinux).
- La opción B (sin internet) no instala el servidor de proyectos: necesita `npm ci` con acceso al registro de npm.

## Qué hace el instalador

`install-rocky.sh` (lo llama la opción A) instala el paquete `nginx` (sin habilitar el servicio estándar), crea el servicio
`dsb-nginx`, publica la app en `/var/www/dsb` de forma atómica (conserva las 3 versiones previas), etiqueta SELinux
(incluido el permiso del puerto, con `semanage`), abre el puerto en firewalld y arranca el servicio.
Otro puerto: `DSB_PORT=8096 ./deploy/build-and-install.sh`.

## 3. Verificar

```bash
curl -I http://172.17.1.170:8095/
systemctl status dsb-nginx
cat /var/www/dsb/VERSION        # commit publicado
```

Abrir `http://172.17.1.170:8095/` → iniciar sesión → *Nuevo proyecto* (vacío o desde un archivo SCD) → pestañas numeradas del 1 al 7.

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

## Problemas conocidos
- **`open() "/run/dsb-nginx.pid" failed (13: Permission denied)`** (SELinux): el archivo PID quedó con una etiqueta incorrecta.
  `sudo rm -f /run/dsb-nginx.pid && sudo systemctl reset-failed dsb-nginx && sudo systemctl start dsb-nginx`.
  (Corregido en el instalador y en el servicio; solo afecta a instalaciones anteriores al commit que lo arregla.)
- Diagnóstico general: `systemctl status dsb-nginx -l`, `journalctl -u dsb-nginx -n 30`, `sudo ausearch -m avc -ts recent`.
