import { describe, expect, it } from 'vitest';
import { drinkStatus, isSafeReturnTo, normalizeForSearch, validateWineInput, type ValidationContext } from '../src';

const ctx: ValidationContext = { currentYear: 2026, latestDate: '2026-10-24', isCurrency: (c) => ['EUR', 'USD', 'GBP'].includes(c) };
const valid = { producer: { name: ' Quinta  do Crasto ' }, name: 'Reserva', vintage: 2017, colour_id: 1, bottle_size_id: 4, quantity: 3 };

const fields = (raw: unknown) => {
  const r = validateWineInput(raw, ctx);
  return r.ok ? [] : r.errors.map((e) => `${e.field}:${e.code}`);
};

describe('validateWineInput', () => {
  it('accepts a minimal wine and normalises text', () => {
    const r = validateWineInput(valid, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.producer).toEqual({ name: 'Quinta do Crasto' });
      expect(r.value.currency).toBeNull();
      expect(r.value.grapes).toEqual([]);
    }
  });

  it('requires producer, name, colour, bottle size, quantity and a vintage or NV', () => {
    expect(fields({})).toEqual(expect.arrayContaining([
      'producer:required', 'name:required', 'vintage:required', 'colour_id:required', 'bottle_size_id:required', 'quantity:required',
    ]));
  });

  it('uses the exact producer message from AC-2', () => {
    const r = validateWineInput({ ...valid, producer: { name: '   ' } }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ field: 'producer', message: 'Producer is required' });
  });

  it('BR-2: rejects future vintages, both vintage and NV, and accepts NV alone', () => {
    expect(fields({ ...valid, vintage: 2099 })).toContain('vintage:out_of_range');
    expect(fields({ ...valid, is_non_vintage: true })).toContain('vintage:conflict');
    expect(fields({ ...valid, vintage: null, is_non_vintage: true })).toEqual([]);
  });

  it('BR-3: quantity is a whole number from 1 to 9999', () => {
    expect(fields({ ...valid, quantity: 0 })).toContain('quantity:out_of_range');
    expect(fields({ ...valid, quantity: 2.5 })).toContain('quantity:out_of_range');
    expect(fields({ ...valid, quantity: 9999 })).toEqual([]);
  });

  it('an edit may set quantity 0', () => {
    expect(validateWineInput({ ...valid, quantity: 0 }, ctx, { minQuantity: 0 }).ok).toBe(true);
    expect(validateWineInput({ ...valid, quantity: -1 }, ctx, { minQuantity: 0 }).ok).toBe(false);
  });

  it('BR-5: price, currency default and purchase date', () => {
    const r = validateWineInput({ ...valid, purchase_price: 24.5 }, ctx);
    expect(r.ok && r.value.currency).toBe('EUR');
    expect(fields({ ...valid, purchase_price: 1.234 })).toContain('purchase_price:invalid');
    expect(fields({ ...valid, purchase_price: 5, currency: 'XXQ' })).toContain('currency:invalid');
    expect(fields({ ...valid, purchase_date: '2026-10-25' })).toContain('purchase_date:future');
    expect(fields({ ...valid, purchase_date: '2026-02-30' })).toContain('purchase_date:invalid');
  });

  it('BR-7: drink window order and not before the vintage', () => {
    expect(fields({ ...valid, drink_from: 2030, drink_until: 2025 })).toContain('drink_from:out_of_range');
    expect(fields({ ...valid, drink_from: 2010 })).toContain('drink_from:out_of_range');
  });

  it('BR-8: text limits', () => {
    expect(fields({ ...valid, notes: 'x'.repeat(2001) })).toContain('notes:too_long');
    expect(fields({ ...valid, storage_location: 'x'.repeat(101) })).toContain('storage_location:too_long');
  });

  it('BR-10: grapes are distinct and add up to 100 or less', () => {
    expect(fields({ ...valid, grapes: [{ grape: { name: 'Touriga' } }, { grape: { name: 'touriga' } }] })).toContain('grapes:duplicate');
    expect(fields({ ...valid, grapes: [{ grape: { name: 'A' }, percentage: 60 }, { grape: { name: 'B' }, percentage: 50 }] })).toContain('grapes:out_of_range');
  });

  it('rejects system and unknown fields (AC-8)', () => {
    expect(fields({ ...valid, owner_id: 'x' })).toContain('owner_id:not_allowed');
    expect(fields({ ...valid, colour: 'red' })).toContain('colour:unknown_field');
  });
});

describe('drinkStatus', () => {
  it('derives the status from the drink window', () => {
    expect(drinkStatus(2028, null, 2026)).toBe('too_young');
    expect(drinkStatus(null, 2020, 2026)).toBe('past_best');
    expect(drinkStatus(2020, 2030, 2026)).toBe('ready');
    expect(drinkStatus(null, null, 2026)).toBe('unknown');
  });
});

describe('isSafeReturnTo', () => {
  it('accepts known app routes with a query', () => {
    expect(isSafeReturnTo('/collection/new')).toBe(true);
    expect(isSafeReturnTo('/collection?colour=red')).toBe(true);
    expect(isSafeReturnTo('/collection/wines/8b1e2c3d-1111-4222-8333-944455556666')).toBe(true);
    expect(isSafeReturnTo('/collection/wines/8b1e2c3d-1111-4222-8333-944455556666/edit')).toBe(true);
    expect(isSafeReturnTo('/collection/wines/not-a-uuid')).toBe(false);
  });
  it('rejects anything that could leave the app (AC-7)', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '/settings', '', 'collection', '/collection\n']) {
      expect(isSafeReturnTo(bad)).toBe(false);
    }
  });
});

describe('normalizeForSearch', () => {
  it('ignores case and accents', () => {
    expect(normalizeForSearch('  Château   Margaux ')).toBe('chateau margaux');
  });
});
