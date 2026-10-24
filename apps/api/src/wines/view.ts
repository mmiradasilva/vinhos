import { drinkStatus } from '@cellar/shared';
import type { Client, Pool } from '../db/pool';

/** FROM/JOIN clause shared by the single-wine view and the collection list. */
export const WINE_FROM = `
  FROM wine w
  JOIN producer p ON p.id = w.producer_id
  JOIN colour c ON c.id = w.colour_id
  JOIN bottle_size b ON b.id = w.bottle_size_id
  LEFT JOIN country co ON co.id = w.country_id
  LEFT JOIN region r ON r.id = w.region_id`;

export const WINE_COLUMNS = `
  w.id, w.name, w.vintage, w.is_non_vintage, w.quantity, w.drink_from, w.drink_until,
  w.purchase_price, w.currency, w.purchase_date, w.storage_location, w.notes, w.created_at, w.updated_at, w.version,
  p.id AS producer_id, p.name AS producer_name,
  c.id AS colour_id, c.code AS colour_code, c.name AS colour_name,
  b.id AS bottle_size_id, b.volume_ml, b.name AS bottle_name,
  co.id AS country_id, co.iso_code, co.name AS country_name,
  r.id AS region_id, r.name AS region_name`;

export interface WineRow {
  id: string;
  name: string;
  vintage: number | null;
  is_non_vintage: boolean;
  quantity: number;
  drink_from: number | null;
  drink_until: number | null;
  purchase_price: number | null;
  currency: string | null;
  purchase_date: string | null;
  storage_location: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
  producer_id: string;
  producer_name: string;
  colour_id: number;
  colour_code: string;
  colour_name: string;
  bottle_size_id: number;
  volume_ml: number;
  bottle_name: string;
  country_id: number | null;
  iso_code: string | null;
  country_name: string | null;
  region_id: string | null;
  region_name: string | null;
}

/** List item shape (view-collection §8). */
export function toListItem(row: WineRow, year: number) {
  return {
    id: row.id,
    producer: { id: row.producer_id, name: row.producer_name },
    name: row.name,
    vintage: row.vintage,
    is_non_vintage: row.is_non_vintage,
    colour: { id: row.colour_id, code: row.colour_code, name: row.colour_name },
    bottle_size: { id: row.bottle_size_id, volume_ml: row.volume_ml, name: row.bottle_name },
    quantity: row.quantity,
    country: row.iso_code ? { id: row.country_id, iso_code: row.iso_code, name: row.country_name } : null,
    region: row.region_id ? { id: row.region_id, name: row.region_name } : null,
    drink_status: drinkStatus(row.drink_from, row.drink_until, year),
    created_at: row.created_at,
  };
}

/** Full wine, as returned by POST/GET/PUT /collection/wines. With `ownerId`, returns null for anyone else's wine. */
export async function fetchWine(db: Pool | Client, id: string, year: number, ownerId?: string) {
  const { rows } = await db.query<WineRow>(
    `SELECT ${WINE_COLUMNS} ${WINE_FROM} WHERE w.id = $1 AND ($2::uuid IS NULL OR w.owner_id = $2)`,
    [id, ownerId ?? null],
  );
  const row = rows[0];
  if (!row) return null;
  const grapes = await db.query<{ id: string; name: string; percentage: number | null }>(
    `SELECT g.id, g.name, wg.percentage FROM wine_grape wg JOIN grape g ON g.id = wg.grape_id WHERE wg.wine_id = $1 ORDER BY g.name`,
    [id],
  );
  return {
    ...toListItem(row, year),
    grapes: grapes.rows.map((g) => ({ grape: { id: g.id, name: g.name }, percentage: g.percentage })),
    purchase_price: row.purchase_price,
    currency: row.currency,
    purchase_date: row.purchase_date,
    storage_location: row.storage_location,
    drink_from: row.drink_from,
    drink_until: row.drink_until,
    notes: row.notes,
    updated_at: row.updated_at,
    version: row.version,
  };
}
