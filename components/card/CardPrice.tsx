'use client';

import { usePrice } from '@/lib/hooks/use-price';
import { pickTrendPrice, classifyValue } from '@/lib/prices/value-tier';

interface Props {
  tcgId: string | undefined;
  /** Kompakte Variante ohne Tier-Färbung, ohne Platzhalter wenn leer. */
  compact?: boolean;
  className?: string;
}

/** Einzelner Preis-Pill mit Trend-Preis (Cardmarket) oder Market (TCGplayer).
 *  Hintergrund-Farbe = Wert-Tier (grau / weiß / gelb / orange / rot). */
export function CardPrice({ tcgId, compact = false, className }: Props) {
  const { data, loading } = usePrice(tcgId);
  const price = pickTrendPrice(data);
  const tier = classifyValue(price);

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
      <span className={(className ?? '') + ' text-[11px] text-muted-foreground'}>
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
        ' inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap'
      }
      style={{
        background: tier.badgeColor,
        color: tier.textColor,
        boxShadow: tier.glow,
      }}
    >
      {text}
    </span>
  );
}
