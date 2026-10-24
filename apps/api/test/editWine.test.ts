import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ORIGIN, as, countryId, createTestApp, regionId, resetDb, signIn, wine, type Session, type TestApp } from './helpers';

let t: TestApp;
let ana: Session;
beforeEach(async () => {
  t = await createTestApp({ now: () => new Date('2026-10-24T12:00:00Z') });
  await resetDb(t.pool);
  ana = await signIn(t, 'ana@example.com');
});
afterEach(() => t.close());

const add = async (s: Session, body: Record<string, unknown> = {}) => {
  const res = await as(t, s).post('/collection/wines', wine(body));
  expect(res.statusCode).toBe(201);
  return res.json();
};
const get = (s: Session, id: string) => as(t, s).get(`/collection/wines/${id}`);
const quantity = (s: Session, id: string, change: unknown, headers?: Record<string, string>) =>
  as(t, s).post(`/collection/wines/${id}/quantity`, { change }, headers);
const put = (s: Session, id: string, body: unknown) =>
  t.app.inject({
    method: 'PUT',
    url: `/api/v1/collection/wines/${id}`,
    cookies: { [t.ctx.cookies.session]: s.cookie },
    headers: { 'x-csrf-token': s.csrf, origin: ORIGIN },
    payload: body as object,
  });
const del = (s: Session, id: string, headers: Record<string, string> = { 'x-csrf-token': s.csrf, origin: ORIGIN }) =>
  t.app.inject({ method: 'DELETE', url: `/api/v1/collection/wines/${id}`, cookies: { [t.ctx.cookies.session]: s.cookie }, headers });

/** The edit body for an existing wine: its current fields as input, plus changes. */
function editBody(w: Record<string, any>, changes: Record<string, unknown> = {}) {
  return {
    producer: { id: w.producer.id },
    name: w.name,
    vintage: w.vintage,
    is_non_vintage: w.is_non_vintage,
    colour_id: w.colour.id,
    bottle_size_id: w.bottle_size.id,
    quantity: w.quantity,
    country_id: w.country?.id ?? null,
    region: w.region ? { id: w.region.id } : null,
    grapes: w.grapes.map((g: any) => ({ grape: { id: g.grape.id }, percentage: g.percentage })),
    version: w.version,
    ...changes,
  };
}

