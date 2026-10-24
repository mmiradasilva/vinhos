import { COLLECTION_SORTS, DEFAULT_BOTTLE_ML, DRINK_STATUS_LABELS, SORT_LABELS, type CollectionSort } from '@cellar/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router';
import { api, ApiError, type Colour, type Country, type WineItem, type WinePage } from '../api';
import { collectionCache } from '../collectionCache';

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

type Status = 'loading' | 'ready' | 'error';

export function CollectionPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const q = params.get('q') ?? '';
  const colours = (params.get('colour') ?? '').split(',').filter(Boolean);
  const country = params.get('country') ?? '';
  const sortParam = params.get('sort') ?? 'added_desc';
  const sort: CollectionSort = (COLLECTION_SORTS as readonly string[]).includes(sortParam) ? (sortParam as CollectionSort) : 'added_desc';
  const filtersActive = q.trim().length >= 2 || colours.length > 0 || country !== '';

  const [searchText, setSearchText] = useState(q);
  // Back from a wine (a POP navigation): restore the same list and scroll position (view-collection AC-21).
  const navigationType = useNavigationType();
  const [restored] = useState(() => (navigationType === 'POP' ? collectionCache.get(location.search) : null));
  /** The URL whose results came from the cache; no fetch is needed until the search, filters or sort change. */
  const restoredSearch = useRef(restored ? location.search : null);
  const [page, setPage] = useState<WinePage | null>(restored?.page ?? null);
  const [status, setStatus] = useState<Status>(restored ? 'ready' : 'loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [colourList, setColourList] = useState<Colour[]>([]);
  const [countryList, setCountryList] = useState<Country[]>([]);
  const navState = location.state as { added?: { id: string; label: string }; deleted?: string } | null;
  const added = navState?.added;
  const [highlight, setHighlight] = useState<string | null>(added?.id ?? null);
  const [addedMessage, setAddedMessage] = useState<string | null>(
    added ? `${added.label} added` : navState?.deleted ? `${navState.deleted} deleted` : null,
  );
  const request = useRef(0);

  useEffect(() => {
    if (restored) requestAnimationFrame(() => window.scrollTo(0, restored.scrollY));
  }, [restored]);

  useEffect(() => {
    if (page) collectionCache.set(location.search, page);
  }, [page, location.search]);

  // Clear the one-time "added"/"deleted" state so a reload doesn't show it again (A1: message and highlight fade after a few seconds).
  useEffect(() => {
    if (!added && !navState?.deleted) return;
    navigate(location.pathname + location.search, { replace: true, state: null });
    const timer = setTimeout(() => {
      setHighlight(null);
      setAddedMessage(null);
    }, 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void api<{ items: Colour[] }>('/colours').then((r) => setColourList(r.items));
    void api<{ items: Country[] }>('/countries').then((r) => setCountryList(r.items));
  }, []);

  // The router doesn't queue quick successive updates (e.g. a filter tap while the search delay is pending),
  // so build each change on the latest parameters we asked for, not on the last committed URL.
  const latestParams = useRef(params);
  useEffect(() => {
    latestParams.current = params;
  }, [params]);
  const setParam = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(latestParams.current);
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      latestParams.current = next;
      setParams(next, { replace: true });
    },
    [setParams],
  );

  // Search updates 300 ms after typing stops.
  useEffect(() => {
    if (searchText === q) return;
    const timer = setTimeout(() => setParam({ q: searchText.trim() || null }), 300);
    return () => clearTimeout(timer);
  }, [searchText, q, setParam]);

  const query = useCallback(
    (cursor: string | null) => {
      const s = new URLSearchParams();
      if (q.trim()) s.set('q', q.trim());
      if (colours.length) s.set('colour', colours.join(','));
      if (country) s.set('country', country);
      if (sort !== 'added_desc') s.set('sort', sort);
      if (cursor) s.set('cursor', cursor);
      const qs = s.toString();
      return api<WinePage>(`/collection/wines${qs ? `?${qs}` : ''}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, colours.join(','), country, sort],
  );

  useEffect(() => {
    if (restoredSearch.current === location.search) return;
    restoredSearch.current = null;
    const n = ++request.current;
    setStatus('loading');
    setMoreError(false);
    query(null)
      .then((p) => {
        if (n !== request.current) return;
        setPage(p);
        setStatus('ready');
      })
      .catch((err) => {
        if (n !== request.current) return;
        // view-collection §9: an invalid URL parameter falls back to its default.
        if (err instanceof ApiError && err.status === 400 && err.body?.errors) {
          setParam(Object.fromEntries(err.body.errors.map((e: { field: string }) => [e.field, null])));
          return;
        }
        setStatus('error');
      });
  }, [query, setParam, location.search]);

  const loadMore = useCallback(() => {
    if (!page?.next_cursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(false);
    const n = request.current;
    query(page.next_cursor)
      .then((next) => {
        if (n !== request.current) return;
        setPage((p) => (p ? { ...next, items: [...p.items, ...next.items] } : next));
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 400) {
          request.current++;
          query(null).then(setPage).catch(() => setStatus('error'));
        } else setMoreError(true);
      })
      .finally(() => setLoadingMore(false));
  }, [page, loadingMore, query]);

  // Load the next page automatically near the end of the list (FR-7).
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !page?.next_cursor || moreError) return;
    const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [page, loadMore, moreError]);

  const toggleColour = (code: string) => {
    const next = colours.includes(code) ? colours.filter((c) => c !== code) : [...colours, code];
    setParam({ colour: next.join(',') || null });
  };
  const clearAll = () => {
    setSearchText('');
    setParam({ q: null, colour: null, country: null });
  };

  const totals = page?.totals;
  const isEmptyCollection = status === 'ready' && totals?.all_wines === 0;
  const countryName = countryList.find((c) => c.iso_code === country)?.name ?? country;

  return (
    <section className="collection">
      {addedMessage && (
        <p className="notice notice-success" role="status">
          {addedMessage}
        </p>
      )}

      {isEmptyCollection ? (
        <div className="empty-state">
          <h1>Start your collection</h1>
          <p>Add the wines you own, so you always know what you have and where it is.</p>
          <Link to="/collection/new" className="button primary">
            Add wine
          </Link>
        </div>
      ) : (
        <>
          <h1 className="sr-only">Your collection</h1>
          <p className="totals" aria-live="polite">
            {totals
              ? filtersActive
                ? `${totals.wines.toLocaleString('en')} of ${plural(totals.all_wines, 'wine', 'wines')} · ${plural(totals.bottles, 'bottle', 'bottles')}`
                : `${plural(totals.wines, 'wine', 'wines')} · ${plural(totals.bottles, 'bottle', 'bottles')}`
              : ' '}
          </p>

          <div className="toolbar">
            <label className="sr-only" htmlFor="search">
              Search
            </label>
            <input
              id="search"
              type="search"
              className="search"
              placeholder="Search producer, wine, region, grape"
              value={searchText}
              maxLength={100}
              onChange={(e) => setSearchText(e.target.value)}
            />
            <div className="toolbar-row">
              <button type="button" aria-expanded={filtersOpen} aria-controls="filters" onClick={() => setFiltersOpen((o) => !o)}>
                Filters{colours.length + (country ? 1 : 0) > 0 ? ` (${colours.length + (country ? 1 : 0)})` : ''}
              </button>
              <label className="sr-only" htmlFor="sort">
                Sort
              </label>
              <select id="sort" value={sort} onChange={(e) => setParam({ sort: e.target.value === 'added_desc' ? null : e.target.value })}>
                {COLLECTION_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filtersOpen && (
            <div id="filters" className="filters-panel" role="group" aria-label="Filters">
              <fieldset>
                <legend>Colour</legend>
                <div className="checkbox-grid">
                  {colourList.map((c) => (
                    <label key={c.code} className="checkbox">
                      <input type="checkbox" checked={colours.includes(c.code)} onChange={() => toggleColour(c.code)} /> {c.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="field">
                <label htmlFor="country-filter">Country</label>
                <select id="country-filter" value={country} onChange={(e) => setParam({ country: e.target.value || null })}>
                  <option value="">Any country</option>
                  {countryList.map((c) => (
                    <option key={c.iso_code} value={c.iso_code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="primary" onClick={() => setFiltersOpen(false)}>
                Done
              </button>
            </div>
          )}

          {(colours.length > 0 || country) && (
            <ul className="chips" aria-label="Active filters">
              {colours.map((code) => {
                const name = colourList.find((c) => c.code === code)?.name ?? code;
                return (
                  <li key={code}>
                    <button type="button" className="chip" aria-label={`Remove filter ${name}`} onClick={() => toggleColour(code)}>
                      {name} ×
                    </button>
                  </li>
                );
              })}
              {country && (
                <li>
                  <button type="button" className="chip" aria-label={`Remove filter ${countryName}`} onClick={() => setParam({ country: null })}>
                    {countryName} ×
                  </button>
                </li>
              )}
            </ul>
          )}

          {status === 'error' && (
            <p className="notice notice-error" role="alert">
              Couldn't load your wines.{' '}
              <button type="button" className="link-button" onClick={() => setParam({})}>
                Retry
              </button>
            </p>
          )}

          {status === 'loading' && !page && <PlaceholderRows />}

          {page && page.items.length === 0 && status === 'ready' && (
            <div className="empty-state">
              <p>No wines match</p>
              <button type="button" onClick={clearAll}>
                Clear search and filters
              </button>
            </div>
          )}

          {page && page.items.length > 0 && (
            <ul className={`wine-list${status === 'loading' ? ' is-refreshing' : ''}`}>
              {page.items.map((w) => (
                <WineRow key={w.id} wine={w} highlight={w.id === highlight} />
              ))}
            </ul>
          )}

          <div ref={sentinel} />
          {page?.next_cursor && (
            <div className="load-more">
              {moreError && <p role="alert">Couldn't load more wines.</p>}
              <button type="button" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : moreError ? 'Retry' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}

      {!isEmptyCollection && (
        <div className="bottom-bar">
          <Link to="/collection/new" className="button primary">
            Add wine
          </Link>
        </div>
      )}
    </section>
  );
}

function WineRow({ wine, highlight }: { wine: WineItem; highlight: boolean }) {
  const vintage = wine.is_non_vintage ? 'NV' : String(wine.vintage);
  const place = wine.region?.name ?? wine.country?.name;
  const bottle = wine.bottle_size.volume_ml !== DEFAULT_BOTTLE_ML ? `${wine.bottle_size.volume_ml} ml` : null;
  const status = wine.drink_status !== 'unknown' ? DRINK_STATUS_LABELS[wine.drink_status] : null;
  const details = [vintage, wine.colour.name, place, bottle].filter(Boolean).join(' · ');
  // The link's accessible name is its visible text (WCAG 2.5.3), so every part is real text, read in order.
  return (
    <li className={`wine-row${highlight ? ' highlight' : ''}`}>
      <Link
        to={`/collection/wines/${wine.id}`}
        state={{ fromCollection: true }}
        className="wine-link"
        onClick={() => collectionCache.saveScroll(window.scrollY)}
      >
        <div className="wine-main">
          <p className="wine-title">
            {wine.producer.name} {wine.name}
          </p>
          <p className="wine-details">{details}</p>
        </div>
        <div className="wine-side">
          <span className="qty">{plural(wine.quantity, 'bottle', 'bottles')}</span>
          {status && <span className={`badge badge-${wine.drink_status}`}>{status}</span>}
        </div>
      </Link>
    </li>
  );
}

function PlaceholderRows() {
  return (
    <ul className="wine-list" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="wine-row placeholder">
          <div className="wine-main">
            <p className="ph ph-long" />
            <p className="ph ph-short" />
          </div>
        </li>
      ))}
    </ul>
  );
}
