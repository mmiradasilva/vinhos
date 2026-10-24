export const DEFAULT_RETURN_TO = '/collection';

const KNOWN_ROUTES = new Set(['/collection', '/collection/new']);
const WINE_ROUTE = /^\/collection\/wines\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/edit)?$/;

/** sign-in BR-5: only relative paths to known app routes, never another site. */
export function isSafeReturnTo(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  if (value.includes('\\')) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  const path = value.split(/[?#]/, 1)[0];
  return KNOWN_ROUTES.has(path) || WINE_ROUTE.test(path);
}
