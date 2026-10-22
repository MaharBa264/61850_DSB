# Servidor DSB (usuarios, proyectos y versiones)

Node.js 22 + Fastify + PostgreSQL. Sin build: se ejecuta con `node src/main.mjs`.
Se despliega con `deploy/install-api.sh` (ver `deploy/README.md`).

## Variables de entorno
| Variable | Por defecto | |
|---|---|---|
| `DSB_DATABASE_URL` | `postgres://dsb@localhost/dsb` | En producción: `postgres://dsb@/dsb?host=/var/run/postgresql` (socket, sin clave) |
| `DSB_API_HOST` / `DSB_API_PORT` | `127.0.0.1` / `3000` | Solo detrás de nginx |
| `DSB_ADMIN_PASSWORD` | aleatoria | Clave del primer `admin` (solo si no hay usuarios) |
| `DSB_SECURE_COOKIE` | `0` | `1` con HTTPS |
| `DSB_SESSION_HOURS` | `12` | Sesión deslizante |
| `DSB_LOCK_SECONDS` | `120` | Vencimiento del bloqueo de edición (el cliente lo renueva cada 30 s) |
| `DSB_MAX_CONTENT_MB` | `64` | Tamaño máximo de un SCL |

## Modelo
- Usuarios (`admin`/`user`), sesiones por cookie `HttpOnly`, contraseñas con scrypt, freno a la fuerza bruta, clave temporal obligatoria de cambiar.
- Proyecto: dueño + visibilidad `private` / `shared` / `public` + miembros (`viewer`/`editor`). Sin acceso responde 404.
- Versión: foto completa, comprimida, inmutable (`number`, `parent_number`, autor, mensaje, SHA-256). Restaurar crea una versión nueva.
- Un editor a la vez por proyecto (bloqueo con vencimiento); un borrador por usuario y proyecto; hitos con nombre; auditoría.
- Toda escritura exige el encabezado `x-dsb: 1` (defensa CSRF).

## Pruebas
Necesitan una base PostgreSQL descartable (se borra el esquema `public`):

```bash
DSB_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/dsb_test npm test
```
