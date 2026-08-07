import type { CardCondition, CardLanguage, CardVariant } from '@/types';

export const LANGUAGES: { value: CardLanguage; label: string }[] = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'Englisch' },
  { value: 'fr', label: 'Französisch' },
  { value: 'es', label: 'Spanisch' },
  { value: 'jp', label: 'Japanisch' },
];

export const CONDITIONS: { value: CardCondition; label: string; short: string }[] = [
  { value: 'NM',   label: 'Near Mint',         short: 'NM'   },
  { value: 'LP',   label: 'Lightly Played',     short: 'LP'   },
  { value: 'MP',   label: 'Moderately Played',  short: 'MP'   },
  { value: 'HP',   label: 'Heavily Played',     short: 'HP'   },
  { value: 'Poor', label: 'Poor',               short: 'Poor' },
];

/**
 * Offizielle deutsche Bezeichnungen für Pokémon-TCG Subtypes.
 * Quelle: deutsche Kartendrucke. Rarity-Labels bleiben englisch (per Designentscheidung).
 */
export const SUBTYPE_LABELS_DE: Record<string, string> = {
  // Pokémon-Stufen
  'Basic':    'Basis',
  'Stage 1':  'Phase 1',
  'Stage 2':  'Phase 2',
  'MEGA':     'Mega',
  'BREAK':    'BREAK',
  'Level-Up': 'Level-up',
  'Restored': 'Wiederhergestellt',
  // Moderne Mechaniken (Markennamen — unverändert)
  'GX':       'GX',
  'EX':       'ex',
  'V':        'V',
  'VMAX':     'VMAX',
  'VSTAR':    'VSTAR',
  'V-UNION':  'V-Union',
  'Radiant':  'Strahlend',
  'Tera':     'Tera',
  'ACE SPEC': 'ACE SPEC',
  // Trainer-Subtypes
  'Item':              'Item',
  'Supporter':         'Unterstützer',
  'Stadium':           'Stadion',
  'Tool':              'Tool',
  'Pokémon Tool':      'Pokémon-Tool',
  'Technical Machine': 'Technische Maschine',
  'Ace Spec':          'Ass-Spezifikation',
  // Energie-Subtypes
  'Basic Energy':   'Basis-Energie',
  'Special Energy': 'Spezial-Energie',
};

/** Gibt den deutschen Subtype-Namen zurück, Fallback: Original-String */
export function getSubtypeDe(subtype: string): string {
  return SUBTYPE_LABELS_DE[subtype] ?? subtype;
}

/** „Alternative Formen"-Filter (Suche-Seite) — Teilmenge der SUBTYPE_LABELS_DE-
 *  Keys, Labels werden von dort wiederverwendet statt dupliziert. */
export const SPECIAL_MECHANIC_KEYS = [
  'GX', 'EX', 'V', 'VMAX', 'VSTAR', 'V-UNION', 'Radiant', 'Tera', 'ACE SPEC', 'MEGA', 'BREAK',
] as const;

export const VARIANT_LABELS: Record<CardVariant, string> = {
  'standard': 'Standard',
  'holo':     'Holo',
  'reverse':  'Reverse Holo',
  'alt-art':  'Alt Art',
  '1st-ed':   '1st Edition',
  'promo':    'Promo',
};

/** „Inhärentes Foil" — die Karte existiert AUSSCHLIESSLICH als Holo bzw. nur
 *  Reverse (keine `standard`-Variante im Katalog). Dann ist der Foil-Charakter
 *  eindeutig, unabhängig von Besitz/Auswahl → der Holo-Glanz darf überall
 *  gezeigt werden (auch Katalog-/Detailbild, Suche, Scan-Kachel). Gibt es auch
 *  eine `standard`-Variante, ist Holo NICHT eindeutig (nur ein möglicher Druck)
 *  → `null`, dann greift der Glanz nur nach erfasstem/gewähltem Exemplar. */
export function inherentFoilVariant(variants?: CardVariant[]): 'holo' | 'reverse' | null {
  if (!variants || variants.length === 0) return null;
  if (variants.includes('standard')) return null;
  if (variants.includes('holo')) return 'holo';
  if (variants.includes('reverse')) return 'reverse';
  return null;
}

/** Raritäten, deren Foil (nahezu) die GANZE Karte bedeckt (Full-Art/Full-Bleed:
 *  Illustration/Special Illustration Rare, Ultra/Shiny/Hyper/Secret, Amazing,
 *  Radiant). Bei ihnen darf der Holo-Glanz die ganze Karte einnehmen statt nur
 *  das kleine Artwork-Fenster. Abgleich über die Raritäts-GRUPPE (getRarityGroup). */
