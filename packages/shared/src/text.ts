/** Trims and collapses internal runs of whitespace to a single space. */
export function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Lower-cased, accent-free form used for search ("Château" -> "chateau"). */
export function normalizeForSearch(value: string): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
