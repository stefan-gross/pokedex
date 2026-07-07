import type { PriceResult, PriceVariant } from './types';
import type { CardVariant } from '@/types';

export type ValueTier = 'standard' | 'schoen' | 'besonders' | 'wertvoll' | 'schatz';

/** Einheitliche Preis-Farbe app-weit (Scanner, Kartendetail, Sammlung,
 *  Wunschliste, Sortierung nach Preis) — bewusst unabhängig vom Wert-Tier,
 *  das weiterhin nur für den separaten „Wertvoll"/„Schatz"-Badge gilt. */
export const PRICE_COLOR = '#6cb0ff';

/** Findet die Preis-Variante (Cardmarket/TCGplayer-Label), die zu einer
 *  Karten-Variante passt — einzige Stelle für dieses Mapping, genutzt von
 *  `CardPriceDetail`/`CardVariantPrice` und `useTotalValue`. */
export function findVariantPrice(variants: PriceVariant[], appVariant: CardVariant): PriceVariant | undefined {
  const byLabel = (label: string) => variants.find(v => v.label === label);
  switch (appVariant) {
    case 'standard': return byLabel('Normal');
    case 'reverse':  return byLabel('Reverse Holo');
    case 'holo':     return byLabel('Holo') ?? byLabel('Normal');
    case '1st-ed':   return byLabel('1st Edition Holo') ?? byLabel('1st Edition') ?? byLabel('Normal');
    case 'alt-art':
    case 'promo':
    default:         return variants[0];
  }
}

export interface TierMeta {
  tier: ValueTier;
  label: string;
  /** CSS background color for pill/badge */
  badgeColor: string;
  /** CSS text color for pill/badge */
  textColor: string;
  /** Optional border/glow CSS */
  glow?: string;
  /** Erst ab 'wertvoll' true — kennzeichnet Karten, die nicht verschenkt werden sollten. */
  showBadge: boolean;
  icon: 'none' | 'star' | 'gem';
}

/** Liest die EINZIGE Zahl, die wir anzeigen: trend (Cardmarket) bzw. market (TCGplayer).
 *  Fallback-Reihenfolge ist konservativ: ohne diese beiden Felder gibt's keine Anzeige. */
export function pickTrendPrice(data: PriceResult | null | undefined): number | undefined {
  const v = data?.variants?.[0];
  return v?.trend ?? v?.market;
}

/** Klassifiziert einen Preis in eine Wert-Stufe.
 *  Schwellen in EUR; bei USD ohne Umrechnung (FX ~1.0, grobe Einordnung reicht). */
export function classifyValue(price: number | undefined): TierMeta {
  if (price == null || price < 1) {
    return {
      tier: 'standard', label: 'Standard',
      badgeColor: 'rgba(255,255,255,0.10)', textColor: 'rgba(255,255,255,0.65)',
      showBadge: false, icon: 'none',
    };
  }
  if (price < 5) {
    return {
      tier: 'schoen', label: 'Schön',
      badgeColor: 'rgba(255,255,255,0.18)', textColor: '#fff',
      showBadge: false, icon: 'none',
    };
  }
  if (price < 20) {
    return {
      tier: 'besonders', label: 'Besonders',
      badgeColor: '#facc15', textColor: '#1a1a1a',
      showBadge: false, icon: 'none',
    };
  }
  if (price < 100) {
    return {
      tier: 'wertvoll', label: 'Wertvoll',
      badgeColor: '#f97316', textColor: '#fff',
      showBadge: true, icon: 'star',
    };
  }
  return {
    tier: 'schatz', label: 'Schatz',
    badgeColor: '#ef4444', textColor: '#fff',
    glow: '0 0 12px rgba(239,68,68,0.65)',
    showBadge: true, icon: 'gem',
  };
}