const FULL_ART_RARITY_GROUPS = new Set([
  'Illustration Rare', 'Ultra Rare', 'Special Illustration Rare',
  'Shiny Rare', 'Shiny Ultra Rare', 'Hyper Rare', 'Secret Rare',
  'Amazing Rare', 'Radiant Rare',
]);
export function isFullArtRarity(rarity?: string): boolean {
  if (!rarity) return false;
  const g = getRarityGroup(rarity);
  return !!g && FULL_ART_RARITY_GROUPS.has(g.label);
}

/** Wählt die passenden Klassen für den Holo-Glanz je nach Variante + Rarität:
 *  Reverse → Rahmen (`is-frame`); Holo auf Full-Art → ganze Karte (kein Clip);
 *  Holo auf Standard-Layout → Artwork-Fenster (`is-artwork`). */
export function holoShimmerClass(variant: 'holo' | 'reverse', rarity?: string): string {
  if (variant === 'reverse') return 'card-holo-shimmer is-frame';
  return isFullArtRarity(rarity) ? 'card-holo-shimmer' : 'card-holo-shimmer is-artwork';
}

/**
 * Offizielle Pokémon TCG Raritäten mit korrekten Symbolen.
 *
 * Symbole (englische Karten):
 *   ●  Common
 *   ♦  Uncommon
 *   ★  Rare / Double Rare / Ace Spec / Illustration Rare (Farbe unterscheidet sie)
 *   ☆  Outline-Stern (Ultra Rare, Shiny)
 *
 * API-Keys = Rarity-Strings von TCGdex (lowercase-verglichen).
 */
export type RarityGroup = {
  label: string;
  symbol: string;
  /** CSS-Farbe, Hex oder 'var(--foreground)' */
  color: string;
  /** CSS-Gradient für Amazing Rare (optional) */
  gradient?: string;
  /** Sortierreihenfolge: 0 = Common, höher = seltener */
  order: number;
  /** TCGdex rarity strings (lowercase) die zu dieser Gruppe gehören */
  keys: string[];
};

export const RARITY_GROUPS: RarityGroup[] = [
  // Pocket-Raritäten (◇/★) sind mit einsortiert: Diamanten = Common…Double Rare,
  // Sterne/Shiny/Crown in die höheren Gruppen.
  {
    label: 'Common',
    symbol: '●',
    color: 'var(--foreground)',
    order: 0,
    keys: ['common', 'none', 'one diamond'],
  },
  {
    label: 'Uncommon',
    symbol: '♦',
    color: 'var(--foreground)',
    order: 1,
    keys: ['uncommon', 'two diamond'],
  },
  {
    label: 'Rare',
    symbol: '★',
    color: 'var(--foreground)',
    order: 2,
    keys: ['rare', 'rare holo', 'holo rare', 'rare holo lv.x', 'rare prime', 'legend', 'black white rare', 'three diamond'],
  },
  {
    label: 'Double Rare',
    symbol: '★★',
    color: 'var(--foreground)',
    order: 3,
    keys: ['double rare', 'holo rare v', 'holo rare vmax', 'holo rare vstar', 'four diamond'],
  },
  {
    label: 'Ace Spec Rare',
    symbol: '★',
    color: '#e879f9',
    order: 4,
    keys: ['ace spec rare'],
  },
  {
    // Radiant Pokémon (SW&S-Ära) — blauer Schimmer
    label: 'Radiant Rare',
    symbol: '✦',
    color: '#38bdf8',
    order: 5,
    keys: ['radiant rare'],
  },
  {
    // Amazing Rare (SW&S) — Regenbogen-Gradient
    label: 'Amazing Rare',
    symbol: '★',
    color: '#f97316',
    gradient: 'linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6)',
    order: 6,
    keys: ['amazing rare'],
  },
  {
    label: 'Illustration Rare',
    symbol: '★',
    color: '#eab308',
    order: 7,
    keys: ['illustration rare'],
  },
  {
    // Shiny (Hidden/Shining Fates + SV Shiny) — inkl. V/VMAX-Shiny + Pocket-Shiny
    label: 'Shiny Rare',
    symbol: '✦',
    color: '#94a3b8',
    order: 8,
    keys: ['shiny rare', 'shiny rare v', 'shiny rare vmax', 'one shiny', 'two shiny'],
  },
  {
    // ☆☆ silberne Outline-Sterne (SR)
    label: 'Ultra Rare',
    symbol: '☆☆',
    color: '#94a3b8',
    order: 10,
    keys: ['ultra rare', 'full art trainer', 'one star'],
  },
  {
    label: 'Special Illustration Rare',
    symbol: '★★',
    color: '#eab308',
    order: 11,
    keys: ['special illustration rare', 'two star'],
  },
  {
    label: 'Shiny Ultra Rare',
    symbol: '☆☆',
    color: '#eab308',
    order: 13,
    keys: ['shiny ultra rare'],
  },
  {
    label: 'Hyper Rare',
    symbol: '★★★',
    color: '#eab308',
    order: 14,
    keys: ['hyper rare', 'mega hyper rare', 'crown', 'three star'],
  },
  {
    // Kartennummer > Set-Gesamtzahl (z.B. 152/151)
    label: 'Secret Rare',
    symbol: '✦',
    color: '#eab308',
    order: 15,
    keys: ['secret rare'],
  },
  {
    label: 'Promo',
    symbol: 'PROMO',
    color: 'var(--foreground)',
    order: 99,
    keys: ['promo', 'classic collection'],
  },
];

