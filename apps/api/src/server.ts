import { buildApp } from './app';
import { deleteExpiredSessions } from './auth/session';
import { loadConfig, loadEnv } from './config';
import { migrate } from './db/migrate';
import { createPool } from './db/pool';
import { createFakeProvider } from './identity/fake';
import { createGoogleProvider } from './identity/google';

loadEnv();
const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);

if (!config.google && config.isProduction) throw new Error('The fake sign-in provider is never allowed in production');
const identity = config.google ? await createGoogleProvider(config.google) : createFakeProvider();

const { app, ctx } = await buildApp({ config, pool, identity });
if (identity.kind === 'fake') app.log.warn('GOOGLE_CLIENT_ID is not set: using the development sign-in page instead of Google');

// sign-in §10: daily clean-up of expired sessions and old idempotency keys.
const cleanup = setInterval(() => deleteExpiredSessions(ctx).catch((err) => app.log.error(err)), 24 * 60 * 60 * 1000);
cleanup.unref();

await app.listen({ port: config.port, host: config.host });

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
