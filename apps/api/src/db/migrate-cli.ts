import { loadEnv, loadConfig } from '../config';
import { migrate } from './migrate';
import { createPool } from './pool';

loadEnv();
const pool = createPool(loadConfig().databaseUrl);
try {
  const ran = await migrate(pool);
  console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
} finally {
  await pool.end();
}
