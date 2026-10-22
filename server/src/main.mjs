import { randomBytes } from 'node:crypto';

import { buildApp, ensureAdmin } from './app.mjs';
import { loadConfig } from './config.mjs';
import { createPool, migrate } from './db.mjs';

const config = { ...loadConfig(), logger: { level: process.env.DSB_LOG_LEVEL || 'info' } };
const pool = createPool(config.databaseUrl);
await migrate(pool);

const first = await ensureAdmin(pool, config, () => randomBytes(9).toString('base64url'));
if (first) {
  console.log('==================================================================');
  console.log(' Se creó el usuario "admin". Contraseña inicial (se pide cambiarla):');
  console.log(`   ${first}`);
  console.log('==================================================================');
}

const app = await buildApp(pool, config);
await app.listen({ host: config.host, port: config.port });

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
