import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WHITE, as, countryId, createTestApp, resetDb, signIn, wine, type Session, type TestApp } from './helpers';

let t: TestApp;
let ana: Session;
beforeEach(async () => {
  t = await createTestApp({ now: () => new Date('2026-10-24T12:00:00Z') });
  await resetDb(t.pool);
  ana = await signIn(t, 'ana@example.com');
});
afterEach(() => t.close());

const add = async (s: Session, body: Record<string, unknown>) => {
  const res = await as(t, s).post('/collection/wines', wine(body));
  expect(res.statusCode).toBe(201);
  return res.json();
};
const list = (s: Session, query = '') => as(t, s).get(`/collection/wines${query}`);
const names = (res: { json: () => { items: { name: string }[] } }) => res.json().items.map((i) => i.name);

/** Inserts n wines directly (fast) for paging tests. */
async function bulk(userId: string, n: number) {
  const p = await t.pool.query<{ id: string }>(
    `INSERT INTO producer (name, name_norm, created_by) VALUES ('Bulk', 'bulk', $1) RETURNING id`,
    [userId],
  );
  await t.pool.query(
    `INSERT INTO wine (owner_id, producer_id, name, name_norm, vintage, colour_id, bottle_size_id, quantity, created_at)
     SELECT $1, $2, 'W' || g, 'w' || g, 2000 + (g % 20), 1, 4, 1, now() - (g || ' seconds')::interval FROM generate_series(1, $3) g`,
    [userId, p.rows[0].id, n],
  );
}

