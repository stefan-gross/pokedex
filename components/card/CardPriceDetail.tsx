'use client';

import { Loader2, Star, Gem } from 'lucide-react';
import { usePrice } from '@/lib/hooks/use-price';
import { classifyValue, pickTrendPrice } from '@/lib/prices/value-tier';
import type { PriceResult, PriceVariant } from '@/lib/prices/types';
import type { CardVariant } from '@/types';

interface Props {
  tcgId: string | undefined;
}

function fmt(n: number | undefined, currency: 'EUR' | 'USD' = 'EUR'): string {
  if (n == null) return '—';
  const locale = currency === 'USD' ? 'en-US' : 'de-DE';
  return n.toLocaleString(locale, { style: 'currency', currency });
}

/** Findet die Preis-Variante (Cardmarket/TCGplayer-Label), die zu einer Karten-Variante passt. */
function priceForVariant(data: PriceResult, appVariant: CardVariant): PriceVariant | undefined {
  const byLabel = (label: string) => data.variants.find(v => v.label === label);
  switch (appVariant) {
    case 'standard': return byLabel('Normal');
    case 'reverse':  return byLabel('Reverse Holo');
    case 'holo':     return byLabel('Holo') ?? byLabel('Normal');
    case '1st-ed':   return byLabel('1st Edition Holo') ?? byLabel('1st Edition') ?? byLabel('Normal');
    case 'alt-art':
    case 'promo':
    default:         return data.variants[0];
  }
}

/** Eine Zeile mit Provider + Stand-Datum + Trend-Preis für genau EINE Karten-Variante.
 *  Zeigt den Preis tier-eingefärbt (Standard/Schön = neutral, Besonders/Wertvoll/Schatz = farbig). */
export function CardVariantPrice({ tcgId, variant }: { tcgId: string | undefined; variant: CardVariant }) {
  const { data, loading } = usePrice(tcgId);
  if (loading) {
    return (
      <div className="flex items-center justify-between text-xs text-muted-foreground py-1">
        <span>Lade Preis…</span>
        <Loader2 size={12} className="animate-spin" />
      </div>
    );
  }
  if (!data) {
    return (
      <p className="text-xs text-muted-foreground py-1">Keine Preisdaten verfügbar</p>
    );
  }
  const v = priceForVariant(data, variant);
  const price = v?.trend ?? v?.market;
  const tier = classifyValue(price);
  const providerLabel = data.provider === 'cardmarket' ? 'Cardmarket' : 'TCGplayer (USD)';
  const priceColor =
    tier.tier === 'standard' || tier.tier === 'schoen' ? undefined : tier.badgeColor;
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-muted-foreground">
        {providerLabel}
        {data.updatedAt && <> · Stand {data.updatedAt}</>}
      </span>
      <span className="text-lg font-bold tabular-nums" style={{ color: priceColor }}>
        {fmt(price, data.currency)}
      </span>
    </div>
  );
}

/** Kompakte Preis-Anzeige — pro Variant nur die eine Trend-/Market-Zahl,
 *  oben rechts Wert-Tier-Badge wenn Karte „wertvoll" oder „Schatz" ist. */
export function CardPriceDetail({ tcgId }: Props) {
  const { data, loading } = usePrice(tcgId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4 text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (!data || data.variants.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-3 text-center">
        Keine Preisdaten verfügbar
      </div>
    );
  }

  const tier = classifyValue(pickTrendPrice(data));
  const providerLabel = data.provider === 'cardmarket' ? 'Cardmarket' : 'TCGplayer (USD)';
  const TierIcon = tier.icon === 'gem' ? Gem : tier.icon === 'star' ? Star : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          <span>{providerLabel}</span>
          {data.updatedAt && <span className="ml-2">Stand: {data.updatedAt}</span>}
        </div>
        {tier.showBadge && TierIcon && (
          <span
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-extrabold"
            style={{
              background: tier.badgeColor,
              color: tier.textColor,
              boxShadow: tier.glow,
            }}
          >
            <TierIcon size={12} strokeWidth={2.5} fill={tier.tier === 'schatz' ? tier.textColor : 'none'} />
            {tier.label}
          </span>
        )}
      </div>

      {data.provider === 'tcgplayer' && (
        <p className="text-[11px] text-muted-foreground italic">
          Cardmarket-Daten für diesen Set noch nicht verfügbar — TCGplayer (USD) als Schätzung.
        </p>
      )}

      <div className="space-y-1.5">
        {data.variants.map(v => {
          const price = v.trend ?? v.market;
          const vTier = classifyValue(price);
          return (
            <div key={v.label} className="flex items-center justify-between rounded-xl bg-secondary px-3 py-2.5">
              <span className="text-sm font-medium">{v.label}</span>
              <span
                className="text-base font-bold"
                style={{ color: vTier.tier === 'standard' || vTier.tier === 'schoen' ? undefined : vTier.badgeColor }}
              >
                {fmt(price, data.currency)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
