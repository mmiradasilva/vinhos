import { DEFAULT_BOTTLE_ML, DRINK_STATUS_LABELS, LIMITS } from '@cellar/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError, NetworkError, wineLabel, type WineDetail } from '../api';
import { collectionCache } from '../collectionCache';
import { flash } from '../flash';
import { NotInCollection } from './WineForm';

const UNDO_MS = 5000;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

interface Message {
  text: string;
  undo?: boolean;
}

/** view-edit-wine §8: the wine detail page. */
export function WineDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const fromCollection = (location.state as { fromCollection?: boolean } | null)?.fromCollection === true;
  const [wine, setWine] = useState<WineDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState<Message | null>(() => {
    const text = (location.state as { message?: string } | null)?.message ?? flash.peek(`wine:${id}`);
    return text ? { text } : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addCount, setAddCount] = useState('1');
  const [addError, setAddError] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const openDeleteDialog = () => {
    dialog.current?.showModal();
    cancelDelete.current?.focus(); // the safe choice gets focus
  };

  const show = useCallback((w: WineDetail) => {
    setWine(w);
    collectionCache.updateWine(w);
  }, []);

  useEffect(() => {
    flash.clear(`wine:${id}`);
    api<WineDetail>(`/collection/wines/${id}`)
      .then(show)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setError("Couldn't load this wine. Reload the page to try again.");
      });
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, [id, show]);

  const backToCollection = () => {
    // Coming from the list: go back in history, so the list restores its search, filters and scroll (FR-10).
    if (fromCollection) navigate(-1);
    else navigate('/collection');
  };

  /** Relative quantity change: "Opened one" (-1), Undo (+1), "Add bottles" (+N). */
  const changeQuantity = async (change: number, success: Message): Promise<boolean> => {
    if (!wine) return false;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ quantity: number; version: number }>(`/collection/wines/${id}/quantity`, {
        method: 'POST',
        body: { change },
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      show({ ...wine, quantity: r.quantity, version: r.version });
      setMessage(success);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (success.undo) undoTimer.current = setTimeout(() => setMessage((m) => (m?.undo ? { text: m.text } : m)), UNDO_MS);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        show({ ...wine, quantity: err.body?.quantity ?? wine.quantity });
        setError(change < 0 ? 'There are no bottles left to open.' : `A wine can have at most ${LIMITS.quantityMax.toLocaleString('en')} bottles.`);
      } else if (err instanceof ApiError && err.status === 404) setMissing(true);
      else if (err instanceof NetworkError) setError(change < 0 ? "You're offline. The bottle wasn't counted." : "You're offline. The bottles weren't added.");
      else if (err instanceof ApiError && err.status === 429) setError('Too many requests. Wait a moment and try again.');
      else if (!(err instanceof ApiError && err.status === 401)) setError("Couldn't update the quantity. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openedOne = () => void changeQuantity(-1, { text: '1 bottle opened', undo: true });
  const undo = () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    void changeQuantity(1, { text: 'Undone: 1 bottle added back' });
  };

  const submitAdd = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(addCount);
    const max = LIMITS.quantityMax - (wine?.quantity ?? 0);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      setAddError(max < 1 ? 'This wine already has the maximum number of bottles.' : `Enter a whole number from 1 to ${max.toLocaleString('en')}`);
      return;
    }
    if (await changeQuantity(n, { text: `${plural(n, 'bottle', 'bottles')} added` })) {
      setAdding(false);
      setAddCount('1');
      setAddError(null);
    }
  };

  const confirmDelete = async () => {
    if (!wine) return;
    setBusy(true);
    try {
      await api(`/collection/wines/${id}`, { method: 'DELETE' });
    } catch (err) {
      // A second tap, or deleted elsewhere: already gone, which is what was wanted.
      if (!(err instanceof ApiError && err.status === 404)) {
        setBusy(false);
        dialog.current?.close();
        setError(err instanceof NetworkError ? "You're offline. The wine wasn't deleted." : "Couldn't delete the wine. Try again.");
        return;
      }
    }
    collectionCache.removeWine(wine.id);
    navigate('/collection', { replace: true, state: { deleted: wineLabel(wine) } });
  };

  if (missing) return <NotInCollection />;
  if (!wine) return error ? <p className="notice notice-error">{error}</p> : <p className="page-status">Loading…</p>;

  const vintage = wine.is_non_vintage ? 'NV' : String(wine.vintage);
  const status = wine.drink_status !== 'unknown' ? DRINK_STATUS_LABELS[wine.drink_status] : null;
  const place = [wine.region?.name, wine.country?.name].filter(Boolean).join(', ');
  const drinkWindow =
    wine.drink_from && wine.drink_until ? `${wine.drink_from}–${wine.drink_until}` : wine.drink_from ? `From ${wine.drink_from}` : wine.drink_until ? `Until ${wine.drink_until}` : null;
  const price =
    wine.purchase_price !== null && wine.currency
      ? `${new Intl.NumberFormat('en', { style: 'currency', currency: wine.currency }).format(wine.purchase_price)} per bottle`
      : null;
  const details: [string, string | null][] = [
    ['Bottle size', wine.bottle_size.volume_ml !== DEFAULT_BOTTLE_ML ? `${wine.bottle_size.volume_ml} ml · ${wine.bottle_size.name}` : '750 ml'],
    ['Region', place || null],
    ['Grapes', wine.grapes.length ? wine.grapes.map((g) => (g.percentage ? `${g.grape.name} ${g.percentage}%` : g.grape.name)).join(', ') : null],
    ['Price', price],
    ['Purchased', wine.purchase_date ? new Date(`${wine.purchase_date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null],
    ['Stored at', wine.storage_location],
    ['Drink', drinkWindow ? `${drinkWindow}${status ? ` · ${status}` : ''}` : null],
    ['Notes', wine.notes],
    ['Added', new Date(wine.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })],
  ];

  return (
    <section className="wine-detail">
      <p>
        <a
          href="/collection"
          onClick={(e) => {
            e.preventDefault();
            backToCollection();
          }}
        >
          ← Back to collection
        </a>
      </p>
      <h1>
        {wine.producer.name} {wine.name}
      </h1>
      <p className="muted">
        {vintage} · {wine.colour.name}
      </p>

      <div role="status" className="status-region">
        {message && (
          <p className="notice notice-success">
            {message.text}
            {message.undo && (
              <>
                {' '}
                <button type="button" className="link-button" onClick={undo} disabled={busy}>
                  Undo
                </button>
              </>
            )}
          </p>
        )}
      </div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      <div className="quantity-block">
        <p className="quantity">{wine.quantity > 0 ? plural(wine.quantity, 'bottle', 'bottles') : 'No bottles left'}</p>
        <div className="actions">
          {wine.quantity > 0 && (
            <button type="button" className="primary" onClick={openedOne} disabled={busy} aria-label="Opened one bottle">
              Opened one
            </button>
          )}
          <button type="button" aria-expanded={adding} aria-controls="add-bottles" onClick={() => setAdding((a) => !a)}>
            Add bottles
          </button>
        </div>
        {adding && (
          <form id="add-bottles" className="add-bottles" onSubmit={submitAdd} noValidate>
            <label htmlFor="add-count">Bottles to add</label>
            <div className="inline">
              <input
                id="add-count"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="short"
                value={addCount}
                aria-invalid={addError ? true : undefined}
                aria-describedby={addError ? 'add-count-error' : undefined}
                onChange={(e) => {
                  setAddCount(e.target.value);
                  setAddError(null);
                }}
                autoFocus
              />
              <button type="submit" disabled={busy}>
                Add
              </button>
              <button type="button" className="link-button" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
            {addError && (
              <p id="add-count-error" className="field-error">
                {addError}
              </p>
            )}
          </form>
        )}
      </div>

      <dl className="details">
        {details
          .filter((d): d is [string, string] => !!d[1])
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      <div className="actions">
        <Link to={`/collection/wines/${wine.id}/edit`} state={{ fromDetail: true }} className="button secondary">
          Edit
        </Link>
      </div>
      <p>
        <button ref={deleteButton} type="button" className="link-button danger" onClick={openDeleteDialog}>
          Delete wine
        </button>
      </p>

      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby="delete-title"
        aria-describedby="delete-desc"
        onClose={() => deleteButton.current?.focus()}
      >
        <h2 id="delete-title">Delete {wineLabel(wine)}?</h2>
        <p id="delete-desc">This can't be undone.</p>
        <div className="actions">
          <button type="button" className="danger-button" onClick={() => void confirmDelete()} disabled={busy}>
            Delete
          </button>
          <button ref={cancelDelete} type="button" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
        </div>
      </dialog>
    </section>
  );
}
