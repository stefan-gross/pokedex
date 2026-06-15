import type { PriceResult } from './types';

export type ValueTier = 'standard' | 'schoen' | 'besonders' | 'wertvoll' | 'schatz';

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
