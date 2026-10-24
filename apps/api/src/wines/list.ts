import { COLLECTION_SORTS, COLOUR_CODES, LIMITS, normalizeForSearch, type CollectionSort, type FieldError } from '@cellar/shared';
import { sign, verify } from '../crypto';
import type { Pool } from '../db/pool';
import { WINE_COLUMNS, WINE_FROM, toListItem, type WineRow } from './view';

interface SortDef {
  /** Primary sort expression (null: created_at only). NV / missing values sort last. */
  key: string | null;
  keyType: 'int' | 'text';
  dir: 'ASC' | 'DESC';
}

const SORTS: Record<CollectionSort, SortDef> = {
  added_desc: { key: null, keyType: 'int', dir: 'DESC' },
  producer_asc: { key: 'lower(p.name)', keyType: 'text', dir: 'ASC' },
  vintage_desc: { key: 'COALESCE(w.vintage, -1)', keyType: 'int', dir: 'DESC' },
  vintage_asc: { key: 'COALESCE(w.vintage, 32767)', keyType: 'int', dir: 'ASC' },
  drink_by_asc: { key: 'COALESCE(w.drink_until, 32767)', keyType: 'int', dir: 'ASC' },
};

interface Cursor {
  s: CollectionSort;
  k: [string | number | null, string, string];
}

export interface ListQuery {
  q: string | null;
  colours: string[];
  country: string | null;
  sort: CollectionSort;
  cursor: Cursor | null;
  limit: number;
}

/** Parses and validates GET /collection/wines parameters (view-collection §8, BR-2). */
export function parseListQuery(raw: Record<string, unknown>, cursorKey: Buffer): { ok: true; query: ListQuery } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const str = (name: string) => (typeof raw[name] === 'string' ? (raw[name] as string) : null);

  let q = str('q')?.trim() ?? null;
  if (q && q.length > LIMITS.searchMax) errors.push({ field: 'q', code: 'too_long', message: `Search must be ${LIMITS.searchMax} characters or fewer` });
  if (q && q.length < LIMITS.searchMin) q = null;

  const colours = (str('colour') ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  for (const c of colours) {
    if (!(COLOUR_CODES as readonly string[]).includes(c)) errors.push({ field: 'colour', code: 'invalid', message: `Unknown colour "${c}"` });
  }

  const country = str('country')?.toUpperCase() || null;
  if (country && !/^[A-Z]{2}$/.test(country)) errors.push({ field: 'country', code: 'invalid', message: 'Use a two-letter country code' });

  const sortRaw = str('sort') ?? 'added_desc';
  const sort = (COLLECTION_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as CollectionSort) : null;
  if (!sort) errors.push({ field: 'sort', code: 'invalid', message: `Sort must be one of ${COLLECTION_SORTS.join(', ')}` });

  let limit: number = LIMITS.pageSizeDefault;
  if (str('limit') !== null) {
    limit = Number(str('limit'));
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.pageSizeMax) {
      errors.push({ field: 'limit', code: 'out_of_range', message: `Limit must be from 1 to ${LIMITS.pageSizeMax}` });
    }
  }

  let cursor: Cursor | null = null;
  const cursorRaw = str('cursor');
  if (cursorRaw) {
    cursor = verify<Cursor>(cursorRaw, cursorKey);
    if (!cursor || cursor.s !== sort || !Array.isArray(cursor.k) || cursor.k.length !== 3) {
      errors.push({ field: 'cursor', code: 'invalid', message: 'Invalid or expired cursor' });
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, query: { q, colours, country, sort: sort!, cursor, limit } };
}

export async function listWines(pool: Pool, userId: string, query: ListQuery, cursorKey: Buffer, year: number) {
  const params: unknown[] = [userId];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  // FR-12 / BR-6: wines with quantity 0 are hidden.
  const where = ['w.owner_id = $1', 'w.quantity > 0'];
  if (query.colours.length) where.push(`c.code = ANY(${p(query.colours)}::text[])`);
  if (query.country) where.push(`co.iso_code = ${p(query.country)}`);
  if (query.q) {
    const like = p(`%${normalizeForSearch(query.q).replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(w.name_norm LIKE ${like} OR p.name_norm LIKE ${like} OR r.name_norm LIKE ${like}
      OR EXISTS (SELECT 1 FROM wine_grape wg JOIN grape g ON g.id = wg.grape_id WHERE wg.wine_id = w.id AND g.name_norm LIKE ${like}))`);
  }
  const filterWhere = where.join(' AND ');
  const filterParams = [...params];

  // Keyset paging with created_at and id as tie-breakers (BR-4).
  const def = SORTS[query.sort];
  const tuple = def.key ? `(${def.key}, w.created_at, w.id)` : '(w.created_at, w.id)';
  const pageWhere = [...where];
  if (query.cursor) {
    const [k, createdAt, id] = query.cursor.k;
    const cast = def.keyType === 'int' ? '::int' : '::text';
    const values = def.key
      ? `(${p(k)}${cast}, ${p(createdAt)}::timestamptz, ${p(id)}::uuid)`
      : `(${p(createdAt)}::timestamptz, ${p(id)}::uuid)`;
    pageWhere.push(`${tuple} ${def.dir === 'ASC' ? '>' : '<'} ${values}`);
  }
  const order = def.key ? `${def.key} ${def.dir}, w.created_at ${def.dir}, w.id ${def.dir}` : `w.created_at ${def.dir}, w.id ${def.dir}`;

  const page = await pool.query<WineRow & { sort_key: string | number | null; created_at_key: string }>(
    `SELECT ${WINE_COLUMNS}, ${def.key ?? 'NULL'} AS sort_key, w.created_at::text AS created_at_key
       ${WINE_FROM}
      WHERE ${pageWhere.join(' AND ')}
      ORDER BY ${order}
      LIMIT ${query.limit + 1}`,
    params,
  );
  const totals = await pool.query<{ wines: number; bottles: number }>(
    `SELECT count(*)::int AS wines, COALESCE(sum(w.quantity), 0)::int AS bottles ${WINE_FROM} WHERE ${filterWhere}`,
    filterParams,
  );
  const all = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM wine WHERE owner_id = $1 AND quantity > 0', [userId]);

  const rows = page.rows.slice(0, query.limit);
  const last = rows[rows.length - 1];
  const nextCursor =
    page.rows.length > query.limit && last
      ? sign({ s: query.sort, k: [last.sort_key, last.created_at_key, last.id] } satisfies Cursor, cursorKey)
      : null;

  return {
    items: rows.map((r) => toListItem(r, year)),
    next_cursor: nextCursor,
    totals: { wines: totals.rows[0].wines, bottles: totals.rows[0].bottles, all_wines: all.rows[0].n },
  };
}
