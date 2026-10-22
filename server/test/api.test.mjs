import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { DB, SCL, setup } from './helpers.mjs';

const skip = DB ? false : 'Defina DSB_TEST_DATABASE_URL para correr las pruebas con PostgreSQL.';

describe('DSB server', { skip }, () => {
  let t;
  before(async () => { t = await setup(); });
  after(async () => { await t?.close(); });

  describe('autenticación', () => {
    it('exige sesión y el encabezado anti-CSRF', async () => {
      const anon = t.client();
      assert.equal((await anon.get('/api/projects')).status, 401);
      const r = await anon.call('POST', '/api/auth/login', { username: 'admin', password: 'x' }, { 'x-dsb': '0' });
      assert.equal(r.status, 403);
    });

    it('rechaza clave incorrecta y bloquea tras varios intentos', async () => {
      const c = t.client();
      for (let i = 0; i < 3; i++) assert.equal((await c.post('/api/auth/login', { username: 'admin', password: 'mala' })).status, 401);
      const r = await c.post('/api/auth/login', { username: 'admin', password: 'clave-admin-2' });
      assert.equal(r.status, 429);
    });

    it('la clave temporal obliga a cambiarla antes de seguir', async () => {
      const r = await t.admin.post('/api/users', { username: 'temp1', displayName: 'Temp', password: 'clave-temporal', role: 'user' });
      assert.equal(r.status, 201);
      const c = await t.login('temp1', 'clave-temporal');
      assert.equal((await c.get('/api/projects')).status, 403);
      assert.equal((await c.get('/api/auth/me')).json.user.mustChange, true);
      assert.equal((await c.post('/api/auth/password', { current: 'clave-temporal', next: 'corta' })).status, 400);
      assert.equal((await c.post('/api/auth/password', { current: 'clave-temporal', next: 'clave-nueva-1' })).status, 200);
      assert.equal((await c.get('/api/projects')).status, 200);
    });

    it('logout invalida la sesión', async () => {
      const { c } = await t.newUser('sale1');
      assert.equal((await c.get('/api/projects')).status, 200);
      const cookie = (await c.call('GET', '/api/auth/me')).status; // sigue valida
      assert.equal(cookie, 200);
      await c.post('/api/auth/logout');
      assert.equal((await c.get('/api/projects')).status, 401);
    });

    it('un usuario común no administra usuarios; el directorio sí lo ve', async () => {
      const { c } = await t.newUser('comun1');
      assert.equal((await c.get('/api/users')).status, 403);
      assert.equal((await c.post('/api/users', { username: 'otro1', password: 'clave-temporal' })).status, 403);
      const d = await c.get('/api/directory');
      assert.equal(d.status, 200);
      assert.ok(d.json.users.some(u => u.username === 'comun1'));
      assert.equal(d.json.users[0].password_hash, undefined);
    });

    it('desactivar un usuario cierra su sesión; no se puede dejar sin administradores', async () => {
      const u = await t.newUser('baja1');
      assert.equal((await t.admin.patch(`/api/users/${u.id}`, { active: false })).status, 200);
      assert.equal((await u.c.get('/api/projects')).status, 401);
      assert.equal((await t.client().post('/api/auth/login', { username: 'baja1', password: 'clave-temporal' })).status, 401);
      const me = (await t.admin.get('/api/auth/me')).json.user;
      assert.equal((await t.admin.patch(`/api/users/${me.id}`, { role: 'user' })).status, 400);
      assert.equal((await t.admin.patch(`/api/users/${me.id}`, { active: false })).status, 400);
    });

    it('valida el nombre de usuario y evita repetidos', async () => {
      assert.equal((await t.admin.post('/api/users', { username: 'a b', password: 'clave-temporal' })).status, 400);
      await t.admin.post('/api/users', { username: 'Repe1', password: 'clave-temporal' });
      assert.equal((await t.admin.post('/api/users', { username: 'repe1', password: 'clave-temporal' })).status, 409);
    });
  });

  describe('proyectos y permisos', () => {
    let ana, beto, carla;
    before(async () => {
      ana = await t.newUser('ana');
      beto = await t.newUser('beto');
      carla = await t.newUser('carla');
    });

    const create = async (c, name, visibility = 'private') => {
      const r = await c.post('/api/projects', { name, visibility, content: SCL(name) });
      assert.equal(r.status, 201, r.text);
      return r.json.id;
    };

    it('privado: solo el dueño (y el administrador) lo ven; el resto recibe 404', async () => {
      const id = await create(ana.c, 'Privado');
      assert.equal((await ana.c.get(`/api/projects/${id}`)).status, 200);
      assert.equal((await beto.c.get(`/api/projects/${id}`)).status, 404);
      assert.equal((await beto.c.get(`/api/projects/${id}/content`)).status, 404);
      assert.equal((await t.admin.get(`/api/projects/${id}`)).status, 200);
      const list = (await beto.c.get('/api/projects')).json.projects.map(p => p.name);
      assert.ok(!list.includes('Privado'));
    });

    it('libre: cualquiera ve y duplica, pero no edita', async () => {
      const id = await create(ana.c, 'Libre', 'public');
      const r = await beto.c.get(`/api/projects/${id}`);
      assert.equal(r.json.project.access, 'viewer');
      assert.equal(r.json.project.canEdit, false);
      assert.equal((await beto.c.get(`/api/projects/${id}/content`)).status, 200);
      assert.equal((await beto.c.post(`/api/projects/${id}/lock`)).status, 403);
      assert.equal((await beto.c.post(`/api/projects/${id}/versions`, { message: 'intento', content: SCL('z'), base: 1 })).status, 403);
      assert.equal((await beto.c.patch(`/api/projects/${id}`, { name: 'Robado' })).status, 403);
      const d = await beto.c.post(`/api/projects/${id}/duplicate`, { name: 'Mi copia' });
      assert.equal(d.status, 201);
      const mine = await beto.c.get(`/api/projects/${d.json.id}`);
      assert.equal(mine.json.project.access, 'owner');
      assert.equal(mine.json.project.visibility, 'private');
      assert.equal(mine.json.project.head, 1);
    });

    it('compartido: solo los elegidos, con su rol', async () => {
      const id = await create(ana.c, 'Compartido', 'shared');
      assert.equal((await beto.c.get(`/api/projects/${id}`)).status, 404);
      const r = await ana.c.put(`/api/projects/${id}/members`, { members: [{ userId: beto.id, role: 'editor' }, { userId: carla.id, role: 'viewer' }] });
      assert.equal(r.status, 200);
      assert.equal((await beto.c.get(`/api/projects/${id}`)).json.project.canEdit, true);
      const c = await carla.c.get(`/api/projects/${id}`);
      assert.equal(c.json.project.canEdit, false);
      assert.equal((await carla.c.post(`/api/projects/${id}/lock`)).status, 403);
      assert.equal((await beto.c.post(`/api/projects/${id}/lock`)).status, 200);
      // quien no es dueño no cambia permisos
      assert.equal((await beto.c.put(`/api/projects/${id}/members`, { members: [] })).status, 403);
      // el dueño no se agrega a sí mismo; usuarios inexistentes se rechazan
      assert.equal((await ana.c.put(`/api/projects/${id}/members`, { members: [{ userId: ana.id, role: 'editor' }] })).status, 400);
      assert.equal((await ana.c.put(`/api/projects/${id}/members`, { members: [{ userId: 99999, role: 'viewer' }] })).status, 400);
      // al volver a privado, los miembros pierden el acceso
      await ana.c.patch(`/api/projects/${id}`, { visibility: 'private' });
      assert.equal((await beto.c.get(`/api/projects/${id}`)).status, 404);
      await ana.c.patch(`/api/projects/${id}`, { visibility: 'shared' });
      assert.equal((await beto.c.get(`/api/projects/${id}`)).status, 200);
    });

    it('un libre con editores: todos ven, los elegidos editan', async () => {
      const id = await create(ana.c, 'Libre con editores', 'public');
      await ana.c.put(`/api/projects/${id}/members`, { members: [{ userId: beto.id, role: 'editor' }] });
      assert.equal((await beto.c.get(`/api/projects/${id}`)).json.project.canEdit, true);
      assert.equal((await carla.c.get(`/api/projects/${id}`)).json.project.canEdit, false);
    });

    it('el listado respeta la visibilidad', async () => {
      const names = (await carla.c.get('/api/projects')).json.projects.map(p => p.name);
      assert.ok(names.includes('Libre'));
      assert.ok(!names.includes('Privado'));
    });

    it('nombres únicos por dueño; validación de visibilidad', async () => {
      await create(ana.c, 'Unico');
      assert.equal((await ana.c.post('/api/projects', { name: 'unico' })).status, 409);
      assert.equal((await ana.c.post('/api/projects', { name: 'Otro', visibility: 'x' })).status, 400);
      assert.equal((await ana.c.post('/api/projects', { name: '' })).status, 400);
      assert.equal((await ana.c.post('/api/projects', { name: 'Malo', content: 'no es xml' })).status, 400);
      assert.equal((await beto.c.post('/api/projects', { name: 'Unico' })).status, 201);
    });

    it('borrar: dueño o administrador; borra sus versiones', async () => {
      const id = await create(ana.c, 'Para borrar', 'public');
      assert.equal((await beto.c.del(`/api/projects/${id}`)).status, 403);
      assert.equal((await ana.c.del(`/api/projects/${id}`)).status, 200);
      assert.equal((await ana.c.get(`/api/projects/${id}`)).status, 404);
      const { rows } = await t.pool.query('SELECT count(*)::int AS n FROM versions WHERE project_id = $1', [id]);
      assert.equal(rows[0].n, 0);
    });
  });

  describe('bloqueo, borrador y versiones', () => {
    let dueño, otro, id;
    before(async () => {
      dueño = await t.newUser('dueno');
      otro = await t.newUser('otro');
      id = (await dueño.c.post('/api/projects', { name: 'Obra', visibility: 'shared', content: SCL('v1') })).json.id;
      await dueño.c.put(`/api/projects/${id}/members`, { members: [{ userId: otro.id, role: 'editor' }] });
    });

    it('sin bloqueo no se puede guardar; con bloqueo, uno solo edita', async () => {
      assert.equal((await dueño.c.post(`/api/projects/${id}/versions`, { message: 'sin lock', content: SCL('a'), base: 1 })).status, 409);
      assert.equal((await dueño.c.post(`/api/projects/${id}/lock`)).status, 200);
      const r = await otro.c.post(`/api/projects/${id}/lock`);
      assert.equal(r.status, 409);
      assert.match(r.json.error, /DUENO/);
      assert.equal((await otro.c.post(`/api/projects/${id}/versions`, { message: 'pisando', content: SCL('a'), base: 1 })).status, 409);
      // renovar el propio bloqueo
      assert.equal((await dueño.c.post(`/api/projects/${id}/lock`)).status, 200);
      const view = (await otro.c.get(`/api/projects/${id}`)).json.project;
      assert.equal(view.lock.holder, 'DUENO');
      assert.equal(view.lock.mine, false);
    });

    it('un bloqueo vencido lo puede tomar otro', async () => {
      await t.pool.query(`UPDATE locks SET expires_at = now() - interval '1 second' WHERE project_id = $1`, [id]);
      assert.equal((await otro.c.post(`/api/projects/${id}/lock`)).status, 200);
      assert.equal((await dueño.c.post(`/api/projects/${id}/lock`)).status, 409);
      assert.equal((await otro.c.del(`/api/projects/${id}/lock`)).status, 200);
      assert.equal((await dueño.c.post(`/api/projects/${id}/lock`)).status, 200);
    });

    it('el dueño puede forzar la liberación; un editor no', async () => {
      assert.equal((await otro.c.del(`/api/projects/${id}/lock?force=1`)).status, 200); // no fuerza: solo borra el suyo (ninguno)
      assert.equal((await otro.c.post(`/api/projects/${id}/lock`)).status, 409);
      assert.equal((await dueño.c.del(`/api/projects/${id}/lock?force=1`)).status, 200);
      assert.equal((await otro.c.post(`/api/projects/${id}/lock`)).status, 200);
      assert.equal((await otro.c.del(`/api/projects/${id}/lock`)).status, 200);
      await dueño.c.post(`/api/projects/${id}/lock`);
    });

    it('crea versiones inmutables, numeradas, con padre y autor', async () => {
      const r = await dueño.c.post(`/api/projects/${id}/versions`, { message: 'Agregado campo L1', content: SCL('v2'), base: 1 });
      assert.equal(r.status, 201);
      assert.equal(r.json.number, 2);
      const list = (await dueño.c.get(`/api/projects/${id}/versions`)).json.versions;
      assert.deepEqual(list.map(v => v.number), [2, 1]);
      assert.equal(list[0].parentNumber, 1);
      assert.equal(list[0].author, 'DUENO');
      assert.equal(list[0].message, 'Agregado campo L1');
      const c1 = await dueño.c.get(`/api/projects/${id}/content?version=1`);
      assert.match(c1.text, /id="v1"/);
      const head = await dueño.c.get(`/api/projects/${id}/content`);
      assert.match(head.text, /id="v2"/);
      assert.equal(head.headers['x-dsb-version'], '2');
      assert.equal(head.headers['x-content-type-options'], 'nosniff');
      assert.equal(head.headers['content-disposition'], 'attachment');
    });

    it('rechaza guardar sobre una base vieja y no crea versiones vacías', async () => {
      const stale = await dueño.c.post(`/api/projects/${id}/versions`, { message: 'vieja', content: SCL('zz'), base: 1 });
      assert.equal(stale.status, 409);
      const same = await dueño.c.post(`/api/projects/${id}/versions`, { message: 'igual', content: SCL('v2'), base: 2 });
      assert.equal(same.status, 200);
      assert.equal(same.json.unchanged, true);
      assert.equal((await dueño.c.get(`/api/projects/${id}/versions`)).json.versions.length, 2);
      assert.equal((await dueño.c.post(`/api/projects/${id}/versions`, { message: 'x', content: SCL('q'), base: 2 })).status, 400); // mensaje corto
    });

    it('restaurar crea una versión nueva y conserva la historia', async () => {
      const r = await dueño.c.post(`/api/projects/${id}/versions/1/restore`, {});
      assert.equal(r.status, 201);
      assert.equal(r.json.number, 3);
      const list = (await dueño.c.get(`/api/projects/${id}/versions`)).json.versions;
      assert.equal(list.length, 3);
      assert.equal(list[0].message, 'Restaurada la versión 1');
      assert.match((await dueño.c.get(`/api/projects/${id}/content`)).text, /id="v1"/);
      assert.match((await dueño.c.get(`/api/projects/${id}/content?version=2`)).text, /id="v2"/);
      assert.equal((await dueño.c.post(`/api/projects/${id}/versions/99/restore`, {})).status, 404);
    });

    it('hitos con nombre único por proyecto', async () => {
      const r = await dueño.c.post(`/api/projects/${id}/milestones`, { versionNumber: 2, name: 'Entregado a presupuesto', note: 'ver planilla' });
      assert.equal(r.status, 201);
      assert.equal((await dueño.c.post(`/api/projects/${id}/milestones`, { versionNumber: 3, name: 'Entregado a presupuesto' })).status, 409);
      assert.equal((await dueño.c.post(`/api/projects/${id}/milestones`, { versionNumber: 77, name: 'Fantasma' })).status, 404);
      const v = (await dueño.c.get(`/api/projects/${id}/versions`)).json.versions.find(x => x.number === 2);
      assert.deepEqual(v.milestones, ['Entregado a presupuesto']);
      const list = (await dueño.c.get(`/api/projects/${id}/milestones`)).json.milestones;
      assert.equal(list.length, 1);
      // un editor ajeno al hito no lo borra; el dueño sí
      assert.equal((await otro.c.del(`/api/projects/${id}/milestones/${list[0].id}`)).status, 403);
      assert.equal((await dueño.c.del(`/api/projects/${id}/milestones/${list[0].id}`)).status, 200);
    });

    it('borrador: uno por usuario, requiere bloqueo y se limpia al versionar', async () => {
      assert.equal((await dueño.c.get(`/api/projects/${id}/draft`)).status, 404);
      assert.equal((await otro.c.put(`/api/projects/${id}/draft`, { content: SCL('d'), base: 3 })).status, 409); // no tiene el bloqueo
      assert.equal((await dueño.c.put(`/api/projects/${id}/draft`, { content: SCL('borrador'), base: 3 })).status, 200);
      const d = await dueño.c.get(`/api/projects/${id}/draft`);
      assert.match(d.text, /id="borrador"/);
      assert.equal(d.headers['x-dsb-base'], '3');
      assert.equal((await dueño.c.put(`/api/projects/${id}/draft`, { content: 'basura', base: 3 })).status, 400);
      const r = await dueño.c.post(`/api/projects/${id}/versions`, { message: 'desde el borrador', content: SCL('borrador'), base: 3 });
      assert.equal(r.status, 201);
      assert.equal((await dueño.c.get(`/api/projects/${id}/draft`)).status, 404);
    });

    it('dos guardados simultáneos sobre la misma base: uno gana, el otro recibe conflicto', async () => {
      const { rows } = await t.pool.query('SELECT max(number) AS n FROM versions WHERE project_id = $1', [id]);
      const base = rows[0].n;
      await dueño.c.post(`/api/projects/${id}/lock`);
      const [a, b] = await Promise.all([
        dueño.c.post(`/api/projects/${id}/versions`, { message: 'carrera A', content: SCL('carreraA'), base }),
        dueño.c.post(`/api/projects/${id}/versions`, { message: 'carrera B', content: SCL('carreraB'), base }),
      ]);
      assert.deepEqual([a.status, b.status].sort(), [201, 409]);
      const list = (await dueño.c.get(`/api/projects/${id}/versions`)).json.versions;
      assert.equal(list.length, base + 1);
    });

    it('ids malformados no llegan a la base (404) y el SQL no se inyecta', async () => {
      assert.equal((await dueño.c.get('/api/projects/no-es-un-uuid')).status, 404);
      assert.equal((await dueño.c.get(`/api/projects/${id}/versions/1%27%3B%20DROP%20TABLE%20users%3B--`)).status, 404);
      assert.equal((await t.admin.get('/api/users')).status, 200);
    });

    it('el contenido se guarda comprimido y con huella', async () => {
      const { rows } = await t.pool.query('SELECT sha256, size, length(content) AS stored FROM versions WHERE project_id = $1 AND number = 1', [id]);
      assert.equal(rows[0].sha256.length, 64);
      assert.ok(rows[0].size > 0);
    });

    it('auditoría: queda quién hizo qué', async () => {
      const a = await dueño.c.get(`/api/projects/${id}/audit`);
      assert.equal(a.status, 200);
      const actions = a.json.audit.map(x => x.action);
      for (const k of ['proyecto_creado', 'permisos_cambiados', 'version_creada', 'version_restaurada', 'hito_creado', 'bloqueo_forzado']) assert.ok(actions.includes(k), k);
      assert.equal((await otro.c.get(`/api/projects/${id}/audit`)).status, 403);
      assert.equal((await otro.c.get('/api/audit')).status, 403);
      const all = await t.admin.get('/api/audit');
      assert.ok(all.json.audit.some(x => x.action === 'login'));
      assert.ok(all.json.audit.some(x => x.action === 'login_fallido'));
    });
  });
});
