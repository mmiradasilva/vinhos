// Starts a local PostgreSQL for development (embedded-postgres). Data lives in .data/postgres.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const dataDir = fileURLToPath(new URL('../../../.data/postgres', import.meta.url));
const port = 5433;

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'cellar',
  password: 'cellar',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

if (!existsSync(`${dataDir}/PG_VERSION`)) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase('cellar');
} catch {
  // already exists
}
console.log(`PostgreSQL is running: postgres://cellar:cellar@localhost:${port}/cellar  (Ctrl+C to stop)`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
