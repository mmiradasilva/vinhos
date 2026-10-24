import {
  DEFAULT_BOTTLE_ML,
  DEFAULT_CURRENCY,
  validateWineInput,
  validationContextFor,
  type FieldError,
  type Ref,
  type WineInput,
} from '@cellar/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router';
import {
  api,
  ApiError,
  NetworkError,
  signInUrl,
  wineLabel,
  type BottleSize,
  type Colour,
  type Country,
  type Named,
  type RegionOption,
  type WineDetail,
} from '../api';
import { Autocomplete, type Choice, type Option } from '../components/Autocomplete';
import { flash } from '../flash';
import { clearDraft, peekDraft, saveDraft } from './addWineDraft';

interface Draft {
  producer: Choice | null;
  producerText: string;
  name: string;
  vintage: string;
  nv: boolean;
  colourId: string;
  bottleSizeId: string;
  quantity: string;
  countryId: string;
  region: (Choice & { countryId?: number }) | null;
  regionText: string;
  grapes: { grape: Choice; percentage: string }[];
  grapeText: string;
  price: string;
  currency: string;
  purchaseDate: string;
  storage: string;
  drinkFrom: string;
  drinkUntil: string;
  notes: string;
}

const EMPTY: Draft = {
  producer: null, producerText: '', name: '', vintage: '', nv: false, colourId: '', bottleSizeId: '', quantity: '1',
  countryId: '', region: null, regionText: '', grapes: [], grapeText: '', price: '', currency: DEFAULT_CURRENCY,
  purchaseDate: '', storage: '', drinkFrom: '', drinkUntil: '', notes: '',
};

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : String(v));

/** A saved wine as form values (view-edit-wine US-4). */
function fromWine(w: WineDetail): Draft {
  return {
    producer: { id: w.producer.id, name: w.producer.name },
    producerText: w.producer.name,
    name: w.name,
    vintage: str(w.vintage),
    nv: w.is_non_vintage,
    colourId: str(w.colour.id),
    bottleSizeId: str(w.bottle_size.id),
    quantity: str(w.quantity),
    countryId: str(w.country?.id),
    region: w.region ? { id: w.region.id, name: w.region.name, countryId: w.country?.id } : null,
    regionText: w.region?.name ?? '',
    grapes: w.grapes.map((g) => ({ grape: { id: g.grape.id, name: g.grape.name }, percentage: str(g.percentage) })),
    grapeText: '',
    price: str(w.purchase_price),
    currency: w.currency ?? DEFAULT_CURRENCY,
    purchaseDate: w.purchase_date ?? '',
    storage: w.storage_location ?? '',
    drinkFrom: str(w.drink_from),
    drinkUntil: str(w.drink_until),
    notes: w.notes ?? '',
  };
}

/** API field -> input id, in form order (used for the error summary and focus). */
const FIELD_INPUT: Record<string, string> = {
  producer: 'f-producer', name: 'f-name', vintage: 'f-vintage', is_non_vintage: 'f-vintage', colour_id: 'f-colour',
  bottle_size_id: 'f-bottle', quantity: 'f-quantity', country_id: 'f-country', region: 'f-region', grapes: 'f-grapes',
  purchase_price: 'f-price', currency: 'f-currency', purchase_date: 'f-date', storage_location: 'f-storage',
  drink_from: 'f-drink-from', drink_until: 'f-drink-until', notes: 'f-notes',
};
const OPTIONAL = new Set(['country_id', 'region', 'grapes', 'purchase_price', 'currency', 'purchase_date', 'storage_location', 'drink_from', 'drink_until', 'notes']);

const hasOptionalValues = (d: Draft) =>
  !!(d.countryId || d.region || d.regionText || d.grapes.length || d.price || d.purchaseDate || d.storage || d.drinkFrom || d.drinkUntil || d.notes);

const CURRENCIES = Intl.supportedValuesOf('currency');
const currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' });
const isCurrency = (c: string) => CURRENCIES.includes(c);

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s.trim().replace(',', '.')));
const toRef = (c: Choice | null, text: string): Ref | null => (c?.id ? { id: c.id } : text.trim() ? { name: text } : null);

