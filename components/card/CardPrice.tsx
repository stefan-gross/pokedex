'use client';

import { usePrice } from '@/lib/hooks/use-price';
import { pickTrendPrice, findVariantPrice, PRICE_COLOR } from '@/lib/prices/value-tier';
import type { CardVariant } from '@/types';

interface Props {
  tcgId: string | undefined;
  /** Kompakte Variante ohne Tier-Färbung, ohne Platzhalter wenn leer. */
  compact?: boolean;
  /** Reiner Text ohne Pill-Hintergrund/-Padding — nur Farbe + Fettschrift. */
  plain?: boolean;
  className?: string;
  /** Schriftgröße in px (nur `plain`) — direkte font-size statt CSS `zoom`,
   *  da `zoom` auf älteren iOS-Versionen nicht unterstützt wird. */
  fontSize?: number;
  /** Karten-Variante — zeigt den passenden Varianten-Preis (Holo/Reverse/… kann
   *  anders sein als Normal). Ohne Angabe der Standard-/Trend-Preis (variants[0]). */
  variant?: CardVariant;
}

/** Einzelner Preis-Pill mit Trend-Preis (Cardmarket) oder Market (TCGplayer).
 *  Immer in der app-weit einheitlichen Preis-Farbe (`PRICE_COLOR`). */
export function CardPrice({ tcgId, compact = false, plain = false, className, fontSize, variant }: Props) {
  const { data, loading } = usePrice(tcgId);
  const price = (() => {
    if (variant && data?.variants?.length) {
      const v = findVariantPrice(data.variants, variant);
      const p = v?.trend ?? v?.market;
      if (p != null) return p;
    }
    return pickTrendPrice(data);
  })();

  if (loading) {
    return (
      <span
        className={
          (className ?? '') +
          ' inline-block min-w-[48px] h-[18px] rounded-full bg-white/10 animate-pulse'
        }
      />
    );
  }

  if (price == null) {
    return compact ? null : (
      <span
        className={(className ?? '') + (plain ? '' : ' text-[11px]') + ' text-muted-foreground'}
        style={plain ? { fontSize } : undefined}
      >
        — €
      </span>
    );
  }

  const currency = data?.currency ?? 'EUR';
  const locale = currency === 'USD' ? 'en-US' : 'de-DE';
  const text = price.toLocaleString(locale, { style: 'currency', currency });

  return (
    <span
      className={
        (className ?? '') +
        (plain
          ? ' font-semibold whitespace-nowrap'
          : ' inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap')
      }
      style={plain
        ? { color: PRICE_COLOR, fontSize }
        : { background: 'rgba(255,255,255,0.12)', color: PRICE_COLOR }
      }
    >
      {text}
    </span>
  );
}
