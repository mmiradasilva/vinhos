import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';
import { migrate } from '../src/db/migrate';
import { createPool } from '../src/db/pool';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });

/** One throwaway PostgreSQL cluster per test run. */
export default async function setup(project: TestProject) {
  const dir = await mkdtemp(join(tmpdir(), 'cellar-test-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'test',
    password: 'test',
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('cellar_test');
  const url = `postgres://test:test@localhost:${port}/cellar_test`;
  const pool = createPool(url);
  await migrate(pool);
  await pool.end();
  project.provide('databaseUrl', url);
  return async () => {
    await pg.stop();
  };
}
