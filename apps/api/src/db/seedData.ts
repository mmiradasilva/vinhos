export const COLOURS: [id: number, code: string, name: string][] = [
  [1, 'red', 'Red'],
  [2, 'white', 'White'],
  [3, 'rose', 'Rosé'],
  [4, 'sparkling', 'Sparkling'],
  [5, 'fortified', 'Fortified'],
  [6, 'dessert', 'Dessert'],
  [7, 'orange', 'Orange'],
];

export const BOTTLE_SIZES: [id: number, volumeMl: number, name: string][] = [
  [1, 187, 'Piccolo'],
  [2, 375, 'Half'],
  [3, 500, '50 cl'],
  [4, 750, 'Standard'],
  [5, 1500, 'Magnum'],
  [6, 3000, 'Double magnum'],
  [7, 6000, 'Imperial'],
];

/** Codes Intl knows that are not ISO 3166-1 countries (withdrawn, reserved or grouping codes). */
const NOT_ISO_3166_1 = new Set([
  'AC', 'AN', 'BU', 'CP', 'CQ', 'CS', 'DD', 'DG', 'DY', 'EA', 'EU', 'EZ', 'FX', 'HV', 'IC', 'NH',
  'QO', 'RH', 'SU', 'TA', 'TP', 'UK', 'UN', 'VD', 'XA', 'XB', 'XK', 'YD', 'YU', 'ZR', 'ZZ',
]);

/** ISO 3166-1 alpha-2 countries with English names, from the runtime's CLDR data. */
export function countries(): [iso: string, name: string][] {
  const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const out: [string, string][] = [];
  for (const a of letters) {
    for (const b of letters) {
      const code = a + b;
      if (NOT_ISO_3166_1.has(code)) continue;
      const name = names.of(code);
      if (name && name !== code) out.push([code, name]);
    }
  }
  return out;
}

/**
 * Major wine regions of the top producing countries (add-wine §11, hand-made list).
 * The EU eAmbrosia import replaces/extends this before launch.
 */
export const REGIONS: Record<string, string[]> = {
  PT: ['Douro', 'Alentejo', 'Dão', 'Vinho Verde', 'Bairrada', 'Lisboa', 'Setúbal', 'Tejo', 'Madeira', 'Algarve'],
  FR: ['Bordeaux', 'Burgundy', 'Champagne', 'Rhône', 'Loire', 'Alsace', 'Languedoc-Roussillon', 'Provence', 'Beaujolais', 'Jura'],
  IT: ['Piedmont', 'Tuscany', 'Veneto', 'Sicily', 'Puglia', 'Friuli-Venezia Giulia', 'Abruzzo', 'Campania', 'Trentino-Alto Adige', 'Lombardy'],
  ES: ['Rioja', 'Ribera del Duero', 'Priorat', 'Rías Baixas', 'Rueda', 'Jerez', 'Penedès', 'Toro', 'La Mancha', 'Navarra'],
  US: ['Napa Valley', 'Sonoma', 'Willamette Valley', 'Paso Robles', 'Central Coast', 'Columbia Valley', 'Finger Lakes'],
  AR: ['Mendoza', 'Salta', 'Patagonia', 'San Juan'],
  CL: ['Maipo Valley', 'Colchagua Valley', 'Casablanca Valley', 'Maule Valley'],
  AU: ['Barossa Valley', 'McLaren Vale', 'Margaret River', 'Hunter Valley', 'Yarra Valley', 'Coonawarra', 'Clare Valley'],
  ZA: ['Stellenbosch', 'Swartland', 'Paarl', 'Constantia'],
  DE: ['Mosel', 'Rheingau', 'Pfalz', 'Rheinhessen', 'Baden', 'Nahe'],
  NZ: ['Marlborough', 'Central Otago', "Hawke's Bay", 'Martinborough'],
  AT: ['Wachau', 'Kamptal', 'Burgenland'],
};

/**
 * Widely planted grape varieties (hand-made list until VIVC's terms are confirmed, add-wine OQ-4).
 * "Tinta Roriz" is deliberately absent: AC-17 adds it as a new grape.
 */
export const GRAPES: string[] = [
  'Cabernet Sauvignon', 'Merlot', 'Tempranillo', 'Airén', 'Chardonnay', 'Syrah', 'Grenache', 'Sauvignon Blanc',
  'Pinot Noir', 'Trebbiano Toscano', 'Riesling', 'Pinot Grigio', 'Cabernet Franc', 'Malbec', 'Carignan', 'Mourvèdre',
  'Sangiovese', 'Nebbiolo', 'Barbera', 'Montepulciano', 'Primitivo', 'Zinfandel', 'Nero d’Avola', 'Aglianico',
  'Corvina', 'Glera', 'Chenin Blanc', 'Sémillon', 'Viognier', 'Gewürztraminer', 'Muscat Blanc à Petits Grains',
  'Pinot Blanc', 'Grüner Veltliner', 'Albariño', 'Verdejo', 'Macabeo', 'Garnacha Blanca', 'Godello', 'Monastrell',
  'Touriga Nacional', 'Touriga Franca', 'Tinta Barroca', 'Tinto Cão', 'Baga', 'Castelão', 'Trincadeira',
  'Alicante Bouschet', 'Arinto', 'Alvarinho', 'Loureiro', 'Encruzado', 'Antão Vaz', 'Fernão Pires', 'Sercial',
  'Verdelho', 'Malvasia', 'Carménère', 'Pinotage', 'Petit Verdot', 'Gamay', 'Melon de Bourgogne', 'Marsanne',
  'Roussanne', 'Vermentino', 'Fiano', 'Garganega', 'Pinot Meunier', 'Furmint', 'Blaufränkisch', 'Zweigelt',
  'Petite Sirah', 'Tannat', 'Assyrtiko', 'Xinomavro', 'Saperavi', 'Bonarda', 'Torrontés', 'Muscadelle',
];
