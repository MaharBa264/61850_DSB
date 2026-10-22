import pg from 'pg';

/** Esquema. Cada entrada se aplica una sola vez, en orden; nunca se edita una ya publicada. */
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            serial PRIMARY KEY,
    username      text NOT NULL,
    display_name  text NOT NULL,
    password_hash text NOT NULL,
    role          text NOT NULL CHECK (role IN ('admin','user')),
    active        boolean NOT NULL DEFAULT true,
    must_change   boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX users_username_ci ON users (lower(username));

  CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX sessions_user ON sessions (user_id);

  CREATE TABLE projects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    owner_id    integer NOT NULL REFERENCES users,
    visibility  text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared','public')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX projects_owner_name ON projects (owner_id, lower(name));

  CREATE TABLE project_members (
    project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
    user_id    integer NOT NULL REFERENCES users,
    role       text NOT NULL CHECK (role IN ('viewer','editor')),
    PRIMARY KEY (project_id, user_id)
  );

  CREATE TABLE versions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
    number         integer NOT NULL,
    parent_number  integer,
    author_id      integer NOT NULL REFERENCES users,
    message        text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    sha256         text NOT NULL,
    size           integer NOT NULL,
    content        bytea NOT NULL,
    UNIQUE (project_id, number)
  );

  CREATE TABLE drafts (
    project_id  uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
    user_id     integer NOT NULL REFERENCES users,
    base_number integer,
    content     bytea NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
  );

  CREATE TABLE milestones (
    id             serial PRIMARY KEY,
    project_id     uuid NOT NULL,
    version_number integer NOT NULL,
    name           text NOT NULL,
    note           text NOT NULL DEFAULT '',
    created_by     integer NOT NULL REFERENCES users,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, name),
    FOREIGN KEY (project_id, version_number) REFERENCES versions (project_id, number) ON DELETE CASCADE
  );

  CREATE TABLE locks (
    project_id uuid PRIMARY KEY REFERENCES projects ON DELETE CASCADE,
    user_id    integer NOT NULL REFERENCES users,
    expires_at timestamptz NOT NULL
  );

  CREATE TABLE audit (
    id         bigserial PRIMARY KEY,
    at         timestamptz NOT NULL DEFAULT now(),
    user_id    integer,
    username   text,
    action     text NOT NULL,
    project_id uuid,
    detail     jsonb NOT NULL DEFAULT '{}'
  );
  CREATE INDEX audit_project ON audit (project_id, at DESC);
  `,
];

export function createPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

export async function migrate(pool) {
  const c = await pool.connect();
  try {
    // un solo proceso migra a la vez
    await c.query('SELECT pg_advisory_lock(61850)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await c.query('SELECT coalesce(max(version), 0) AS v FROM schema_migrations');
    for (let i = rows[0].v; i < MIGRATIONS.length; i++) {
      await c.query('BEGIN');
      try {
        await c.query(MIGRATIONS[i]);
        await c.query('INSERT INTO schema_migrations (version) VALUES ($1)', [i + 1]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(61850)').catch(() => {});
    c.release();
  }
}

/** Ejecuta `fn(client)` dentro de una transacción. */
export async function tx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