function toInput(d: Draft): WineInput {
  return {
    producer: toRef(d.producer, d.producerText) ?? { name: '' },
    name: d.name,
    vintage: d.nv ? null : num(d.vintage),
    is_non_vintage: d.nv,
    colour_id: num(d.colourId) as number,
    bottle_size_id: num(d.bottleSizeId) as number,
    quantity: num(d.quantity) as number,
    country_id: num(d.countryId),
    region: toRef(d.region, d.regionText),
    grapes: d.grapes.map((g) => ({ grape: g.grape.id ? { id: g.grape.id } : { name: g.grape.name }, percentage: num(g.percentage) })),
    purchase_price: num(d.price),
    currency: d.price.trim() ? d.currency : null,
    purchase_date: d.purchaseDate || null,
    storage_location: d.storage || null,
    drink_from: num(d.drinkFrom),
    drink_until: num(d.drinkUntil),
    notes: d.notes || null,
  };
}

const firstErrors = (errors: FieldError[]) => {
  const out: Record<string, string> = {};
  for (const e of errors) {
    const key = e.field === 'is_non_vintage' ? 'vintage' : e.field;
    out[key] ??= e.message;
  }
  return out;
};

export function AddWinePage() {
  return <WineForm mode="add" initial={EMPTY} />;
}

/** view-edit-wine §8: the add form, prefilled. */
export function EditWinePage() {
  const { id = '' } = useParams();
  const [wine, setWine] = useState<WineDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api<WineDetail>(`/collection/wines/${id}`)
      .then(setWine)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
      });
  }, [id]);

  if (missing) return <NotInCollection />;
  if (!wine) return <p className="page-status">Loading…</p>;
  return <WineForm key={wine.id} mode="edit" initial={fromWine(wine)} wineId={wine.id} version={wine.version} />;
}

export function NotInCollection() {
  return (
    <section className="narrow">
      <h1>This wine isn't in your collection</h1>
      <p>
        <Link to="/collection">Back to collection</Link>
      </p>
    </section>
  );
}

interface SavedDraft {
  draft: Draft;
  version?: number;
}

