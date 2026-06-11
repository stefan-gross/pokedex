'use client';

import { usePrice, pickMainPrice } from '@/lib/hooks/use-price';

interface Props {
  tcgId: string | undefined;
  /** Kompakte Variante ohne Trend-Icon, ohne „Cardmarket"-Label. */
  compact?: boolean;
  className?: string;
}

/** Kleiner EUR-Preis-Pill mit Marktpreis von Cardmarket. */
export function CardPrice({ tcgId, compact = false, className }: Props) {
  const { data, loading } = usePrice(tcgId);
  const price = pickMainPrice(data);

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
        className={(className ?? '') + ' text-[11px] text-muted-foreground'}
      >
        — €
      </span>
    );
  }

  const text = price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

  return (
    <span
      className={
        (className ?? '') +
        ' inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold'
      }
      style={{
        background: 'rgba(255,255,255,0.10)',
        color: '#fff',
      }}
    >
      {text}
    </span>
  );
}
