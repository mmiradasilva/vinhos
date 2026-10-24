export type DrinkStatus = 'too_young' | 'ready' | 'past_best' | 'unknown';

export const DRINK_STATUS_LABELS: Record<DrinkStatus, string> = {
  too_young: 'Too young',
  ready: 'Ready',
  past_best: 'Past best',
  unknown: 'Unknown',
};

/** view-collection §6: derived from the drink window and the current year. */
export function drinkStatus(drinkFrom: number | null, drinkUntil: number | null, year: number): DrinkStatus {
  if (drinkFrom == null && drinkUntil == null) return 'unknown';
  if (drinkFrom != null && year < drinkFrom) return 'too_young';
  if (drinkUntil != null && year > drinkUntil) return 'past_best';
  return 'ready';
}
