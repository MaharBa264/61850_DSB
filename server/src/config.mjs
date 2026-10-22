/** Configuración del servidor, toda por variables de entorno (ver deploy/README.md). */
export function loadConfig(env = process.env) {
  return {
    host: env.DSB_API_HOST || '127.0.0.1',
    port: Number(env.DSB_API_PORT) || 3000,
    databaseUrl: env.DSB_DATABASE_URL || 'postgres://dsb@localhost/dsb',
    /** `1` cuando la app se sirve por HTTPS: la cookie de sesión pasa a `Secure`. */
    secureCookie: env.DSB_SECURE_COOKIE === '1',
    /** Clave inicial del administrador (solo se usa si todavía no hay usuarios). */
    adminPassword: env.DSB_ADMIN_PASSWORD || '',
    sessionHours: Number(env.DSB_SESSION_HOURS) || 12,
    lockSeconds: Number(env.DSB_LOCK_SECONDS) || 120,
    maxContentMb: Number(env.DSB_MAX_CONTENT_MB) || 64,
    /** Intentos fallidos de login antes de bloquear, y duración del bloqueo. */
    loginMaxFails: 5,
    loginLockSeconds: 60,
  };
}
