import { MESSAGES, normalizeForSearch, type FieldError, type Ref, type ValidWine } from '@cellar/shared';
import type { Client, Pool } from '../db/pool';
import type { Outcome } from './transaction';

export interface Resolved {
  producerId: string;
  countryId: number | null;
  regionId: string | null;
  grapes: { id: string; percentage: number | null }[];
}

type Sql = [text: string, values: unknown[]];

/**
 * Checks the lookups of a wine and finds or creates its producer, region and grapes (add-wine BR-4, BR-9, BR-11, BR-12).
 * Shared by create and edit.
 */
export async function resolveLookups(db: Client, userId: string, wine: ValidWine): Promise<{ errors: FieldError[] } | Resolved> {
  const errors: FieldError[] = [];

  const exists = async (table: string, id: number) => ((await db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount ?? 0) > 0;
  if (!(await exists('colour', wine.colour_id))) errors.push({ field: 'colour_id', code: 'not_found', message: MESSAGES.colour });
  if (!(await exists('bottle_size', wine.bottle_size_id))) errors.push({ field: 'bottle_size_id', code: 'not_found', message: MESSAGES.bottleSize });
  let countryId = wine.country_id;
  if (countryId !== null && !(await exists('country', countryId))) {
    errors.push({ field: 'country_id', code: 'not_found', message: MESSAGES.country });
    countryId = null;
  }

  // BR-9: region belongs to the country; a region alone sets the country.
  let regionId: string | null = null;
  if (wine.region) {
    if ('id' in wine.region) {
      const r = await db.query<{ id: string; country_id: number }>(
        'SELECT id, country_id FROM region WHERE id = $1 AND (is_public OR created_by = $2)',
        [wine.region.id, userId],
      );
      const region = r.rows[0];
      if (!region) errors.push({ field: 'region', code: 'not_found', message: MESSAGES.notFound });
      else if (countryId !== null && region.country_id !== countryId) errors.push({ field: 'region', code: 'country_mismatch', message: MESSAGES.regionCountry });
      else {
        regionId = region.id;
        countryId ??= region.country_id;
      }
    } else if (wine.country_id === null) {
      errors.push({ field: 'region', code: 'country_required', message: MESSAGES.regionNeedsCountry });
    } else if (countryId !== null) {
      regionId = await findOrCreate(db, {
        find: ['SELECT id FROM region WHERE country_id = $1 AND lower(name) = lower($2) LIMIT 1', [countryId, wine.region.name]],
        insert: ['INSERT INTO region (country_id, name, name_norm, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [countryId, wine.region.name, normalizeForSearch(wine.region.name), userId]],
      });
    }
  }

  const producerId = await resolveRef(db, userId, 'producer', wine.producer, errors, 'producer', {
    find: [
      `SELECT id FROM producer WHERE lower(name) = lower($1)
        ORDER BY (country_id IS NOT DISTINCT FROM $2) DESC, is_public DESC, created_at LIMIT 1`,
      [nameOf(wine.producer), countryId],
    ],
    insert: [
      'INSERT INTO producer (name, name_norm, country_id, region_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [nameOf(wine.producer), normalizeForSearch(nameOf(wine.producer)), countryId, regionId, userId],
    ],
  });

  const grapes: Resolved['grapes'] = [];
  for (const g of wine.grapes) {
    const id = await resolveRef(db, userId, 'grape', g.grape, errors, 'grapes', {
      find: ['SELECT id FROM grape WHERE lower(name) = lower($1) LIMIT 1', [nameOf(g.grape)]],
      insert: ['INSERT INTO grape (name, name_norm, created_by) VALUES ($1, $2, $3) RETURNING id', [nameOf(g.grape), normalizeForSearch(nameOf(g.grape)), userId]],
    });
    if (!id) continue;
    if (grapes.some((x) => x.id === id)) errors.push({ field: 'grapes', code: 'duplicate', message: MESSAGES.grapeDuplicate });
    else grapes.push({ id, percentage: g.percentage });
  }

  if (errors.length > 0 || !producerId) return { errors };
  return { producerId, countryId, regionId, grapes };
}

/** BR-14: a value created by someone else becomes public once a second user uses it. */
export async function publishUsedLookups(db: Client, userId: string, r: Resolved): Promise<void> {
  await db.query('UPDATE producer SET is_public = true WHERE id = $1 AND NOT is_public AND created_by IS DISTINCT FROM $2', [r.producerId, userId]);
  if (r.regionId) await db.query('UPDATE region SET is_public = true WHERE id = $1 AND NOT is_public AND created_by IS DISTINCT FROM $2', [r.regionId, userId]);
  if (r.grapes.length) {
    await db.query('UPDATE grape SET is_public = true WHERE id = ANY($1::uuid[]) AND NOT is_public AND created_by IS DISTINCT FROM $2', [r.grapes.map((g) => g.id), userId]);
  }
}

export async function replaceGrapes(db: Client, wineId: string, grapes: Resolved['grapes']): Promise<void> {
  await db.query('DELETE FROM wine_grape WHERE wine_id = $1', [wineId]);
  for (const g of grapes) {
    await db.query('INSERT INTO wine_grape (wine_id, grape_id, percentage) VALUES ($1, $2, $3)', [wineId, g.id, g.percentage]);
  }
}

/** add-wine BR-6, view-edit-wine BR-3: same producer, name, vintage (NV = NV) and size; `exceptId` is the wine being edited. */
export async function findDuplicate(db: Pool | Client, userId: string, producerId: string, wine: ValidWine, exceptId: string | null = null): Promise<Outcome | null> {
  const { rows } = await db.query<{ id: string; quantity: number }>(
    `SELECT id, quantity FROM wine
      WHERE owner_id = $1 AND producer_id = $2 AND lower(name) = lower($3)
        AND vintage IS NOT DISTINCT FROM $4 AND bottle_size_id = $5
        AND id IS DISTINCT FROM $6`,
    [userId, producerId, wine.name, wine.vintage, wine.bottle_size_id, exceptId],
  );
  if (!rows[0]) return null;
  return { status: 409, body: { code: 'duplicate', existing_id: rows[0].id, existing_quantity: rows[0].quantity } };
}

/** The same wine submitted twice at once raced past findDuplicate: report the duplicate after the fact. */
export async function duplicateAfterRace(pool: Pool, userId: string, wine: ValidWine, exceptId: string | null = null): Promise<Outcome> {
  const producer = 'id' in wine.producer
    ? wine.producer.id
    : (await pool.query<{ id: string }>('SELECT id FROM producer WHERE lower(name) = lower($1) LIMIT 1', [wine.producer.name])).rows[0]?.id;
  const dup = producer ? await findDuplicate(pool, userId, producer, wine, exceptId) : null;
  return dup ?? { status: 409, body: { code: 'duplicate' } };
}

export const LOOKUP_CONSTRAINTS = ['producer_name_uq', 'region_name_uq', 'grape_name_uq'];

const nameOf = (ref: Ref) => ('name' in ref ? ref.name : '');

/** By id: must be visible to this user. By name: reuse any match (BR-12, even another user's private one), else create. */
async function resolveRef(
  db: Client,
  userId: string,
  table: 'producer' | 'grape',
  ref: Ref,
  errors: FieldError[],
  field: string,
  sql: { find: Sql; insert: Sql },
): Promise<string | null> {
  if ('id' in ref) {
    const r = await db.query<{ id: string }>(`SELECT id FROM ${table} WHERE id = $1 AND (is_public OR created_by = $2)`, [ref.id, userId]);
    if (!r.rows[0]) errors.push({ field, code: 'not_found', message: MESSAGES.notFound });
    return r.rows[0]?.id ?? null;
  }
  return findOrCreate(db, sql);
}

async function findOrCreate(db: Client, sql: { find: Sql; insert: Sql }): Promise<string> {
  const found = await db.query<{ id: string }>(sql.find[0], sql.find[1]);
  if (found.rows[0]) return found.rows[0].id;
  const created = await db.query<{ id: string }>(sql.insert[0], sql.insert[1]);
  return created.rows[0].id;
}