describe('View collection — acceptance criteria', () => {
  it('AC-1: lists only my wines', async () => {
    const bob = await signIn(t, 'bob@example.com');
    for (const n of ['A', 'B', 'C']) await add(ana, { name: n });
    for (const n of ['D', 'E']) await add(bob, { name: n });
    const res = await list(ana);
    expect(names(res).sort()).toEqual(['A', 'B', 'C']);
  });

  it('AC-2: an empty collection returns no items and zero totals', async () => {
    const res = await list(ana);
    expect(res.json()).toEqual({ items: [], next_cursor: null, totals: { wines: 0, bottles: 0, all_wines: 0 } });
  });

  it('AC-3: totals count wines and bottles; NV is flagged', async () => {
    await add(ana, { quantity: 3 });
    await add(ana, { producer: { name: 'Krug' }, name: 'Grande Cuvée', vintage: null, is_non_vintage: true, quantity: 1 });
    const res = await list(ana);
    expect(res.json().totals).toEqual({ wines: 2, bottles: 4, all_wines: 2 });
    expect(res.json().items.find((i: { name: string }) => i.name === 'Grande Cuvée')).toMatchObject({ vintage: null, is_non_vintage: true });
  });

  it('AC-4: search ignores accents and case', async () => {
    await add(ana, { producer: { name: 'Château Margaux' }, name: 'Grand Vin' });
    await add(ana, { name: 'Other' });
    expect(names(await list(ana, '?q=chateau'))).toEqual(['Grand Vin']);
    expect(names(await list(ana, '?q=MARGAUX'))).toEqual(['Grand Vin']);
  });

  it('AC-5: search matches grape and region names', async () => {
    await add(ana, { name: 'Tinto', grapes: [{ grape: { name: 'Touriga Nacional' } }] });
    await add(ana, { name: 'Branco', country_id: await countryId(t.pool, 'PT'), region: { name: 'Douro' } });
    expect(names(await list(ana, '?q=touriga'))).toEqual(['Tinto']);
    expect(names(await list(ana, '?q=douro'))).toEqual(['Branco']);
  });

  it('AC-6: no matches returns an empty list with the overall count', async () => {
    await add(ana, {});
    const res = await list(ana, '?q=zzz');
    expect(res.json().items).toEqual([]);
    expect(res.json().totals).toEqual({ wines: 0, bottles: 0, all_wines: 1 });
  });

  it('AC-7: filters by several colours and the totals follow', async () => {
    await add(ana, { name: 'Red one', quantity: 2 });
    await add(ana, { name: 'White one', colour_id: WHITE, quantity: 5 });
    await add(ana, { name: 'Bubbles', colour_id: 4 });
    const res = await list(ana, '?colour=red,white');
    expect(names(res).sort()).toEqual(['Red one', 'White one']);
    expect(res.json().totals).toMatchObject({ wines: 2, bottles: 7, all_wines: 3 });
  });

  it('AC-8: filters by country', async () => {
    await add(ana, { name: 'Douro red', country_id: await countryId(t.pool, 'PT') });
    await add(ana, { name: 'Bordeaux red', country_id: await countryId(t.pool, 'FR') });
    expect(names(await list(ana, '?country=PT'))).toEqual(['Douro red']);
  });

  it('AC-9 / AC-10: drink status is derived from the drink window', async () => {
    await add(ana, { name: 'Young', drink_from: 2028 });
    await add(ana, { name: 'Unknown' });
    const items = (await list(ana)).json().items;
    expect(items.find((i: { name: string }) => i.name === 'Young').drink_status).toBe('too_young');
    expect(items.find((i: { name: string }) => i.name === 'Unknown').drink_status).toBe('unknown');
  });

  it('AC-11: drink-by sorts earliest first, wines without a year last', async () => {
    await add(ana, { name: 'None' });
    await add(ana, { name: '2030', drink_until: 2030 });
    await add(ana, { name: '2027', drink_until: 2027 });
    expect(names(await list(ana, '?sort=drink_by_asc'))).toEqual(['2027', '2030', 'None']);
  });

  it('sorts by producer and by vintage, NV last', async () => {
    await add(ana, { producer: { name: 'Zeta' }, name: 'Z', vintage: 2010 });
    await add(ana, { producer: { name: 'alpha' }, name: 'A', vintage: 2020 });
    await add(ana, { producer: { name: 'Mu' }, name: 'NV', vintage: null, is_non_vintage: true });
    expect(names(await list(ana, '?sort=producer_asc'))).toEqual(['A', 'NV', 'Z']);
    expect(names(await list(ana, '?sort=vintage_desc'))).toEqual(['A', 'Z', 'NV']);
    expect(names(await list(ana, '?sort=vintage_asc'))).toEqual(['Z', 'A', 'NV']);
  });

  it('AC-12: 120 wines load in 3 pages with no duplicates or gaps, for every sort', async () => {
    await bulk(ana.userId, 120);
    for (const sort of ['added_desc', 'producer_asc', 'vintage_desc', 'vintage_asc', 'drink_by_asc']) {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await list(ana, `?sort=${sort}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(res.statusCode).toBe(200);
        seen.push(...res.json().items.map((i: { id: string }) => i.id));
        cursor = res.json().next_cursor;
        pages++;
      } while (cursor);
      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(120);
    }
  });

  it('a wine added while paging does not cause duplicates', async () => {
    await bulk(ana.userId, 60);
    const first = await list(ana);
    await add(ana, { name: 'Newest' });
    const second = await list(ana, `?cursor=${encodeURIComponent(first.json().next_cursor)}`);
    const ids = [...first.json().items, ...second.json().items].map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(60);
  });

  it('AC-16: the newest wine comes first by default', async () => {
    await add(ana, { name: 'Older' });
    await add(ana, { name: 'Newer' });
    expect(names(await list(ana))[0]).toBe('Newer');
  });

  it('AC-18: invalid parameters return 400', async () => {
    for (const q of ['?sort=foo', '?colour=blue', '?country=Portugal', '?limit=500', '?cursor=forged.cursor', `?q=${'x'.repeat(101)}`]) {
      const res = await list(ana, q);
      expect(res.statusCode, q).toBe(400);
    }
    expect((await list(ana, '?sort=foo')).json().errors[0].field).toBe('sort');
  });

  it('a cursor from another sort is rejected', async () => {
    await bulk(ana.userId, 60);
    const cursor = (await list(ana)).json().next_cursor;
    expect((await list(ana, `?sort=producer_asc&cursor=${encodeURIComponent(cursor)}`)).statusCode).toBe(400);
  });

  it('a one-character search is ignored', async () => {
    await add(ana, {});
    expect((await list(ana, '?q=z')).json().items).toHaveLength(1);
  });

  it('FR-12: wines with quantity 0 are hidden and not counted', async () => {
    const w = await add(ana, { name: 'Finished' });
    await add(ana, { name: 'Still here' });
    await t.pool.query('UPDATE wine SET quantity = 0 WHERE id = $1', [w.id]);
    const res = await list(ana);
    expect(names(res)).toEqual(['Still here']);
    expect(res.json().totals).toEqual({ wines: 1, bottles: 3, all_wines: 1 });
  });

  it('unauthenticated requests get 401', async () => {
    expect((await t.app.inject({ url: '/api/v1/collection/wines' })).statusCode).toBe(401);
  });

  it('AC-19: first page and totals for 10 000 wines in under 500 ms', async () => {
    await bulk(ana.userId, 10_000);
    await t.pool.query('ANALYZE');
    const timings: number[] = [];
    for (const q of ['', '?q=w99', '?sort=producer_asc', '?colour=red']) {
      const start = performance.now();
      const res = await list(ana, q);
      timings.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
    }
    expect(Math.max(...timings)).toBeLessThan(500);
  });
});
