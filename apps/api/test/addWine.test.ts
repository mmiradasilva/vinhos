import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BOTTLE_750, ORIGIN, WHITE, as, countryId, createTestApp, regionId, resetDb, signIn, wine, type Session, type TestApp } from './helpers';

let t: TestApp;
let ana: Session;
beforeEach(async () => {
  t = await createTestApp({ now: () => new Date('2026-10-24T12:00:00Z') });
  await resetDb(t.pool);
  ana = await signIn(t, 'ana@example.com');
});
afterEach(() => t.close());

const add = (s: Session, body: unknown, headers?: Record<string, string>) => as(t, s).post('/collection/wines', body, headers);
const wineCount = async () => (await t.pool.query('SELECT count(*)::int AS n FROM wine')).rows[0].n;
const errorFields = (res: { json: () => { errors: { field: string }[] } }) => res.json().errors.map((e) => e.field);

describe('Add a wine — acceptance criteria', () => {
  it('AC-1: saves a valid wine with defaults for bottle size', async () => {
    const res = await add(ana, wine());
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      producer: { name: 'Quinta do Crasto' },
      name: 'Reserva',
      vintage: 2017,
      quantity: 3,
      bottle_size: { volume_ml: 750 },
      colour: { code: 'red' },
    });
    expect(res.headers.location).toBe(`/api/v1/collection/wines/${body.id}`);
  });

  it('AC-2: missing producer is rejected with "Producer is required"', async () => {
    const res = await add(ana, wine({ producer: { name: '' } }));
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toContainEqual(expect.objectContaining({ field: 'producer', message: 'Producer is required' }));
    expect(await wineCount()).toBe(0);
  });

  it('AC-3: vintage 2099 is rejected', async () => {
    const res = await add(ana, wine({ vintage: 2099 }));
    expect(res.statusCode).toBe(400);
    expect(errorFields(res)).toContain('vintage');
  });

  it('AC-4: quantity 0 or 2.5 is rejected', async () => {
    for (const quantity of [0, 2.5]) {
      const res = await add(ana, wine({ quantity }));
      expect(res.statusCode).toBe(400);
      expect(errorFields(res)).toContain('quantity');
    }
    expect(await wineCount()).toBe(0);
  });

  it('AC-5: a duplicate in different case is blocked and the existing quantity is unchanged', async () => {
    const first = (await add(ana, wine())).json();
    const res = await add(ana, wine({ producer: { name: 'QUINTA DO CRASTO' }, name: 'reserva', quantity: 2 }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'duplicate', existing_id: first.id, existing_quantity: 3 });
    expect(await wineCount()).toBe(1);
  });

  it('AC-6: an NV duplicate is blocked', async () => {
    const krug = wine({ producer: { name: 'Krug' }, name: 'Grande Cuvée', vintage: null, is_non_vintage: true, colour_id: 4, quantity: 1 });
    expect((await add(ana, krug)).statusCode).toBe(201);
    expect((await add(ana, krug)).statusCode).toBe(409);
  });

  it('AC-7: an unauthenticated request gets 401', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/collection/wines', payload: wine(), headers: { origin: ORIGIN } });
    expect(res.statusCode).toBe(401);
    expect(await wineCount()).toBe(0);
  });

  it('AC-8: a body with owner_id is rejected', async () => {
    const other = await signIn(t, 'bob@example.com');
    const res = await add(ana, wine({ owner_id: other.userId }));
    expect(res.statusCode).toBe(400);
    expect(errorFields(res)).toContain('owner_id');
    expect(await wineCount()).toBe(0);
  });

  it('AC-10: the same Idempotency-Key creates exactly one wine, even concurrently', async () => {
    const headers = { 'idempotency-key': 'abc-123' };
    const [a, b] = await Promise.all([add(ana, wine(), headers), add(ana, wine(), headers)]);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.json().id).toBe(a.json().id);
    expect(await wineCount()).toBe(1);
  });

  it('AC-14: a valid session without a CSRF token gets 403', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/collection/wines',
      cookies: { [t.ctx.cookies.session]: ana.cookie },
      payload: wine(),
    });
    expect(res.statusCode).toBe(403);
    const foreign = await add(ana, wine(), { origin: 'https://evil.example' });
    expect(foreign.statusCode).toBe(403);
    expect(await wineCount()).toBe(0);
  });

  it('AC-16: the 61st add within a minute gets 429', async () => {
    for (let i = 0; i < 60; i++) await add(ana, wine({ name: `Cuvée ${i}` }));
    const res = await add(ana, wine({ name: 'One too many' }));
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('AC-17: a new grape is not created if the wine is not saved', async () => {
    await add(ana, wine());
    const res = await add(ana, wine({ grapes: [{ grape: { name: 'Tinta Roriz' } }] })); // duplicate wine -> 409
    expect(res.statusCode).toBe(409);
    expect((await t.pool.query(`SELECT 1 FROM grape WHERE name = 'Tinta Roriz'`)).rowCount).toBe(0);
    const ok = await add(ana, wine({ name: 'Vinha Maria Teresa', grapes: [{ grape: { name: 'Tinta Roriz' }, percentage: 40 }] }));
    expect(ok.statusCode).toBe(201);
    expect(ok.json().grapes).toEqual([{ grape: { id: expect.any(String), name: 'Tinta Roriz' }, percentage: 40 }]);
  });

  it('AC-18: a region from another country is rejected', async () => {
    const res = await add(ana, wine({ country_id: await countryId(t.pool, 'FR'), region: { id: await regionId(t.pool, 'Douro') } }));
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toContainEqual(expect.objectContaining({ field: 'region', code: 'country_mismatch' }));
  });

  it('BR-9: a region without a country sets the country', async () => {
    const res = await add(ana, wine({ region: { id: await regionId(t.pool, 'Douro') } }));
    expect(res.json()).toMatchObject({ region: { name: 'Douro' }, country: { iso_code: 'PT' } });
  });

  it('BR-9: a new region needs a country', async () => {
    const res = await add(ana, wine({ region: { name: 'Távora-Varosa' } }));
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toContainEqual(expect.objectContaining({ field: 'region', code: 'country_required' }));
  });

  it('AC-19: typing an existing producer in another case reuses it', async () => {
    await add(ana, wine());
    await add(ana, wine({ producer: { name: 'quinta do crasto' }, name: 'Superior' }));
    expect((await t.pool.query('SELECT count(*)::int AS n FROM producer')).rows[0].n).toBe(1);
  });

  it('AC-21: a full collection gets 422', async () => {
    const p = (await add(ana, wine())).json().producer.id;
    await t.pool.query(
      `INSERT INTO wine (owner_id, producer_id, name, name_norm, vintage, colour_id, bottle_size_id, quantity)
       SELECT $1, $2, 'W' || g, 'w' || g, 2020, 1, 4, 1 FROM generate_series(1, 9999) g`,
      [ana.userId, p],
    );
    const res = await add(ana, wine({ name: 'One more' }));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ code: 'collection_limit' });
  });

  it('AC-24: another user does not see a private producer in autocomplete', async () => {
    await add(ana, wine({ producer: { name: 'Quinta Nova X' } }));
    const bob = await signIn(t, 'bob@example.com');
    const res = await as(t, bob).get('/producers?q=quinta');
    expect(res.json().items.map((p: { name: string }) => p.name)).not.toContain('Quinta Nova X');
    const own = await as(t, ana).get('/producers?q=quinta');
    expect(own.json().items.map((p: { name: string }) => p.name)).toContain('Quinta Nova X');
  });

  it('AC-25: a second user typing the same name reuses the row and makes it public', async () => {
    const first = (await add(ana, wine({ producer: { name: 'Quinta Nova X' } }))).json();
    const bob = await signIn(t, 'bob@example.com');
    const res = await add(bob, wine({ producer: { name: 'quinta nova x' } }));
    expect(res.json().producer.id).toBe(first.producer.id);
    const carol = await signIn(t, 'carol@example.com');
    const seen = await as(t, carol).get('/producers?q=nova');
    expect(seen.json().items.map((p: { name: string }) => p.name)).toContain('Quinta Nova X');
  });

  it('stores every optional field, defaulting the currency to EUR', async () => {
    const res = await add(ana, wine({
      colour_id: WHITE,
      bottle_size_id: BOTTLE_750,
      country_id: await countryId(t.pool, 'PT'),
      region: { name: 'Lisboa' },
      grapes: [{ grape: { name: 'Arinto' }, percentage: 100 }],
      purchase_price: 24.5,
      purchase_date: '2026-10-01',
      storage_location: 'Rack B, shelf 2',
      drink_from: 2024,
      drink_until: 2032,
      notes: 'Gift from Ana — 酒',
    }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      region: { name: 'Lisboa' },
      currency: 'EUR',
      purchase_price: 24.5,
      purchase_date: '2026-10-01',
      notes: 'Gift from Ana — 酒',
      drink_status: 'ready',
    });
  });

  it('lookup endpoints return the seeded lists', async () => {
    const api = as(t, ana);
    expect((await api.get('/colours')).json().items).toHaveLength(7);
    expect((await api.get('/bottle-sizes')).json().items).toHaveLength(7);
    expect((await api.get('/countries')).json().items).toHaveLength(249);
    expect((await api.get('/regions?country=PT&q=dou')).json().items[0]).toMatchObject({ name: 'Douro', country: { iso_code: 'PT' } });
    expect((await api.get('/grapes?q=touriga')).json().items.map((g: { name: string }) => g.name)).toContain('Touriga Nacional');
    expect((await t.app.inject({ url: '/api/v1/colours' })).statusCode).toBe(401);
  });
});
