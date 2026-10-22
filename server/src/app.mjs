import { gunzipSync, gzipSync } from 'node:zlib';

import Fastify from 'fastify';

import {
  COOKIE,
  DUMMY_HASH,
  hashPassword,
  HttpError,
  LoginLimiter,
  newToken,
  parseCookies,
  sessionCookie,
  sha256,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './auth.mjs';
import { migrate, tx } from './db.mjs';

const VISIBILITIES = ['private', 'shared', 'public'];
const MEMBER_ROLES = ['viewer', 'editor'];

const tokenHash = token => sha256(token);

const publicUser = u => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  role: u.role,
  active: u.active,
  mustChange: u.must_change,
});

/** Un SCL mínimamente razonable: raíz `<SCL>`; la validación fina la hace el cliente. */
export function validateScl(text, maxBytes) {
  if (typeof text !== 'string' || !text.trim()) return 'El contenido está vacío.';
  if (Buffer.byteLength(text) > maxBytes) return 'El archivo es demasiado grande.';
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<SCL[\s>]/.test(text)) return 'No parece un archivo SCL (falta la raíz <SCL>).';
  if (!/<\/SCL>\s*$|\/>\s*$/.test(text)) return 'El archivo SCL está incompleto.';
  return null;
}

const str = (v, field, min, max) => {
  if (typeof v !== 'string') throw new HttpError(400, `Falta ${field}.`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new HttpError(400, `${field}: entre ${min} y ${max} caracteres.`);
  return t;
};

/**
 * Construye la aplicación Fastify. `pool` es un `pg.Pool` ya conectado a una
 * base migrada (ver `migrate`).
 */
export async function buildApp(pool, config) {
  const app = Fastify({ bodyLimit: config.maxContentMb * 1024 * 1024 * 2, logger: config.logger ?? false, trustProxy: true });
  const limiter = new LoginLimiter(config.loginMaxFails, config.loginLockSeconds);
  const maxBytes = config.maxContentMb * 1024 * 1024;

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Error interno del servidor.' });
  });

  const audit = (db, user, action, projectId = null, detail = {}) =>
    db.query('INSERT INTO audit (user_id, username, action, project_id, detail) VALUES ($1,$2,$3,$4,$5)', [user?.id ?? null, user?.username ?? null, action, projectId, JSON.stringify(detail)]);

  // El contenido SCL se sirve como XML: que el navegador nunca lo interprete como página
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    if (String(reply.getHeader('content-type') ?? '').includes('xml')) reply.header('Content-Disposition', 'attachment');
    return payload;
  });

  // ---------- sesión ----------

  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    // defensa CSRF: toda escritura exige un encabezado propio (un sitio ajeno no puede enviarlo)
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-dsb'] !== '1') throw new HttpError(403, 'Solicitud no permitida.');
    if (path === '/api/auth/login' || path === '/api/health') return;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) throw new HttpError(401, 'Inicie sesión.');
    const { rows } = await pool.query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
      [tokenHash(token)]
    );
    if (!rows[0]) throw new HttpError(401, 'La sesión venció. Inicie sesión de nuevo.');
    req.user = rows[0];
    req.token = token;
    // sesión deslizante
    await pool.query(`UPDATE sessions SET expires_at = now() + make_interval(hours => $2) WHERE token_hash = $1`, [tokenHash(token), config.sessionHours]);
    // con clave temporal solo se puede cambiarla o salir
    if (req.user.must_change && path !== '/api/auth/password' && path !== '/api/auth/logout' && path !== '/api/auth/me') throw new HttpError(403, 'Debe cambiar la contraseña antes de continuar.');
  });

  const requireAdmin = req => {
    if (req.user.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede hacer esto.');
  };

  app.get('/api/health', async () => ({ ok: true }));

  // ---------- autenticación ----------

  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Indique usuario y contraseña.');
    const key = `${req.ip}|${username.toLowerCase()}`;
    const wait = limiter.blockedFor(key);
    if (wait) throw new HttpError(429, `Demasiados intentos. Espere ${wait} s.`);
    const { rows } = await pool.query('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
    const user = rows[0];
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok || !user.active) {
      limiter.fail(key);
      await audit(pool, user ?? { username }, 'login_fallido');
      throw new HttpError(401, 'Usuario o contraseña incorrectos.');
    }
    limiter.ok(key);
    const token = newToken();
    await pool.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2, now() + make_interval(hours => $3))`, [tokenHash(token), user.id, config.sessionHours]);
    await pool.query('DELETE FROM sessions WHERE expires_at < now()');
    await audit(pool, user, 'login');
    reply.header('Set-Cookie', sessionCookie(token, { secure: config.secureCookie, maxAgeSeconds: config.sessionHours * 3600 }));
    return { user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(req.token)]);
    await audit(pool, req.user, 'logout');
    reply.header('Set-Cookie', sessionCookie('', { secure: config.secureCookie, maxAgeSeconds: 0 }));
    return { ok: true };
  });

  app.get('/api/auth/me', async req => ({ user: publicUser(req.user) }));

  app.post('/api/auth/password', async req => {
    const { current, next } = req.body ?? {};
    if (!(await verifyPassword(String(current ?? ''), req.user.password_hash))) throw new HttpError(400, 'La contraseña actual no es correcta.');
    const bad = validatePassword(next);
    if (bad) throw new HttpError(400, bad);
    if (next === current) throw new HttpError(400, 'La nueva contraseña debe ser distinta.');
    await pool.query('UPDATE users SET password_hash = $2, must_change = false WHERE id = $1', [req.user.id, await hashPassword(next)]);
    // cierra las demás sesiones de este usuario
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user.id, tokenHash(req.token)]);
    await audit(pool, req.user, 'cambio_password');
    return { ok: true };
  });

  // ---------- usuarios ----------

  app.get('/api/users', async req => {
    requireAdmin(req);
    const { rows } = await pool.query('SELECT * FROM users ORDER BY lower(username)');
    return { users: rows.map(publicUser) };
  });

  /** Lista corta para elegir con quién compartir (cualquier usuario con sesión). */
  app.get('/api/directory', async () => {
    const { rows } = await pool.query('SELECT id, username, display_name FROM users WHERE active ORDER BY lower(display_name)');
    return { users: rows.map(u => ({ id: u.id, username: u.username, displayName: u.display_name })) };
  });

  app.post('/api/users', async (req, reply) => {
    requireAdmin(req);
    const b = req.body ?? {};
    const bad = validateUsername(b.username) ?? validatePassword(b.password);
    if (bad) throw new HttpError(400, bad);
    const role = b.role === 'admin' ? 'admin' : 'user';
    const displayName = str(b.displayName ?? b.username, 'El nombre', 1, 80);
    try {
      const { rows } = await pool.query(
        'INSERT INTO users (username, display_name, password_hash, role, must_change) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [b.username, displayName, await hashPassword(b.password), role, b.mustChange !== false]
      );
      await audit(pool, req.user, 'usuario_creado', null, { username: b.username, role });
      return reply.status(201).send({ user: publicUser(rows[0]) });
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Ya existe un usuario con ese nombre.');
      throw e;
    }
  });

  app.patch('/api/users/:id', async req => {
    requireAdmin(req);
    const id = Number(req.params.id);
    const b = req.body ?? {};
    return tx(pool, async db => {
      const { rows } = await db.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]);
      const u = rows[0];
      if (!u) throw new HttpError(404, 'Usuario inexistente.');
      const next = { display_name: u.display_name, role: u.role, active: u.active, password_hash: u.password_hash, must_change: u.must_change };
      if (b.displayName !== undefined) next.display_name = str(b.displayName, 'El nombre', 1, 80);
      if (b.role !== undefined) next.role = b.role === 'admin' ? 'admin' : 'user';
      if (b.active !== undefined) next.active = !!b.active;
      if (b.password !== undefined) {
        const bad = validatePassword(b.password);
        if (bad) throw new HttpError(400, bad);
        next.password_hash = await hashPassword(b.password);
        next.must_change = true;
      }
      if ((next.role !== 'admin' || !next.active) && u.role === 'admin' && u.active) {
        const { rows: c } = await db.query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> $1`, [id]);
        if (c[0].n === 0) throw new HttpError(400, 'Debe quedar al menos un administrador activo.');
      }
      const r = await db.query('UPDATE users SET display_name=$2, role=$3, active=$4, password_hash=$5, must_change=$6 WHERE id=$1 RETURNING *', [id, next.display_name, next.role, next.active, next.password_hash, next.must_change]);
      if (!next.active || b.password !== undefined) await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      await audit(db, req.user, 'usuario_modificado', null, { username: u.username, cambios: Object.keys(b).filter(k => k !== 'password') .concat(b.password !== undefined ? ['password'] : []) });
      return { user: publicUser(r.rows[0]) };
    });
  });

  // ---------- proyectos: acceso ----------

  /**
   * Proyecto + nivel de acceso del usuario: `admin`, `owner`, `editor`,
   * `viewer` o `null`. Un proyecto al que no se tiene acceso responde 404 (no
   * se revela que existe).
   */
  async function loadProject(db, id, user, { need = 'read' } = {}) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'Proyecto inexistente.');
    const { rows } = await db.query(
      `SELECT p.*, m.role AS member_role, o.username AS owner_username, o.display_name AS owner_name
       FROM projects p JOIN users o ON o.id = p.owner_id
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $2
       WHERE p.id = $1`,
      [id, user.id]
    );
    const p = rows[0];
    if (!p) throw new HttpError(404, 'Proyecto inexistente.');
    let access = null;
    if (user.role === 'admin') access = 'admin';
    else if (p.owner_id === user.id) access = 'owner';
    else if (p.member_role && p.visibility !== 'private') access = p.member_role;
    else if (p.visibility === 'public') access = 'viewer';
    if (!access) throw new HttpError(404, 'Proyecto inexistente.');
    const canEdit = access === 'admin' || access === 'owner' || access === 'editor';
    const canManage = access === 'admin' || access === 'owner';
    if (need === 'edit' && !canEdit) throw new HttpError(403, 'No tiene permiso para modificar este proyecto.');
    if (need === 'manage' && !canManage) throw new HttpError(403, 'Solo el dueño o el administrador pueden hacer esto.');
    return { p, access, canEdit, canManage };
  }

  const headNumber = async (db, projectId) => {
    const { rows } = await db.query('SELECT max(number) AS n FROM versions WHERE project_id = $1', [projectId]);
    return rows[0].n ?? 0;
  };

  async function lockInfo(db, projectId, user) {
    const { rows } = await db.query(
      `SELECT l.user_id, l.expires_at, u.display_name FROM locks l JOIN users u ON u.id = l.user_id WHERE l.project_id = $1 AND l.expires_at > now()`,
      [projectId]
    );
    const l = rows[0];
    return l ? { holderId: l.user_id, holder: l.display_name, mine: l.user_id === user.id, expiresAt: l.expires_at } : null;
  }

  async function requireLock(db, projectId, user) {
    const l = await lockInfo(db, projectId, user);
    if (!l) throw new HttpError(409, 'Primero debe tomar el bloqueo de edición del proyecto.');
    if (!l.mine) throw new HttpError(409, `${l.holder} está editando este proyecto.`);
  }

  const projectView = (p, access, extra = {}) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    visibility: p.visibility,
    owner: { id: p.owner_id, username: p.owner_username, displayName: p.owner_name },
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    access,
    canEdit: access === 'admin' || access === 'owner' || access === 'editor',
    canManage: access === 'admin' || access === 'owner',
    ...extra,
  });

  // ---------- proyectos ----------

  app.get('/api/projects', async req => {
    const { rows } = await pool.query(
      `SELECT p.*, o.username AS owner_username, o.display_name AS owner_name, m.role AS member_role,
              (SELECT max(number) FROM versions v WHERE v.project_id = p.id) AS head,
              (SELECT l.user_id FROM locks l WHERE l.project_id = p.id AND l.expires_at > now()) AS lock_user
       FROM projects p JOIN users o ON o.id = p.owner_id
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
       WHERE $2 OR p.owner_id = $1 OR (m.role IS NOT NULL AND p.visibility <> 'private') OR p.visibility = 'public'
       ORDER BY p.updated_at DESC`,
      [req.user.id, req.user.role === 'admin']
    );
    return {
      projects: rows.map(p => {
        const access = req.user.role === 'admin' ? 'admin' : p.owner_id === req.user.id ? 'owner' : p.member_role && p.visibility !== 'private' ? p.member_role : 'viewer';
        return projectView(p, access, { head: p.head ?? 0, locked: p.lock_user !== null, lockedByMe: p.lock_user === req.user.id });
      }),
    };
  });

  async function insertVersion(db, projectId, user, message, text, parent) {
    const raw = Buffer.from(text, 'utf8');
    const number = parent + 1;
    const { rows } = await db.query(
      `INSERT INTO versions (project_id, number, parent_number, author_id, message, sha256, size, content)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING number, created_at`,
      [projectId, number, parent || null, user.id, message, sha256(text), raw.length, gzipSync(raw)]
    );
    await db.query('UPDATE projects SET updated_at = now() WHERE id = $1', [projectId]);
    return rows[0];
  }

  async function createProject(db, user, { name, description, visibility, content, message }) {
    const n = str(name, 'El nombre del proyecto', 1, 120);
    const vis = visibility ?? 'private';
    if (!VISIBILITIES.includes(vis)) throw new HttpError(400, 'Visibilidad inválida.');
    if (content !== undefined && content !== null) {
      const bad = validateScl(content, maxBytes);
      if (bad) throw new HttpError(400, bad);
    }
    let row;
    try {
      ({ rows: [row] } = await db.query('INSERT INTO projects (name, description, owner_id, visibility) VALUES ($1,$2,$3,$4) RETURNING *', [n, String(description ?? '').slice(0, 2000), user.id, vis]));
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Ya tiene un proyecto con ese nombre.');
      throw e;
    }
    if (content) await insertVersion(db, row.id, user, message || 'Versión inicial', content, 0);
    await audit(db, user, 'proyecto_creado', row.id, { name: n, visibility: vis });
    return row;
  }

  app.post('/api/projects', async (req, reply) => {
    const row = await tx(pool, db => createProject(db, req.user, req.body ?? {}));
    return reply.status(201).send({ id: row.id });
  });

  app.get('/api/projects/:id', async req => {
    const { p, access } = await loadProject(pool, req.params.id, req.user);
    const members = await pool.query(
      `SELECT m.user_id, m.role, u.username, u.display_name FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY lower(u.display_name)`,
      [p.id]
    );
    return {
      project: projectView(p, access, {
        head: await headNumber(pool, p.id),
        lock: await lockInfo(pool, p.id, req.user),
        members: members.rows.map(m => ({ userId: m.user_id, username: m.username, displayName: m.display_name, role: m.role })),
      }),
    };
  });

  app.patch('/api/projects/:id', async req => {
    const { p } = await loadProject(pool, req.params.id, req.user, { need: 'manage' });
    const b = req.body ?? {};
    const name = b.name !== undefined ? str(b.name, 'El nombre del proyecto', 1, 120) : p.name;
    const description = b.description !== undefined ? String(b.description).slice(0, 2000) : p.description;
    const visibility = b.visibility ?? p.visibility;
    if (!VISIBILITIES.includes(visibility)) throw new HttpError(400, 'Visibilidad inválida.');
    try {
      await pool.query('UPDATE projects SET name=$2, description=$3, visibility=$4, updated_at = now() WHERE id=$1', [p.id, name, description, visibility]);
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'El dueño ya tiene un proyecto con ese nombre.');
      throw e;
    }
    if (visibility !== p.visibility) await audit(pool, req.user, 'visibilidad_cambiada', p.id, { de: p.visibility, a: visibility });
    return { ok: true };
  });

  app.put('/api/projects/:id/members', async req => {
    const { p } = await loadProject(pool, req.params.id, req.user, { need: 'manage' });
    const list = req.body?.members;
    if (!Array.isArray(list)) throw new HttpError(400, 'Falta la lista de usuarios.');
    const seen = new Set();
    for (const m of list) {
      if (!Number.isInteger(m.userId) || !MEMBER_ROLES.includes(m.role)) throw new HttpError(400, 'Usuario o rol inválido.');
      if (m.userId === p.owner_id) throw new HttpError(400, 'El dueño ya tiene acceso total.');
      if (seen.has(m.userId)) throw new HttpError(400, 'Usuario repetido.');
      seen.add(m.userId);
    }
    await tx(pool, async db => {
      if (list.length) {
        const { rows } = await db.query('SELECT id FROM users WHERE id = ANY($1) AND active', [list.map(m => m.userId)]);
        if (rows.length !== list.length) throw new HttpError(400, 'Hay usuarios inexistentes o inactivos.');
      }
      await db.query('DELETE FROM project_members WHERE project_id = $1', [p.id]);
      for (const m of list) await db.query('INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,$3)', [p.id, m.userId, m.role]);
      await audit(db, req.user, 'permisos_cambiados', p.id, { miembros: list });
    });
    return { ok: true };
  });

  app.delete('/api/projects/:id', async req => {
    const { p } = await loadProject(pool, req.params.id, req.user, { need: 'manage' });
    await tx(pool, async db => {
      await db.query('DELETE FROM projects WHERE id = $1', [p.id]);
      await audit(db, req.user, 'proyecto_borrado', p.id, { name: p.name });
    });
    return { ok: true };
  });

  app.post('/api/projects/:id/duplicate', async (req, reply) => {
    const { p } = await loadProject(pool, req.params.id, req.user);
    const b = req.body ?? {};
    const head = await headNumber(pool, p.id);
    const from = b.fromVersion === undefined ? head : Number(b.fromVersion);
    if (!from) throw new HttpError(400, 'El proyecto todavía no tiene versiones.');
    const { rows } = await pool.query('SELECT content FROM versions WHERE project_id = $1 AND number = $2', [p.id, from]);
    if (!rows[0]) throw new HttpError(404, 'Versión inexistente.');
    const text = gunzipSync(rows[0].content).toString('utf8');
    const row = await tx(pool, db =>
      createProject(db, req.user, { name: b.name ?? `${p.name} (copia)`, description: p.description, visibility: 'private', content: text, message: `Copia de "${p.name}" versión ${from}` })
    );
    await audit(pool, req.user, 'proyecto_duplicado', row.id, { origen: p.id, version: from });
    return reply.status(201).send({ id: row.id });
  });

  // ---------- bloqueo de edición ----------

  app.post('/api/projects/:id/lock', async req => {
    const { p } = await loadProject(pool, req.params.id, req.user, { need: 'edit' });
    const { rowCount } = await pool.query(
      `INSERT INTO locks (project_id, user_id, expires_at) VALUES ($1,$2, now() + make_interval(secs => $3))
       ON CONFLICT (project_id) DO UPDATE SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at
       WHERE locks.user_id = EXCLUDED.user_id OR locks.expires_at < now()`,
      [p.id, req.user.id, config.lockSeconds]
    );
    if (!rowCount) {
      const l = await lockInfo(pool, p.id, req.user);
      throw new HttpError(409, `${l?.holder ?? 'Otra persona'} está editando este proyecto.`);
    }
    return { lock: await lockInfo(pool, p.id, req.user), ttl: config.lockSeconds };
  });

  app.delete('/api/projects/:id/lock', async req => {
    const { p, canManage } = await loadProject(pool, req.params.id, req.user, { need: 'edit' });
    const force = req.query.force === '1' && canManage;
    const { rowCount } = force
      ? await pool.query('DELETE FROM locks WHERE project_id = $1', [p.id])
      : await pool.query('DELETE FROM locks WHERE project_id = $1 AND user_id = $2', [p.id, req.user.id]);
    if (force && rowCount) await audit(pool, req.user, 'bloqueo_forzado', p.id);
    return { ok: true };
  });

  // ---------- borrador (un autoguardado por usuario) ----------

  app.get('/api/projects/:id/draft', async (req, reply) => {
    const { p } = await loadProject(pool, req.params.id, req.user, { need: 'edit' });
    const { rows } = await pool.query('SELECT * FROM drafts WHERE project_id = $1 AND user_id = $2', [p.id, req.user.id]);
    if (!rows[0]) throw new HttpError(404, 'No hay borrador.');
    reply.header('X-DSB-Base', String(rows[0].base_number ?? 0)).header('X-DSB-Updated', rows[0].updated_at.toISOString()).type('application/xml');
    return gunzipSync(rows[0].content).toString('utf8');
  });

  app.put('/api/projects/:id/draft', async req => {
    const { p } = await loadProject(pool, req.params.id, req.user, { need: 'edit' });
    await requireLock(pool, p.id, req.user);
    const { content, base } = req.body ?? {};
    const bad = validateScl(content, maxBytes);
    if (bad) throw new HttpError(400, bad);
    await pool.query(
      `INSERT INTO drafts (project_id, user_id, base_number, content) VALUES ($1,$2,$3,$4)
       ON CONFLICT (project_id, user_id) DO UPDATE SET base_number = EXCLUDED.base_number, content = EXCLUDED.content, updated_at = now()`,
      [p.id, req.user.id, Number.isInteger(base) ? base : null, gzipSync(Buffer.from(content, 'utf8'))]
    );
    return { ok: true };
  });

  app.delete('/api/projects/:id/draft', async req => {
    const { p } = await loadProject(pool, req.params.id, req.user, { need: 'edit' });
    await pool.query('DELETE FROM drafts WHERE project_id = $1 AND user_id = $2', [p.id, req.user.id]);
    return { ok: true };
  });

  // ---------- versiones ----------

  app.get('/api/projects/:id/versions', async req => {
    const { p } = await loadProject(pool, req.params.id, req.user);
    const { rows } = await pool.query(
      `SELECT v.number, v.parent_number, v.message, v.created_at, v.size, v.sha256, u.display_name AS author,
              coalesce((SELECT json_agg(m.name ORDER BY m.name) FROM milestones m WHERE m.project_id = v.project_id AND m.version_number = v.number), '[]') AS milestones
       FROM versions v JOIN users u ON u.id = v.author_id WHERE v.project_id = $1 ORDER BY v.number DESC`,
      [p.id]
    );
    return {
      versions: rows.map(v => ({ number: v.number, parentNumber: v.parent_number, message: v.message, createdAt: v.created_at, size: v.size, sha256: v.sha256, author: v.author, milestones: v.milestones })),
    };
  });

  app.get('/api/projects/:id/content', async (req, reply) => {
    const { p } = await loadProject(pool, req.params.id, req.user);
    const n = req.query.version ? Number(req.query.version) : await headNumber(pool, p.id);
    if (!n) throw new HttpError(404, 'El proyecto todavía no tiene versiones.');
    const { rows } = await pool.query('SELECT content FROM versions WHERE project_id = $1 AND number = $2', [p.id, n]);
    if (!rows[0]) throw new HttpError(404, 'Versión inexistente.');
    reply.header('X-DSB-Version', String(n)).type('application/xml');
    return gunzipSync(rows[0].content).toString('utf8');
  });

  app.post('/api/projects/:id/versions', async (req, reply) => {
    const b = req.body ?? {};
    const message = str(b.message, 'El mensaje de la versión', 3, 500);
    const bad = validateScl(b.content, maxBytes);
    if (bad) throw new HttpError(400, bad);
    const result = await tx(pool, async db => {
      const { p } = await loadProject(db, req.params.id, req.user, { need: 'edit' });
      await db.query('SELECT 1 FROM projects WHERE id = $1 FOR UPDATE', [p.id]);
      await requireLock(db, p.id, req.user);
      const head = await headNumber(db, p.id);
      if ((Number(b.base) || 0) !== head) throw new HttpError(409, `El proyecto cambió en el servidor (versión ${head}). Copie su trabajo a un proyecto nuevo con "Duplicar".`);
      if (head) {
        const { rows } = await db.query('SELECT sha256 FROM versions WHERE project_id = $1 AND number = $2', [p.id, head]);
        if (rows[0].sha256 === sha256(b.content)) return { unchanged: true, number: head };
      }
      const v = await insertVersion(db, p.id, req.user, message, b.content, head);
      await db.query('DELETE FROM drafts WHERE project_id = $1 AND user_id = $2', [p.id, req.user.id]);
      await audit(db, req.user, 'version_creada', p.id, { number: v.number, message });
      return { unchanged: false, number: v.number };
    });
    return reply.status(result.unchanged ? 200 : 201).send(result);
  });

  app.post('/api/projects/:id/versions/:n/restore', async (req, reply) => {
    const n = Number(req.params.n);
    const result = await tx(pool, async db => {
      const { p } = await loadProject(db, req.params.id, req.user, { need: 'edit' });
      await db.query('SELECT 1 FROM projects WHERE id = $1 FOR UPDATE', [p.id]);
      await requireLock(db, p.id, req.user);
      const { rows } = await db.query('SELECT content FROM versions WHERE project_id = $1 AND number = $2', [p.id, n]);
      if (!rows[0]) throw new HttpError(404, 'Versión inexistente.');
      const head = await headNumber(db, p.id);
      const message = typeof req.body?.message === 'string' && req.body.message.trim().length >= 3 ? req.body.message.trim() : `Restaurada la versión ${n}`;
      const v = await insertVersion(db, p.id, req.user, message, gunzipSync(rows[0].content).toString('utf8'), head);
      await db.query('DELETE FROM drafts WHERE project_id = $1 AND user_id = $2', [p.id, req.user.id]);
      await audit(db, req.user, 'version_restaurada', p.id, { desde: n, nueva: v.number });
      return { number: v.number };
    });
    return reply.status(201).send(result);
  });

  // ---------- hitos ----------

  app.get('/api/projects/:id/milestones', async req => {
    const { p } = await loadProject(pool, req.params.id, req.user);
    const { rows } = await pool.query(
      `SELECT m.id, m.version_number, m.name, m.note, m.created_at, u.display_name AS author FROM milestones m JOIN users u ON u.id = m.created_by WHERE m.project_id = $1 ORDER BY m.created_at DESC`,
      [p.id]
    );
    return { milestones: rows.map(m => ({ id: m.id, versionNumber: m.version_number, name: m.name, note: m.note, createdAt: m.created_at, author: m.author })) };
  });

  app.post('/api/projects/:id/milestones', async (req, reply) => {
    const { p } = await loadProject(pool, req.params.id, req.user, { need: 'edit' });
    const b = req.body ?? {};
    const name = str(b.name, 'El nombre del hito', 2, 80);
    try {
      const { rows } = await pool.query('INSERT INTO milestones (project_id, version_number, name, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [p.id, Number(b.versionNumber), name, String(b.note ?? '').slice(0, 500), req.user.id]);
      await audit(pool, req.user, 'hito_creado', p.id, { name, version: Number(b.versionNumber) });
      return reply.status(201).send({ id: rows[0].id });
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Ya existe un hito con ese nombre.');
      if (e.code === '23503') throw new HttpError(404, 'Versión inexistente.');
      throw e;
    }
  });

  app.delete('/api/projects/:id/milestones/:mid', async req => {
    const { p, canManage } = await loadProject(pool, req.params.id, req.user, { need: 'edit' });
    const { rows } = await pool.query('SELECT created_by, name FROM milestones WHERE id = $1 AND project_id = $2', [Number(req.params.mid), p.id]);
    if (!rows[0]) throw new HttpError(404, 'Hito inexistente.');
    if (!canManage && rows[0].created_by !== req.user.id) throw new HttpError(403, 'Solo quien lo creó o el dueño puede borrarlo.');
    await pool.query('DELETE FROM milestones WHERE id = $1', [Number(req.params.mid)]);
    await audit(pool, req.user, 'hito_borrado', p.id, { name: rows[0].name });
    return { ok: true };
  });

  // ---------- auditoría ----------

  const auditRows = rows => rows.map(a => ({ id: Number(a.id), at: a.at, username: a.username, action: a.action, projectId: a.project_id, detail: a.detail }));

  app.get('/api/projects/:id/audit', async req => {
    const { p } = await loadProject(pool, req.params.id, req.user, { need: 'manage' });
    const { rows } = await pool.query('SELECT * FROM audit WHERE project_id = $1 ORDER BY at DESC, id DESC LIMIT 300', [p.id]);
    return { audit: auditRows(rows) };
  });

  app.get('/api/audit', async req => {
    requireAdmin(req);
    const { rows } = await pool.query('SELECT * FROM audit ORDER BY at DESC, id DESC LIMIT 500');
    return { audit: auditRows(rows) };
  });

  return app;
}

/** Crea el primer administrador si todavía no hay usuarios. Devuelve la clave usada o `null`. */
export async function ensureAdmin(pool, config, randomPassword) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return null;
  const password = config.adminPassword || randomPassword();
  await pool.query(`INSERT INTO users (username, display_name, password_hash, role, must_change) VALUES ('admin', 'Administrador', $1, 'admin', true)`, [await hashPassword(password)]);
  return password;
}

export { migrate };
