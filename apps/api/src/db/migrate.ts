import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeForSearch } from '@cellar/shared';
import type { Pool } from './pool';
import { BOTTLE_SIZES, COLOURS, GRAPES, REGIONS, countries } from './seedData';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

/** Applies pending SQL migrations in order, then (re)applies the idempotent seed data. */
export async function migrate(pool: Pool): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await pool.query<{ name: string }>('SELECT name FROM schema_migration')).rows.map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(MIGRATIONS_DIR + file, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  await seed(pool);
  return ran;
}

async function seed(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [id, code, name] of COLOURS) {
      await client.query('INSERT INTO colour (id, code, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET code = $2, name = $3', [id, code, name]);
    }
    for (const [id, volume, name] of BOTTLE_SIZES) {
      await client.query('INSERT INTO bottle_size (id, volume_ml, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET volume_ml = $2, name = $3', [id, volume, name]);
    }
    for (const [iso, name] of countries()) {
      await client.query('INSERT INTO country (iso_code, name) VALUES ($1, $2) ON CONFLICT (iso_code) DO UPDATE SET name = $2', [iso, name]);
    }
    for (const [iso, names] of Object.entries(REGIONS)) {
      for (const name of names) {
        await client.query(
          `INSERT INTO region (country_id, name, name_norm, is_public)
           SELECT id, $2, $3, true FROM country WHERE iso_code = $1
           ON CONFLICT (country_id, lower(name)) DO NOTHING`,
          [iso, name, normalizeForSearch(name)],
        );
      }
    }
    for (const name of GRAPES) {
      await client.query(
        'INSERT INTO grape (name, name_norm, is_public) VALUES ($1, $2, true) ON CONFLICT (lower(name)) DO NOTHING',
        [name, normalizeForSearch(name)],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
