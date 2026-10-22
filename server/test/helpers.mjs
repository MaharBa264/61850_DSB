import { buildApp, ensureAdmin } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';
import { createPool, migrate } from '../src/db.mjs';

export const DB = process.env.DSB_TEST_DATABASE_URL;

export const SCL = (tag = 'x') => `<?xml version="1.0" encoding="UTF-8"?>\n<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B" release="4"><Header id="${tag}"/></SCL>`;

/** Base limpia + aplicación + cliente que recuerda la cookie de sesión. */
export async function setup(overrides = {}) {
  const pool = createPool(DB);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  const config = { ...loadConfig({}), adminPassword: 'clave-admin-1', loginMaxFails: 3, loginLockSeconds: 60, ...overrides };
  await ensureAdmin(pool, config, () => 'x');
  const app = await buildApp(pool, config);

  const client = () => {
    let cookie = '';
    const call = async (method, url, body, headers = {}) => {
      const res = await app.inject({
        method,
        url,
        payload: body === undefined ? undefined : body,
        headers: { 'x-dsb': '1', ...(cookie ? { cookie } : {}), ...headers },
      });
      const set = res.headers['set-cookie'];
      if (set) cookie = String(set).split(';')[0].endsWith('=') ? '' : String(set).split(';')[0];
      let json = null;
      try { json = res.json(); } catch { /* no es JSON */ }
      return { status: res.statusCode, json, text: res.body, headers: res.headers };
    };
    return {
      get: (u, h) => call('GET', u, undefined, h),
      post: (u, b) => call('POST', u, b),
      put: (u, b) => call('PUT', u, b),
      patch: (u, b) => call('PATCH', u, b),
      del: u => call('DELETE', u),
      call,
    };
  };

  const login = async (username, password) => {
    const c = client();
    const r = await c.post('/api/auth/login', { username, password });
    if (r.status !== 200) throw new Error(`login ${username}: ${r.status} ${r.text}`);
    return c;
  };

  /** Crea un usuario con clave definitiva y devuelve su cliente ya logueado. */
  const admin = await login('admin', 'clave-admin-1');
  await admin.post('/api/auth/password', { current: 'clave-admin-1', next: 'clave-admin-2' });
  const newUser = async (username, role = 'user') => {
    const r = await admin.post('/api/users', { username, displayName: username.toUpperCase(), password: 'clave-temporal', role, mustChange: false });
    if (r.status !== 201) throw new Error(`newUser ${username}: ${r.status} ${r.text}`);
    return { id: r.json.user.id, c: await login(username, 'clave-temporal') };
  };

  return { app, pool, client, login, admin, newUser, close: async () => { await app.close(); await pool.end(); } };
}
