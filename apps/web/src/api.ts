import type { DrinkStatus } from '@cellar/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: any,
  ) {
    super(`HTTP ${status}`);
  }
}

/** The request never reached the server (offline, DNS, server down). */
export class NetworkError extends Error {}

let csrfToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};
export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler;
};

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  csrf?: string;
  /** false: the caller handles 401 itself (e.g. to save a draft first). */
  handle401?: boolean;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = opts.csrf ?? csrfToken ?? '';
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new NetworkError('Network request failed');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && opts.handle401 !== false) onUnauthorized?.();
    throw new ApiError(res.status, data);
  }
  return data as T;
}

export const signInUrl = (returnTo: string) => `/api/v1/auth/google/start?return_to=${encodeURIComponent(returnTo)}`;

export interface Me {
  id: string;
  email: string;
  display_name: string | null;
  csrf_token: string;
}

export interface Lookup {
  id: number;
  name: string;
}
export interface Colour extends Lookup {
  code: string;
}
export interface BottleSize extends Lookup {
  volume_ml: number;
}
export interface Country extends Lookup {
  iso_code: string;
}
export interface Named {
  id: string;
  name: string;
}
export interface RegionOption extends Named {
  country: Country;
}

export interface WineItem {
  id: string;
  producer: Named;
  name: string;
  vintage: number | null;
  is_non_vintage: boolean;
  colour: { id: number; code: string; name: string };
  bottle_size: { id: number; volume_ml: number; name: string };
  quantity: number;
  country: { id: number; iso_code: string; name: string } | null;
  region: Named | null;
  drink_status: DrinkStatus;
  created_at: string;
}

/** GET/PUT /collection/wines/{id} (view-edit-wine §8). */
export interface WineDetail extends WineItem {
  grapes: { grape: Named; percentage: number | null }[];
  purchase_price: number | null;
  currency: string | null;
  purchase_date: string | null;
  storage_location: string | null;
  drink_from: number | null;
  drink_until: number | null;
  notes: string | null;
  updated_at: string;
  version: number;
}

export interface WinePage {
  items: WineItem[];
  next_cursor: string | null;
  totals: { wines: number; bottles: number; all_wines: number };
}

export const wineLabel = (w: { producer: { name: string }; name: string; vintage: number | null }) =>
  `${w.producer.name} ${w.name} ${w.vintage ?? 'NV'}`;
