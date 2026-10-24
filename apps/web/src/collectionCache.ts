import type { WineItem, WinePage } from './api';

/**
 * The last collection view, so "Back" restores the same list and scroll position (view-collection AC-21,
 * view-edit-wine FR-10). The detail page keeps it in step with quantity changes, edits and deletes.
 */
interface Entry {
  search: string;
  page: WinePage;
  scrollY: number;
}

let entry: Entry | null = null;

export const collectionCache = {
  get(search: string): Entry | null {
    return entry && entry.search === search ? entry : null;
  },
  set(search: string, page: WinePage): void {
    entry = { search, page, scrollY: entry?.search === search ? entry.scrollY : 0 };
  },
  saveScroll(scrollY: number): void {
    if (entry) entry.scrollY = scrollY;
  },
  /** A wine changed: update its row, or drop it when it has no bottles left (view-collection FR-12). */
  updateWine(wine: WineItem): void {
    if (!entry) return;
    const old = entry.page.items.find((w) => w.id === wine.id);
    if (!old) return;
    const totals = { ...entry.page.totals, bottles: entry.page.totals.bottles - old.quantity + wine.quantity };
    if (wine.quantity === 0) {
      totals.wines -= 1;
      totals.all_wines -= 1;
      entry.page = { ...entry.page, items: entry.page.items.filter((w) => w.id !== wine.id), totals };
    } else {
      entry.page = { ...entry.page, items: entry.page.items.map((w) => (w.id === wine.id ? { ...w, ...pickListFields(wine) } : w)), totals };
    }
  },
  removeWine(id: string): void {
    if (!entry) return;
    const old = entry.page.items.find((w) => w.id === id);
    if (!old) return;
    const t = entry.page.totals;
    entry.page = {
      ...entry.page,
      items: entry.page.items.filter((w) => w.id !== id),
      totals: { wines: t.wines - 1, all_wines: t.all_wines - 1, bottles: t.bottles - old.quantity },
    };
  },
};

function pickListFields(w: WineItem): WineItem {
  const { id, producer, name, vintage, is_non_vintage, colour, bottle_size, quantity, country, region, drink_status, created_at } = w;
  return { id, producer, name, vintage, is_non_vintage, colour, bottle_size, quantity, country, region, drink_status, created_at };
}
