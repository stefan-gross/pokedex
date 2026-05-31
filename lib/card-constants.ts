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