/** Englische pokemontcg.io Seriennamen → Deutsche Namen (TCGdex) */
export const SERIES_NAMES_DE: Record<string, string> = {
  'Scarlet & Violet':       'Karmesin & Purpur',
  'Sword & Shield':         'Schwert & Schild',
  'Sun & Moon':             'Sonne & Mond',
  'XY':                     'XY',
  'Black & White':          'Schwarz & Weiß',
  'Diamond & Pearl':        'Diamant & Perl',
  'Platinum':               'Platin',
  'HeartGold & SoulSilver': 'HeartGold SoulSilver',
  'HeartGold SoulSilver':   'HeartGold SoulSilver',
  'Call of Legends':        'Ruf der Legenden',
  'EX':                     'EX',
  'Neo':                    'Neo',
  'Base':                   'Grund',
  'Mega Evolution':         'Mega-Entwicklung',
  'Pokémon GO':             'Pokémon GO',
  'TCG Pocket':             'Pokémon‑Sammelkartenspiel‑Pocket',
};

/** Findet die Rarity-Gruppe anhand des API-Strings (case-insensitive) */
export function getRarityGroup(rarity: string): RarityGroup | undefined {
  const lower = rarity.toLowerCase();
  return RARITY_GROUPS.find(g => g.keys.some(k => lower === k));
}

/** Leitet mögliche Varianten aus dem rarity-String der pokemontcg.io API ab.
 *  Für Common/Uncommon/Rare wird Reverse-Holo als Default angenommen — moderne
 *  Sets (Wizards-Era ab Legendary Collection + EX-Ära aufwärts) haben für
 *  jede Common/Uncommon/Rare auch eine Reverse-Holo-Variante.
 *  TCGdex-Enrichment kann diese Heuristik später präzise überschreiben. */
/**
 * `series`-Werte (pokemontcg.io) aller Sets ohne echten aufgedruckten Set-Kürzel —
 * diese Karten tragen nur ein grafisches Symbol am Kartenrand, kein Textcode wie
 * "ASC" (das gibt es erst ab Scarlet & Violet). `ptcgoCode`/`setCode` existiert für
 * diese Sets zwar in unseren Daten (z.B. "BS", "JU"), ist aber ein internes
 * pokemontcg.io-Kürzel, das NICHT auf der physischen Karte steht — sollte daher nie
 * als vermeintlicher Kartendruck angezeigt werden. Gleiche Liste wie
 * lib/scan/reference-sheets.ts (Symbolabgleich-Referenzblätter).
 */
export const SYMBOL_ONLY_SERIES = [
  'Base', 'Gym', 'Neo', 'E-Card', 'Other', 'NP',
  'EX',
  'Diamond & Pearl', 'Platinum', 'HeartGold & SoulSilver',
  'Black & White', 'XY',
  'Sun & Moon',
  'Sword & Shield',
];

export function detectVariants(rarity: string): CardVariant[] {
  const r = rarity.toLowerCase();
  const variants: CardVariant[] = ['standard'];
  if (r === 'common' || r === 'uncommon' || r === 'rare') {
    variants.push('reverse');
  }
  if (r.includes('holo') && !r.includes('reverse')) variants.push('holo');
  if (r.includes('reverse')) variants.push('reverse');
  if (r.includes('illustration rare') || r.includes('special illustration')) variants.push('alt-art');
  if (r.includes('promo') || r.includes('classic collection')) variants.push('promo');
  return Array.from(new Set(variants));
}
