import { DEFAULT_CURRENCY, LIMITS } from './constants';
import { cleanText } from './text';

/** A lookup value: an existing row by id, or a new one by name (add-wine §8). */
export type Ref = { id: string } | { name: string };

export interface GrapeInput {
  grape: Ref;
  percentage?: number | null;
}

/** Request body of POST /api/v1/collection/wines. */
export interface WineInput {
  producer: Ref;
  name: string;
  vintage?: number | null;
  is_non_vintage?: boolean;
  colour_id: number;
  bottle_size_id: number;
  quantity: number;
  country_id?: number | null;
  region?: Ref | null;
  grapes?: GrapeInput[];
  purchase_price?: number | null;
  currency?: string | null;
  purchase_date?: string | null;
  storage_location?: string | null;
  drink_from?: number | null;
  drink_until?: number | null;
  notes?: string | null;
}

/** WineInput after validation: trimmed, defaults applied, every optional field present. */
export interface ValidWine {
  producer: Ref;
  name: string;
  vintage: number | null;
  is_non_vintage: boolean;
  colour_id: number;
  bottle_size_id: number;
  quantity: number;
  country_id: number | null;
  region: Ref | null;
  grapes: { grape: Ref; percentage: number | null }[];
  purchase_price: number | null;
  currency: string | null;
  purchase_date: string | null;
  storage_location: string | null;
  drink_from: number | null;
  drink_until: number | null;
  notes: string | null;
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export interface ValidationContext {
  currentYear: number;
  /** Latest allowed purchase date, YYYY-MM-DD. */
  latestDate: string;
  isCurrency: (code: string) => boolean;
}

export type ValidationResult = { ok: true; value: ValidWine } | { ok: false; errors: FieldError[] };

const INPUT_FIELDS = new Set<string>([
  'producer', 'name', 'vintage', 'is_non_vintage', 'colour_id', 'bottle_size_id', 'quantity',
  'country_id', 'region', 'grapes', 'purchase_price', 'currency', 'purchase_date',
  'storage_location', 'drink_from', 'drink_until', 'notes',
]);
const SYSTEM_FIELDS = new Set(['id', 'owner_id', 'created_at', 'updated_at']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MESSAGES = {
  producerRequired: 'Producer is required',
  nameRequired: 'Name is required',
  vintage: (year: number) => `Enter a vintage between ${LIMITS.vintageMin} and ${year}, or tick NV`,
  vintageWithNv: "A non-vintage wine can't have a vintage year",
  colour: 'Choose a colour',
  bottleSize: 'Choose a bottle size',
  quantity: (min: number) => `Quantity must be a whole number from ${min} to 9,999`,
  country: 'Choose a country from the list',
  regionCountry: "This region isn't in the selected country",
  regionNeedsCountry: 'Choose a country to add a new region',
  price: 'Price must be 0 or more, with at most 2 decimals',
  currency: 'Choose a valid currency',
  dateInvalid: 'Enter a valid date',
  dateFuture: "Purchase date can't be in the future",
  drinkYear: `Enter a year between ${LIMITS.drinkYearMin} and ${LIMITS.drinkYearMax}`,
  drinkOrder: 'Drink-from year must be on or before the drink-until year',
  drinkBeforeVintage: "Drink-from year can't be before the vintage",
  grapeDuplicate: 'Each grape can only be added once',
  grapePercentage: 'Each percentage must be a whole number from 1 to 100',
  grapeTotal: "Grape percentages can't add up to more than 100",
  notFound: 'Choose a value from the list',
} as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Validates a wine submission against add-wine §7 (BR-1 to BR-10).
 * Rules that need the database (BR-6, BR-9 region/country, BR-11, BR-12, BR-13) live in the API.
 */
export function validateWineInput(raw: unknown, ctx: ValidationContext, opts: { minQuantity?: number } = {}): ValidationResult {
  const minQuantity = opts.minQuantity ?? LIMITS.quantityMin;
  const errors: FieldError[] = [];
  const add = (field: string, code: string, message: string) => errors.push({ field, code, message });

  if (!isObject(raw)) return { ok: false, errors: [{ field: 'body', code: 'invalid', message: 'Expected a JSON object' }] };

  for (const key of Object.keys(raw)) {
    if (SYSTEM_FIELDS.has(key)) add(key, 'not_allowed', `"${key}" is set by the system`);
    else if (!INPUT_FIELDS.has(key)) add(key, 'unknown_field', `Unknown field "${key}"`);
  }

  const ref = (field: string, value: unknown, maxLength: number, requiredMessage?: string): Ref | null => {
    if (isBlank(value) || (isObject(value) && isBlank(value.id) && isBlank(value.name))) {
      if (requiredMessage) add(field, 'required', requiredMessage);
      return null;
    }
    if (!isObject(value)) {
      add(field, 'invalid', MESSAGES.notFound);
      return null;
    }
    if (!isBlank(value.id)) {
      if (typeof value.id === 'string' && UUID.test(value.id)) return { id: value.id.toLowerCase() };
      add(field, 'invalid', MESSAGES.notFound);
      return null;
    }
    if (typeof value.name !== 'string') {
      add(field, 'invalid', MESSAGES.notFound);
      return null;
    }
    const name = cleanText(value.name);
    if (name.length > maxLength) {
      add(field, 'too_long', `Must be ${maxLength} characters or fewer`);
      return null;
    }
    return { name };
  };

  const optionalText = (field: string, value: unknown, maxLength: number): string | null => {
    if (isBlank(value)) return null;
    if (typeof value !== 'string') {
      add(field, 'invalid', 'Must be text');
      return null;
    }
    const text = field === 'notes' ? value.trim() : cleanText(value);
    if (text.length > maxLength) add(field, 'too_long', `Must be ${maxLength.toLocaleString('en')} characters or fewer`);
    return text;
  };

  const optionalYear = (field: string, value: unknown): number | null => {
    if (isBlank(value)) return null;
    if (!Number.isInteger(value) || (value as number) < LIMITS.drinkYearMin || (value as number) > LIMITS.drinkYearMax) {
      add(field, 'out_of_range', MESSAGES.drinkYear);
      return null;
    }
    return value as number;
  };

  const lookupId = (field: string, value: unknown, message: string, required: boolean): number | null => {
    if (isBlank(value)) {
      if (required) add(field, 'required', message);
      return null;
    }
    if (!Number.isInteger(value) || (value as number) < 1) {
      add(field, 'invalid', message);
      return null;
    }
    return value as number;
  };

  // BR-1
  const producer = ref('producer', raw.producer, LIMITS.producerNameMax, MESSAGES.producerRequired);
  let name = '';
  if (isBlank(raw.name)) add('name', 'required', MESSAGES.nameRequired);
  else if (typeof raw.name !== 'string') add('name', 'invalid', MESSAGES.nameRequired);
  else {
    name = cleanText(raw.name);
    if (name.length > LIMITS.nameMax) add('name', 'too_long', `Must be ${LIMITS.nameMax} characters or fewer`);
  }

  // BR-2
  const isNonVintage = raw.is_non_vintage === true;
  if (raw.is_non_vintage !== undefined && typeof raw.is_non_vintage !== 'boolean') add('is_non_vintage', 'invalid', 'Must be true or false');
  let vintage: number | null = null;
  if (isNonVintage) {
    if (!isBlank(raw.vintage)) add('vintage', 'conflict', MESSAGES.vintageWithNv);
  } else if (
    !Number.isInteger(raw.vintage) ||
    (raw.vintage as number) < LIMITS.vintageMin ||
    (raw.vintage as number) > ctx.currentYear
  ) {
    add('vintage', isBlank(raw.vintage) ? 'required' : 'out_of_range', MESSAGES.vintage(ctx.currentYear));
  } else {
    vintage = raw.vintage as number;
  }

  const colourId = lookupId('colour_id', raw.colour_id, MESSAGES.colour, true);
  const bottleSizeId = lookupId('bottle_size_id', raw.bottle_size_id, MESSAGES.bottleSize, true);
  const countryId = lookupId('country_id', raw.country_id, MESSAGES.country, false);

  // BR-3 (an edit may set 0: view-edit-wine BR-5)
  let quantity = 0;
  if (!Number.isInteger(raw.quantity) || (raw.quantity as number) < minQuantity || (raw.quantity as number) > LIMITS.quantityMax) {
    add('quantity', isBlank(raw.quantity) ? 'required' : 'out_of_range', MESSAGES.quantity(minQuantity));
  } else {
    quantity = raw.quantity as number;
  }

  const region = ref('region', raw.region, LIMITS.regionNameMax);

  // BR-10
  const grapes: ValidWine['grapes'] = [];
  if (!isBlank(raw.grapes)) {
    if (!Array.isArray(raw.grapes)) add('grapes', 'invalid', 'Must be a list');
    else {
      let total = 0;
      const seen = new Set<string>();
      for (const item of raw.grapes) {
        const grape = ref('grapes', isObject(item) ? item.grape : undefined, LIMITS.grapeNameMax, MESSAGES.notFound);
        if (!grape) continue;
        const key = 'id' in grape ? `id:${grape.id}` : `name:${grape.name.toLowerCase()}`;
        if (seen.has(key)) add('grapes', 'duplicate', MESSAGES.grapeDuplicate);
        seen.add(key);
        const pct = isObject(item) ? item.percentage : undefined;
        let percentage: number | null = null;
        if (!isBlank(pct)) {
          if (!Number.isInteger(pct) || (pct as number) < 1 || (pct as number) > 100) add('grapes', 'out_of_range', MESSAGES.grapePercentage);
          else {
            percentage = pct as number;
            total += percentage;
          }
        }
        grapes.push({ grape, percentage });
      }
      if (total > 100) add('grapes', 'out_of_range', MESSAGES.grapeTotal);
    }
  }

  // BR-5
  let price: number | null = null;
  if (!isBlank(raw.purchase_price)) {
    const p = raw.purchase_price;
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > LIMITS.priceMax || Math.abs(Math.round(p * 100) - p * 100) > 1e-6) {
      add('purchase_price', 'invalid', MESSAGES.price);
    } else {
      price = Math.round(p * 100) / 100;
    }
  }
  let currency: string | null = null;
  if (price !== null || !isBlank(raw.purchase_price)) {
    const c = isBlank(raw.currency) ? DEFAULT_CURRENCY : raw.currency;
    if (typeof c !== 'string' || !/^[A-Za-z]{3}$/.test(c) || !ctx.isCurrency(c.toUpperCase())) add('currency', 'invalid', MESSAGES.currency);
    else currency = c.toUpperCase();
  }
  let purchaseDate: string | null = null;
  if (!isBlank(raw.purchase_date)) {
    const d = raw.purchase_date;
    if (typeof d !== 'string' || !isValidIsoDate(d)) add('purchase_date', 'invalid', MESSAGES.dateInvalid);
    else if (d > ctx.latestDate) add('purchase_date', 'future', MESSAGES.dateFuture);
    else purchaseDate = d;
  }

  // BR-7, BR-8
  const drinkFrom = optionalYear('drink_from', raw.drink_from);
  const drinkUntil = optionalYear('drink_until', raw.drink_until);
  if (drinkFrom !== null && drinkUntil !== null && drinkFrom > drinkUntil) add('drink_from', 'out_of_range', MESSAGES.drinkOrder);
  if (drinkFrom !== null && vintage !== null && drinkFrom < vintage) add('drink_from', 'out_of_range', MESSAGES.drinkBeforeVintage);
  const storageLocation = optionalText('storage_location', raw.storage_location, LIMITS.storageLocationMax);
  const notes = optionalText('notes', raw.notes, LIMITS.notesMax);

  if (errors.length > 0 || !producer || colourId === null || bottleSizeId === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      producer,
      name,
      vintage,
      is_non_vintage: isNonVintage,
      colour_id: colourId,
      bottle_size_id: bottleSizeId,
      quantity,
      country_id: countryId,
      region,
      grapes,
      purchase_price: price,
      currency,
      purchase_date: purchaseDate,
      storage_location: storageLocation,
      drink_from: drinkFrom,
      drink_until: drinkUntil,
      notes,
    },
  };
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Context for "now": purchase dates may be up to the latest calendar date anywhere (UTC+14). */
export function validationContextFor(now: Date, isCurrency: (code: string) => boolean): ValidationContext {
  const latest = new Date(now.getTime() + 14 * 60 * 60 * 1000);
  return { currentYear: now.getUTCFullYear(), latestDate: latest.toISOString().slice(0, 10), isCurrency };
}
