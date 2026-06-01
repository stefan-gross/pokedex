import type { CardCondition, CardLanguage, CardVariant } from '@/types';

export const LANGUAGES: { value: CardLanguage; label: string }[] = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'Englisch' },
  { value: 'fr', label: 'Französisch' },
  { value: 'jp', label: 'Japanisch' },
];

export const CONDITIONS: { value: CardCondition; label: string; short: string }[] = [
  { value: 'NM',   label: 'Near Mint',         short: 'NM'   },
  { value: 'LP',   label: 'Lightly Played',     short: 'LP'   },
  { value: 'MP',   label: 'Moderately Played',  short: 'MP'   },
  { value: 'HP',   label: 'Heavily Played',     short: 'HP'   },
  { value: 'Poor', label: 'Poor',               short: 'Poor' },
];

export const VARIANT_LABELS: Record<CardVariant, string> = {
  'standard': 'Standard',
  'holo':     'Holo',
  'reverse':  'Reverse Holo',
  'alt-art':  'Alt Art',
  '1st-ed':   '1st Edition',
  'promo':    'Promo',
};

/**
 * Offizielle Pokémon TCG Raritäten mit korrekten Symbolen.
 *
 * Symbole (englische Karten):
 *   ●  Common
 *   ♦  Uncommon
 *   ★  Rare / Double Rare / Ace Spec / Illustration Rare (Farbe unterscheidet sie)
 *   ☆  Outline-Stern (Ultra Rare, Shiny)
 *
 * API-Keys = Rarity-Strings von pokemontcg.io (lowercase-verglichen).
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
  /** pokemontcg.io rarity strings (lowercase) die zu dieser Gruppe gehören */
  keys: string[];
};

export const RARITY_GROUPS: RarityGroup[] = [
  {
    label: 'Common',
    symbol: '●',
    color: 'var(--foreground)',
    order: 0,
    keys: ['common'],
  },
  {
    label: 'Uncommon',
    symbol: '♦',
    color: 'var(--foreground)',
    order: 1,
    keys: ['uncommon'],
  },
  {
    label: 'Rare',
    symbol: '★',
    color: 'var(--foreground)',
    order: 2,
    keys: [
      'rare', 'rare holo',
      'rare holo gx', 'rare holo ex', 'rare holo lv.x',
      'rare holo star', 'rare prime', 'rare break',
      'rare prism star', 'legend',
      'black white rare',
    ],
  },
  {
    label: 'Double Rare',
    symbol: '★★',
    color: 'var(--foreground)',
    order: 3,
    keys: ['double rare', 'rare holo v', 'rare holo vmax', 'rare holo vstar'],
  },
  {
    // Alte ACE SPEC (BW-Ära: "Rare ACE"), neue SV-Ära: "ACE SPEC Rare"
    label: 'Ace Spec Rare',
    symbol: '★',
    color: '#e879f9',
    order: 4,
    keys: ['ace spec rare', 'rare ace'],
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
    keys: ['illustration rare', 'trainer gallery rare holo'],
  },
  {
    // Shiny Rare aus älteren Sets (Hidden Fates, Shining Fates)
    label: 'Rare Shiny',
    symbol: '✦',
    color: '#94a3b8',
    order: 8,
    keys: ['rare shiny', 'rare shining'],
  },
  {
    label: 'Rare Shiny GX',
    symbol: '✦✦',
    color: '#94a3b8',
    order: 9,
    keys: ['rare shiny gx'],
  },
  {
    // ☆☆ silberne Outline-Sterne (SR)
    label: 'Ultra Rare',
    symbol: '☆☆',
    color: '#94a3b8',
    order: 10,
    keys: ['ultra rare', 'rare ultra'],
  },
  {
    label: 'Special Illustration Rare',
    symbol: '★★',
    color: '#eab308',
    order: 11,
    keys: ['special illustration rare'],
  },
  {
    label: 'Shiny Rare',
    symbol: '☆',
    color: '#eab308',
    order: 12,
    keys: ['shiny rare'],
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
    keys: ['hyper rare', 'rare rainbow'],
  },
  {
    // Kartennummer > Set-Gesamtzahl (z.B. 152/151)
    label: 'Secret Rare',
    symbol: '✦',
    color: '#eab308',
    order: 15,
    keys: ['rare secret'],
  },
  {
    label: 'Black Star Promo',
    symbol: 'PROMO',
    color: 'var(--foreground)',
    order: 99,
    keys: ['promo', 'classic collection'],
  },
];

/** Findet die Rarity-Gruppe anhand des API-Strings (case-insensitive) */
export function getRarityGroup(rarity: string): RarityGroup | undefined {
  const lower = rarity.toLowerCase();
  return RARITY_GROUPS.find(g => g.keys.some(k => lower === k));
}

/** Leitet mögliche Varianten aus dem rarity-String der pokemontcg.io API ab */
export function detectVariants(rarity: string): CardVariant[] {
  const r = rarity.toLowerCase();
  const variants: CardVariant[] = ['standard'];
  if (r.includes('holo') && !r.includes('reverse')) variants.push('holo');
  if (r.includes('reverse')) variants.push('reverse');
  if (r.includes('illustration rare') || r.includes('special illustration')) variants.push('alt-art');
  if (r.includes('promo') || r.includes('classic collection')) variants.push('promo');
  return variants;
}
