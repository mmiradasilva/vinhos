// Starts an isolated stack for the browser tests: throwaway PostgreSQL, the API and the Vite dev server.
import { mkdtemp } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import { createServer as createViteServer } from 'vite';
import { buildApp } from '../apps/api/src/app';
import { loadConfig } from '../apps/api/src/config';
import { migrate } from '../apps/api/src/db/migrate';
import { createPool } from '../apps/api/src/db/pool';
import { createFakeProvider } from '../apps/api/src/identity/fake';

export const WEB_PORT = 5273;
export const API_PORT = 3100;
export const BASE_URL = `http://localhost:${WEB_PORT}`;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = createNetServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });

export async function startStack(): Promise<() => Promise<void>> {
  const pgPort = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: await mkdtemp(join(tmpdir(), 'cellar-e2e-pg-')),
    user: 'e2e',
    password: 'e2e',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('cellar_e2e');

  const databaseUrl = `postgres://e2e:e2e@localhost:${pgPort}/cellar_e2e`;
  const pool = createPool(databaseUrl);
  await migrate(pool);

  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    APP_ORIGIN: BASE_URL,
    COOKIE_SECURE: 'false',
    LOG_LEVEL: 'silent',
  });
  const { app } = await buildApp({
    config,
    pool,
    identity: createFakeProvider(),
    rateLimits: { authPerIp: 10_000, authPerAccount: 1_000 },
  });
  await app.listen({ port: API_PORT, host: '127.0.0.1' });

  const webRoot = fileURLToPath(new URL('../apps/web/', import.meta.url));
  const vite = await createViteServer({
    root: webRoot,
    configFile: join(webRoot, 'vite.config.ts'),
    logLevel: 'warn',
    server: {
      port: WEB_PORT,
      strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false } },
    },
  });
  await vite.listen();

  return async () => {
    await vite.close();
    await app.close();
    await pool.end();
    await pg.stop();
  };
}
