import { LIMITS, normalizeForSearch, type ValidWine } from '@cellar/shared';
import { isUniqueViolation, type Client, type Pool } from '../db/pool';
import { LOOKUP_CONSTRAINTS, duplicateAfterRace, findDuplicate, publishUsedLookups, replaceGrapes, resolveLookups } from './resolve';
import { inTransaction, type Outcome } from './transaction';
import { fetchWine } from './view';

const NOT_FOUND: Outcome = { status: 404, body: { code: 'not_found' } };

/** PUT: replaces the editable fields if `version` is still current (view-edit-wine FR-6 to FR-8). */
export async function updateWine(
  pool: Pool,
  userId: string,
  wineId: string,
  wine: ValidWine,
  version: number,
  idempotencyKey: string | null,
  year: number,
): Promise<Outcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await inTransaction(pool, userId, idempotencyKey, (db) => applyEdit(db, userId, wineId, wine, version, year));
    } catch (err) {
      if (attempt === 1 && LOOKUP_CONSTRAINTS.some((c) => isUniqueViolation(err, c))) continue;
      if (isUniqueViolation(err, 'wine_duplicate_uq')) return duplicateAfterRace(pool, userId, wine, wineId);
      throw err;
    }
  }
}

async function applyEdit(db: Client, userId: string, wineId: string, wine: ValidWine, version: number, year: number): Promise<Outcome> {
  // Lock the row so a concurrent edit or quantity change waits, then compare versions (BR-6).
  const current = await db.query<{ version: number }>('SELECT version FROM wine WHERE id = $1 AND owner_id = $2 FOR UPDATE', [wineId, userId]);
  if (!current.rows[0]) return NOT_FOUND;
  if (current.rows[0].version !== version) {
    return { status: 409, body: { code: 'version_conflict', current: await fetchWine(db, wineId, year) } };
  }

  const resolved = await resolveLookups(db, userId, wine);
  if ('errors' in resolved) return { status: 400, body: { errors: resolved.errors } };

  // BR-3: a wine is never a duplicate of itself.
  const dup = await findDuplicate(db, userId, resolved.producerId, wine, wineId);
  if (dup) return dup;

  await db.query(
    `UPDATE wine SET producer_id = $3, name = $4, name_norm = $5, vintage = $6, is_non_vintage = $7, colour_id = $8,
            bottle_size_id = $9, quantity = $10, country_id = $11, region_id = $12, purchase_price = $13, currency = $14,
            purchase_date = $15, storage_location = $16, drink_from = $17, drink_until = $18, notes = $19,
            version = version + 1, updated_at = now()
      WHERE id = $1 AND owner_id = $2`,
    [
      wineId, userId, resolved.producerId, wine.name, normalizeForSearch(wine.name), wine.vintage, wine.is_non_vintage,
      wine.colour_id, wine.bottle_size_id, wine.quantity, resolved.countryId, resolved.regionId, wine.purchase_price,
      wine.currency, wine.purchase_date, wine.storage_location, wine.drink_from, wine.drink_until, wine.notes,
    ],
  );
  await replaceGrapes(db, wineId, resolved.grapes);
  await publishUsedLookups(db, userId, resolved);
  return { status: 200, body: await fetchWine(db, wineId, year) };
}

/** "Opened one" / "Add bottles" / Undo: a relative, atomic change (FR-3 to FR-5, BR-4). */
export async function changeQuantity(pool: Pool, userId: string, wineId: string, change: number, idempotencyKey: string | null): Promise<Outcome> {
  return inTransaction(pool, userId, idempotencyKey, async (db) => {
    const updated = await db.query<{ quantity: number; version: number }>(
      `UPDATE wine SET quantity = quantity + $3, version = version + 1, updated_at = now()
        WHERE id = $1 AND owner_id = $2 AND quantity + $3 BETWEEN 0 AND $4
        RETURNING quantity, version`,
      [wineId, userId, change, LIMITS.quantityMax],
    );
    if (updated.rows[0]) return { status: 200, body: updated.rows[0] };
    const existing = await db.query<{ quantity: number }>('SELECT quantity FROM wine WHERE id = $1 AND owner_id = $2', [wineId, userId]);
    if (!existing.rows[0]) return NOT_FOUND;
    return { status: 422, body: { code: 'quantity_out_of_range', quantity: existing.rows[0].quantity } };
  });
}

/** FR-9 / BR-7: removes the wine and its grape links; shared lookups stay. */
export async function deleteWine(pool: Pool, userId: string, wineId: string): Promise<Outcome> {
  const res = await pool.query('DELETE FROM wine WHERE id = $1 AND owner_id = $2', [wineId, userId]);
  return res.rowCount ? { status: 204, body: undefined } : NOT_FOUND;
}