function WineForm({ mode, initial, wineId, version: initialVersion }: { mode: 'add' | 'edit'; initial: Draft; wineId?: string; version?: number }) {
  const navigate = useNavigate();
  const location = useLocation();
  const draftKey = location.pathname;
  const editing = mode === 'edit';
  const [colours, setColours] = useState<Colour[]>([]);
  const [bottles, setBottles] = useState<BottleSize[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [restored] = useState(() => peekDraft<SavedDraft>(draftKey));
  const [draft, setDraft] = useState<Draft>(restored?.draft ?? initial);
  const [version, setVersion] = useState(restored?.version ?? initialVersion);
  const [dirty, setDirty] = useState(restored !== null);
  const [moreOpen, setMoreOpen] = useState(() => editing && hasOptionalValues(restored?.draft ?? initial));
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<{ id?: string; quantity: number } | null>(null);
  const [formError, setFormError] = useState<ReactNode>(null);
  const [saving, setSaving] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const leavingAfterSave = useRef(false);
  const cancelTo = editing ? `/collection/wines/${wineId}` : '/collection';
  // Opened from the detail page: return there with history.back(), so its "Back to collection" still works.
  const fromDetail = (location.state as { fromDetail?: boolean } | null)?.fromDetail === true;
  const leave = (message?: string) => {
    if (editing && fromDetail) {
      if (message) flash.set(`wine:${wineId}`, message);
      navigate(-1);
    } else if (editing) navigate(cancelTo, { replace: true, state: message ? { message } : undefined });
    else navigate(cancelTo);
  };

  useEffect(() => {
    clearDraft(draftKey);
    void api<{ items: Colour[] }>('/colours').then((r) => setColours(r.items));
    void api<{ items: Country[] }>('/countries').then((r) => setCountries(r.items));
    void api<{ items: BottleSize[] }>('/bottle-sizes').then((r) => {
      setBottles(r.items);
      const standard = r.items.find((b) => b.volume_ml === DEFAULT_BOTTLE_ML);
      if (standard) setDraft((d) => (d.bottleSizeId ? d : { ...d, bottleSizeId: String(standard.id) }));
    });
  }, [draftKey]);

  // Unsaved changes: confirm before leaving (add-wine US-3, view-edit-wine FR-11).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leavingAfterSave.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(editing ? 'Discard your changes?' : 'Discard this wine? Your entries will be lost.')) blocker.proceed();
    else blocker.reset();
  }, [blocker, editing]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const update = (patch: Partial<Draft>, fields: string[] = []) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setDuplicate(null);
    idempotencyKey.current = crypto.randomUUID();
    if (fields.length) {
      setServerErrors((errs) => {
        const next = { ...errs };
        for (const f of fields) delete next[f];
        return next;
      });
    }
  };
  const touch = (field: string) => setTouched((t) => new Set(t).add(field));

  const clientErrors = useMemo(() => {
    const r = validateWineInput(toInput(draft), validationContextFor(new Date(), isCurrency), { minQuantity: editing ? 0 : 1 });
    return r.ok ? {} : firstErrors(r.errors);
  }, [draft, editing]);
  const errorFor = (field: string): string | undefined => serverErrors[field] ?? (submitted || touched.has(field) ? clientErrors[field] : undefined);

  const shownErrors = Object.keys(FIELD_INPUT)
    .filter((f) => f !== 'is_non_vintage')
    .map((f) => [f, errorFor(f)] as const)
    .filter((e): e is readonly [string, string] => !!e[1]);

  const focusFirst = (fields: string[]) => {
    const first = Object.keys(FIELD_INPUT).find((f) => fields.includes(f));
    if (first) requestAnimationFrame(() => document.getElementById(FIELD_INPUT[first])?.focus());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    setDuplicate(null);
    const invalid = Object.keys(clientErrors);
    if (invalid.length) {
      if (invalid.some((f) => OPTIONAL.has(f))) setMoreOpen(true);
      focusFirst(invalid);
      return;
    }
    setSaving(true);
    try {
      const saved = await api<WineDetail>(editing ? `/collection/wines/${wineId}` : '/collection/wines', {
        method: editing ? 'PUT' : 'POST',
        body: editing ? { ...toInput(draft), version } : toInput(draft),
        headers: { 'Idempotency-Key': idempotencyKey.current },
        handle401: false,
      });
      leavingAfterSave.current = true;
      if (editing) leave('Changes saved');
      else navigate('/collection', { state: { added: { id: saved.id, label: wineLabel(saved) } } });
    } catch (err) {
      setSaving(false);
      if (err instanceof NetworkError) setFormError(editing ? "You're offline. Your changes weren't saved." : "You're offline. Your wine wasn't saved.");
      else if (err instanceof ApiError) {
        if (err.status === 400 && err.body?.errors) {
          const errs = firstErrors(err.body.errors);
          setServerErrors(errs);
          if (Object.keys(errs).some((f) => OPTIONAL.has(f))) setMoreOpen(true);
          focusFirst(Object.keys(errs));
        } else if (err.status === 409 && err.body?.code === 'version_conflict') {
          // view-edit-wine US-6: show the latest values instead of overwriting them.
          const current = err.body.current as WineDetail;
          setDraft(fromWine(current));
          setVersion(current.version);
          setDirty(false);
          setServerErrors({});
          setFormError('This wine was changed on another device. Review the latest version and save again.');
        } else if (err.status === 409) {
          setDuplicate({ id: err.body?.existing_id, quantity: err.body?.existing_quantity ?? 0 });
        } else if (err.status === 401) {
          // add-wine FR-13: keep the draft across the sign-in redirect.
          saveDraft(draftKey, { draft, version } satisfies SavedDraft);
          leavingAfterSave.current = true;
          window.location.assign(signInUrl(draftKey));
        } else if (err.status === 404 && editing) {
          setFormError(
            <>
              This wine was deleted. <Link to="/collection">Back to collection</Link>
            </>,
          );
        } else if (err.status === 422) setFormError('Your collection has reached 10,000 wines.');
        else if (err.status === 429) setFormError('Too many requests. Wait a moment and try again.');
        else if (err.status === 403) setFormError('Your session changed. Reload the page and try again.');
        else setFormError(editing ? "Couldn't save your changes. Try again." : "Couldn't save your wine. Try again.");
      }
    }
  };

  const fetchProducers = useCallback((q: string) => api<{ items: Named[] }>(`/producers?q=${encodeURIComponent(q)}`).then((r) => r.items), []);
  const fetchGrapes = useCallback(
    (q: string) =>
      api<{ items: Named[] }>(`/grapes?q=${encodeURIComponent(q)}`).then((r) =>
        r.items.filter((g) => !draft.grapes.some((x) => x.grape.id === g.id)),
      ),
    [draft.grapes],
  );
  const selectedCountry = countries.find((c) => String(c.id) === draft.countryId);
  const fetchRegions = useCallback(
    (q: string): Promise<Option<RegionOption>[]> => {
      const country = selectedCountry ? `&country=${selectedCountry.iso_code}` : '';
      return api<{ items: RegionOption[] }>(`/regions?q=${encodeURIComponent(q)}${country}`).then((r) =>
        r.items.map((reg) => ({ id: reg.id, name: reg.name, hint: selectedCountry ? undefined : reg.country.name, meta: reg })),
      );
    },
    [selectedCountry],
  );

  const addGrape = (choice: Choice) => {
    const name = choice.name.trim();
    if (!name) return;
    if (draft.grapes.some((g) => (choice.id ? g.grape.id === choice.id : g.grape.name.toLowerCase() === name.toLowerCase()))) {
      update({ grapeText: '' });
      return;
    }
    update({ grapes: [...draft.grapes, { grape: { ...choice, name }, percentage: '' }], grapeText: '' }, ['grapes']);
  };

  return (
    <section className="form-page">
      <h1>{editing ? 'Edit wine' : 'Add wine'}</h1>
      <form onSubmit={submit} noValidate>
        {formError && (
          <p className="notice notice-error" role="alert">
            {formError}
          </p>
        )}
        {duplicate && (
          <p className="notice notice-warning" role="alert">
            You already have this wine ({duplicate.quantity} {duplicate.quantity === 1 ? 'bottle' : 'bottles'}).
            {duplicate.id && (
              <>
                {' '}
                <Link to={`/collection/wines/${duplicate.id}`}>View wine</Link>
              </>
            )}
          </p>
        )}
        {submitted && shownErrors.length > 0 && (
          <div className="error-summary" role="alert" aria-labelledby="error-summary-title">
            <p id="error-summary-title">
              <strong>Fix {shownErrors.length === 1 ? 'this' : `these ${shownErrors.length}`} to save the wine:</strong>
            </p>
            <ul>
              {shownErrors.map(([field, message]) => (
                <li key={field}>
                  <a
                    href={`#${FIELD_INPUT[field]}`}
                    onClick={(e) => {
                      e.preventDefault();
                      if (OPTIONAL.has(field)) setMoreOpen(true);
                      requestAnimationFrame(() => document.getElementById(FIELD_INPUT[field])?.focus());
                    }}
                  >
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field id="f-producer" label="Producer" required error={errorFor('producer')}>
          {(described) => (
            <Autocomplete
              id="f-producer"
              text={draft.producerText}
              onTextChange={(text) => update({ producerText: text, producer: null }, ['producer'])}
              onSelect={(c) => update({ producer: c.id ? c : null, producerText: c.name }, ['producer'])}
              fetchOptions={fetchProducers}
              placeholder="Quinta do Crasto"
              invalid={!!errorFor('producer')}
              describedBy={described}
              onBlur={() => touch('producer')}
            />
          )}
        </Field>

        <Field id="f-name" label="Wine name" required error={errorFor('name')}>
          {(described) => (
            <input
              id="f-name"
              type="text"
              value={draft.name}
              placeholder="Reserva"
              maxLength={200}
              aria-invalid={!!errorFor('name') || undefined}
              aria-describedby={described}
              onChange={(e) => update({ name: e.target.value }, ['name'])}
              onBlur={() => touch('name')}
            />
          )}
        </Field>

        <Field id="f-vintage" label="Vintage" required error={errorFor('vintage')}>
          {(described) => (
            <div className="inline">
              <input
                id="f-vintage"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="short"
                value={draft.nv ? '' : draft.vintage}
                disabled={draft.nv}
                placeholder="2017"
                aria-invalid={!!errorFor('vintage') || undefined}
                aria-describedby={described}
                onChange={(e) => update({ vintage: e.target.value }, ['vintage'])}
                onBlur={() => touch('vintage')}
              />
              <label className="checkbox">
                <input type="checkbox" checked={draft.nv} onChange={(e) => update({ nv: e.target.checked, vintage: '' }, ['vintage'])} /> NV (non-vintage)
              </label>
            </div>
          )}
        </Field>

        <div className="row-2">
          <Field id="f-colour" label="Colour" required error={errorFor('colour_id')}>
            {(described) => (
              <select
                id="f-colour"
                value={draft.colourId}
                aria-invalid={!!errorFor('colour_id') || undefined}
                aria-describedby={described}
                onChange={(e) => update({ colourId: e.target.value }, ['colour_id'])}
                onBlur={() => touch('colour_id')}
              >
                <option value="">Choose…</option>
                {colours.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id="f-bottle" label="Bottle size" required error={errorFor('bottle_size_id')}>
            {(described) => (
              <select id="f-bottle" value={draft.bottleSizeId} aria-describedby={described} onChange={(e) => update({ bottleSizeId: e.target.value }, ['bottle_size_id'])}>
                {bottles.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.volume_ml} ml{b.name !== `${b.volume_ml / 10} cl` ? ` · ${b.name}` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <Field id="f-quantity" label="Quantity (bottles)" required error={errorFor('quantity')}>
          {(described) => (
            <input
              id="f-quantity"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="short"
              value={draft.quantity}
              aria-invalid={!!errorFor('quantity') || undefined}
              aria-describedby={described}
              onChange={(e) => update({ quantity: e.target.value }, ['quantity'])}
              onBlur={() => touch('quantity')}
            />
          )}
        </Field>

        <button type="button" className="disclosure" aria-expanded={moreOpen} aria-controls="more-details" onClick={() => setMoreOpen((o) => !o)}>
          {moreOpen ? '▾' : '▸'} More details
        </button>

        <div id="more-details" hidden={!moreOpen}>
          <Field id="f-country" label="Country" error={errorFor('country_id')}>
            {(described) => (
              <select
                id="f-country"
                value={draft.countryId}
                aria-describedby={described}
                onChange={(e) => {
                  const regionFits = !draft.region?.id || draft.region.countryId === Number(e.target.value);
                  update({ countryId: e.target.value, ...(regionFits ? {} : { region: null, regionText: '' }) }, ['country_id', 'region']);
                }}
              >
                <option value="">Not set</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field id="f-region" label="Region" error={errorFor('region')} hint={selectedCountry ? undefined : 'Choose a country first to add a new region.'}>
            {(described) => (
              <Autocomplete<RegionOption>
                id="f-region"
                text={draft.regionText}
                onTextChange={(text) => update({ regionText: text, region: null }, ['region'])}
                onSelect={(c, option) => {
                  const country = option?.meta?.country;
                  update(
                    {
                      region: c.id ? { ...c, countryId: country?.id } : null,
                      regionText: c.name,
                      ...(country && !draft.countryId ? { countryId: String(country.id) } : {}),
                    },
                    ['region', 'country_id'],
                  );
                }}
                fetchOptions={fetchRegions}
                placeholder="Douro"
                invalid={!!errorFor('region')}
                describedBy={described}
              />
            )}
          </Field>

          <Field id="f-grapes" label="Grapes" error={errorFor('grapes')}>
            {(described) => (
              <>
                {draft.grapes.length > 0 && (
                  <ul className="grape-list">
                    {draft.grapes.map((g, i) => (
                      <li key={g.grape.id ?? g.grape.name}>
                        <span>{g.grape.name}</span>
                        <label className="sr-only" htmlFor={`f-grape-pct-${i}`}>
                          Percentage of {g.grape.name}
                        </label>
                        <input
                          id={`f-grape-pct-${i}`}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          className="pct"
                          placeholder="%"
                          value={g.percentage}
                          onChange={(e) =>
                            update({ grapes: draft.grapes.map((x, j) => (j === i ? { ...x, percentage: e.target.value } : x)) }, ['grapes'])
                          }
                        />
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Remove ${g.grape.name}`}
                          onClick={() => update({ grapes: draft.grapes.filter((_, j) => j !== i) }, ['grapes'])}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <Autocomplete
                  id="f-grapes"
                  text={draft.grapeText}
                  onTextChange={(text) => setDraft((d) => ({ ...d, grapeText: text }))}
                  onSelect={addGrape}
                  fetchOptions={fetchGrapes}
                  placeholder="Add a grape, e.g. Touriga Nacional"
                  invalid={!!errorFor('grapes')}
                  describedBy={described}
                />
              </>
            )}
          </Field>

          <div className="row-2">
            <Field id="f-price" label="Price per bottle" error={errorFor('purchase_price')}>
              {(described) => (
                <input
                  id="f-price"
                  type="text"
                  inputMode="decimal"
                  value={draft.price}
                  placeholder="24.50"
                  aria-invalid={!!errorFor('purchase_price') || undefined}
                  aria-describedby={described}
                  onChange={(e) => update({ price: e.target.value }, ['purchase_price'])}
                  onBlur={() => touch('purchase_price')}
                />
              )}
            </Field>
            <Field id="f-currency" label="Currency" error={errorFor('currency')}>
              {(described) => (
                <select id="f-currency" value={draft.currency} aria-describedby={described} onChange={(e) => update({ currency: e.target.value }, ['currency'])}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c} · {currencyNames.of(c)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <Field id="f-date" label="Purchase date" error={errorFor('purchase_date')}>
            {(described) => (
              <input
                id="f-date"
                type="date"
                value={draft.purchaseDate}
                aria-invalid={!!errorFor('purchase_date') || undefined}
                aria-describedby={described}
                onChange={(e) => update({ purchaseDate: e.target.value }, ['purchase_date'])}
                onBlur={() => touch('purchase_date')}
              />
            )}
          </Field>

          <Field id="f-storage" label="Storage location" error={errorFor('storage_location')}>
            {(described) => (
              <input
                id="f-storage"
                type="text"
                maxLength={100}
                value={draft.storage}
                placeholder="Rack B, shelf 2"
                aria-describedby={described}
                onChange={(e) => update({ storage: e.target.value }, ['storage_location'])}
              />
            )}
          </Field>

          <div className="row-2">
            <Field id="f-drink-from" label="Drink from (year)" error={errorFor('drink_from')}>
              {(described) => (
                <input
                  id="f-drink-from"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={draft.drinkFrom}
                  placeholder="2024"
                  aria-invalid={!!errorFor('drink_from') || undefined}
                  aria-describedby={described}
                  onChange={(e) => update({ drinkFrom: e.target.value }, ['drink_from'])}
                  onBlur={() => touch('drink_from')}
                />
              )}
            </Field>
            <Field id="f-drink-until" label="Drink until (year)" error={errorFor('drink_until')}>
              {(described) => (
                <input
                  id="f-drink-until"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={draft.drinkUntil}
                  placeholder="2032"
                  aria-invalid={!!errorFor('drink_until') || undefined}
                  aria-describedby={described}
                  onChange={(e) => update({ drinkUntil: e.target.value }, ['drink_until'])}
                  onBlur={() => touch('drink_until')}
                />
              )}
            </Field>
          </div>

          <Field id="f-notes" label="Notes" error={errorFor('notes')}>
            {(described) => (
              <textarea id="f-notes" rows={3} maxLength={2000} value={draft.notes} aria-describedby={described} onChange={(e) => update({ notes: e.target.value }, ['notes'])} />
            )}
          </Field>
        </div>

        <div className="bottom-bar">
          <a
            href={cancelTo}
            className="button secondary"
            onClick={(e) => {
              e.preventDefault();
              leave();
            }}
          >
            Cancel
          </a>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save wine'}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({ id, label, required, error, hint, children }: { id: string; label: string; required?: boolean; error?: string; hint?: string; children: (describedBy: string | undefined) => ReactNode }) {
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required ? <span className="required"> (required)</span> : null}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {children(described)}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