describe('View / edit wine — acceptance criteria', () => {
  it('AC-1: returns every recorded field', async () => {
    const w = await add(ana, {
      region: { id: await regionId(t.pool, 'Douro') },
      grapes: [{ grape: { name: 'Touriga Nacional' }, percentage: 60 }],
      notes: 'Gift',
      purchase_price: 24.5,
    });
    const res = await get(ana, w.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: w.id,
      producer: { name: 'Quinta do Crasto' },
      region: { name: 'Douro' },
      country: { iso_code: 'PT' },
      grapes: [{ grape: { name: 'Touriga Nacional' }, percentage: 60 }],
      notes: 'Gift',
      purchase_price: 24.5,
      currency: 'EUR',
      version: 1,
    });
  });

  it('AC-2: another user\'s wine is indistinguishable from a missing one', async () => {
    const w = await add(ana);
    const bob = await signIn(t, 'bob@example.com');
    const theirs = await get(bob, w.id);
    const missing = await get(bob, '00000000-0000-4000-8000-000000000000');
    const garbage = await get(bob, 'not-a-uuid');
    for (const res of [theirs, missing, garbage]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'not_found' });
    }
    expect((await quantity(bob, w.id, -1)).statusCode).toBe(404);
    expect((await put(bob, w.id, editBody(w))).statusCode).toBe(404);
    expect((await del(bob, w.id)).statusCode).toBe(404);
    expect((await get(ana, w.id)).json().quantity).toBe(3);
  });

  it('AC-3: "Opened one" decreases the quantity and the version', async () => {
    const w = await add(ana);
    const res = await quantity(ana, w.id, -1);
    expect(res.json()).toEqual({ quantity: 2, version: 2 });
  });

  it('AC-4: two simultaneous "Opened one" decrease by exactly 2', async () => {
    const w = await add(ana);
    await Promise.all([quantity(ana, w.id, -1), quantity(ana, w.id, -1)]);
    expect((await get(ana, w.id)).json().quantity).toBe(1);
  });

  it('AC-5: at 0 the wine leaves the collection list but can still be opened', async () => {
    const w = await add(ana, { quantity: 1 });
    expect((await quantity(ana, w.id, -1)).json().quantity).toBe(0);
    expect((await as(t, ana).get('/collection/wines')).json().items).toEqual([]);
    expect((await get(ana, w.id)).json().quantity).toBe(0);
  });

  it('AC-6 / AC-8: the quantity cannot go below 0 or above 9 999', async () => {
    const w = await add(ana, { quantity: 1 });
    await quantity(ana, w.id, -1);
    const below = await quantity(ana, w.id, -1);
    expect(below.statusCode).toBe(422);
    expect(below.json()).toEqual({ code: 'quantity_out_of_range', quantity: 0 });
    const big = await add(ana, { name: 'Big', quantity: 9990 });
    expect((await quantity(ana, big.id, 10)).statusCode).toBe(422);
    expect((await get(ana, big.id)).json().quantity).toBe(9990);
  });

  it('AC-7 / AC-9: adding bottles to a wine found via the duplicate notice', async () => {
    const w = await add(ana, { quantity: 2 });
    const dup = await as(t, ana).post('/collection/wines', wine({ quantity: 6 }));
    expect(dup.json().existing_id).toBe(w.id);
    expect((await quantity(ana, dup.json().existing_id, 6)).json().quantity).toBe(8);
  });

  it('AC-22: Undo is a +1 that restores the count', async () => {
    const w = await add(ana);
    await quantity(ana, w.id, -1);
    expect((await quantity(ana, w.id, 1)).json().quantity).toBe(3);
  });

  it('a repeated quantity request with the same Idempotency-Key is applied once', async () => {
    const w = await add(ana);
    const h = { 'idempotency-key': 'tap-1' };
    await Promise.all([quantity(ana, w.id, -1, h), quantity(ana, w.id, -1, h)]);
    expect((await get(ana, w.id)).json().quantity).toBe(2);
  });

  it('rejects a zero or fractional change', async () => {
    const w = await add(ana);
    for (const change of [0, 1.5, 'one', null]) expect((await quantity(ana, w.id, change)).statusCode).toBe(400);
  });

  it('AC-10: an edit saves and increases the version', async () => {
    const w = await add(ana);
    const res = await put(ana, w.id, editBody(w, { vintage: 2018, notes: 'Corrected' }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ vintage: 2018, notes: 'Corrected', version: 2 });
  });

  it('BR-5: an edit may set quantity 0, but add still may not', async () => {
    const w = await add(ana);
    expect((await put(ana, w.id, editBody(w, { quantity: 0 }))).json().quantity).toBe(0);
    expect((await as(t, ana).post('/collection/wines', wine({ name: 'New', quantity: 0 }))).statusCode).toBe(400);
  });

  it('AC-11: an edit that duplicates another wine is blocked', async () => {
    const w2017 = await add(ana);
    const w2018 = await add(ana, { vintage: 2018 });
    const res = await put(ana, w2018.id, editBody(w2018, { vintage: 2017 }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'duplicate', existing_id: w2017.id, existing_quantity: 3 });
    expect((await get(ana, w2018.id)).json().vintage).toBe(2018);
  });

  it('AC-12: a wine is not a duplicate of itself', async () => {
    const w = await add(ana);
    const res = await put(ana, w.id, editBody(w, { name: 'RESERVA' }));
    expect(res.statusCode).toBe(200);
  });

  it('AC-13: a stale version is refused and the latest values are returned', async () => {
    const w = await add(ana);
    await put(ana, w.id, editBody(w, { notes: 'From the laptop' }));
    const res = await put(ana, w.id, editBody(w, { notes: 'From the phone' }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'version_conflict', current: { notes: 'From the laptop', version: 2 } });
    expect((await get(ana, w.id)).json().notes).toBe('From the laptop');
  });

  it('AC-14: a quantity change elsewhere also makes an open edit stale', async () => {
    const w = await add(ana);
    await quantity(ana, w.id, -1);
    expect((await put(ana, w.id, editBody(w))).json().code).toBe('version_conflict');
  });

  it('PUT without a version is rejected', async () => {
    const w = await add(ana);
    const { version: _v, ...noVersion } = editBody(w);
    expect((await put(ana, w.id, noVersion)).statusCode).toBe(400);
  });

  it('AC-16: delete removes the wine and its grapes, but keeps the producer', async () => {
    const w = await add(ana, { grapes: [{ grape: { name: 'Tinta Roriz' } }] });
    expect((await del(ana, w.id)).statusCode).toBe(204);
    expect((await get(ana, w.id)).statusCode).toBe(404);
    expect((await t.pool.query('SELECT 1 FROM wine_grape')).rowCount).toBe(0);
    expect((await t.pool.query(`SELECT 1 FROM producer WHERE name = 'Quinta do Crasto'`)).rowCount).toBe(1);
    expect((await t.pool.query(`SELECT 1 FROM grape WHERE name = 'Tinta Roriz'`)).rowCount).toBe(1);
    expect((await del(ana, w.id)).statusCode).toBe(404);
  });

  it('AC-19: changes without a CSRF token are refused', async () => {
    const w = await add(ana);
    const cookies = { [t.ctx.cookies.session]: ana.cookie };
    const noCsrf = [
      await t.app.inject({ method: 'PUT', url: `/api/v1/collection/wines/${w.id}`, cookies, payload: editBody(w) }),
      await t.app.inject({ method: 'POST', url: `/api/v1/collection/wines/${w.id}/quantity`, cookies, payload: { change: -1 } }),
      await del(ana, w.id, {}),
    ];
    for (const res of noCsrf) expect(res.statusCode).toBe(403);
    expect((await get(ana, w.id)).json()).toMatchObject({ quantity: 3, version: 1 });
  });

  it('AC-20: a region from another country is rejected on edit', async () => {
    const w = await add(ana, { country_id: await countryId(t.pool, 'PT') });
    const res = await put(ana, w.id, editBody(w, { region: { id: await regionId(t.pool, 'Rioja') } }));
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toContainEqual(expect.objectContaining({ field: 'region', code: 'country_mismatch' }));
  });

  it('BR-8: edits share the 60-per-minute write limit', async () => {
    const w = await add(ana);
    for (let i = 0; i < 59; i++) await quantity(ana, w.id, 1);
    expect((await quantity(ana, w.id, 1)).statusCode).toBe(429);
  });
});
