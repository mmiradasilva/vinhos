import { LIMITS, normalizeForSearch, type ValidWine } from '@cellar/shared';
import { isUniqueViolation, type Client, type Pool } from '../db/pool';
import { LOOKUP_CONSTRAINTS, duplicateAfterRace, findDuplicate, publishUsedLookups, replaceGrapes, resolveLookups } from './resolve';
import { inTransaction, type Outcome } from './transaction';
import { fetchWine } from './view';

/** Creates a wine and any new producer/region/grapes in one transaction (add-wine BR-11). */
export async function createWine(pool: Pool, userId: string, wine: ValidWine, idempotencyKey: string | null, year: number): Promise<Outcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      const outcome = await inTransaction(pool, userId, idempotencyKey, (db) => insertWine(db, userId, wine, year));
      const id = (outcome.body as { id?: string } | null)?.id;
      return outcome.status === 201 && id ? { ...outcome, location: `/api/v1/collection/wines/${id}` } : outcome;
    } catch (err) {
      // Two users created the same new lookup value at the same moment: retry once, which reuses it.
      if (attempt === 1 && LOOKUP_CONSTRAINTS.some((c) => isUniqueViolation(err, c))) continue;
      if (isUniqueViolation(err, 'wine_duplicate_uq')) return duplicateAfterRace(pool, userId, wine);
      throw err;
    }
  }
}

async function insertWine(db: Client, userId: string, wine: ValidWine, year: number): Promise<Outcome> {
  // BR-13: collection size cap counts records, not bottles.
  const count = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM wine WHERE owner_id = $1', [userId]);
  if (count.rows[0].n >= LIMITS.collectionMax) return { status: 422, body: { code: 'collection_limit' } };

  const resolved = await resolveLookups(db, userId, wine);
  if ('errors' in resolved) return { status: 400, body: { errors: resolved.errors } };

  const dup = await findDuplicate(db, userId, resolved.producerId, wine);
  if (dup) return dup;

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO wine (owner_id, producer_id, name, name_norm, vintage, is_non_vintage, colour_id, bottle_size_id, quantity,
                       country_id, region_id, purchase_price, currency, purchase_date, storage_location, drink_from, drink_until, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
    [
      userId, resolved.producerId, wine.name, normalizeForSearch(wine.name), wine.vintage, wine.is_non_vintage, wine.colour_id,
      wine.bottle_size_id, wine.quantity, resolved.countryId, resolved.regionId, wine.purchase_price, wine.currency, wine.purchase_date,
      wine.storage_location, wine.drink_from, wine.drink_until, wine.notes,
    ],
  );
  const wineId = inserted.rows[0].id;
  await replaceGrapes(db, wineId, resolved.grapes);
  await publishUsedLookups(db, userId, resolved);
  return { status: 201, body: await fetchWine(db, wineId, year) };
}
