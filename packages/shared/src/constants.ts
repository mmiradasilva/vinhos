export const LIMITS = {
  nameMax: 200,
  producerNameMax: 200,
  regionNameMax: 100,
  grapeNameMax: 100,
  storageLocationMax: 100,
  notesMax: 2000,
  quantityMin: 1,
  quantityMax: 9999,
  vintageMin: 1800,
  drinkYearMin: 1800,
  drinkYearMax: 2200,
  priceMax: 99_999_999.99,
  collectionMax: 10_000,
  searchMin: 2,
  searchMax: 100,
  pageSizeDefault: 50,
  pageSizeMax: 100,
  lookupResultsMax: 20,
} as const;

export const COLOUR_CODES = ['red', 'white', 'rose', 'sparkling', 'fortified', 'dessert', 'orange'] as const;
export type ColourCode = (typeof COLOUR_CODES)[number];

export const DEFAULT_BOTTLE_ML = 750;
export const DEFAULT_CURRENCY = 'EUR';

export const COLLECTION_SORTS = ['added_desc', 'producer_asc', 'vintage_desc', 'vintage_asc', 'drink_by_asc'] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

export const SORT_LABELS: Record<CollectionSort, string> = {
  added_desc: 'Recently added',
  producer_asc: 'Producer A–Z',
  vintage_desc: 'Vintage, newest first',
  vintage_asc: 'Vintage, oldest first',
  drink_by_asc: 'Drink by soonest',
};
