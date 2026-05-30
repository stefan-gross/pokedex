'use client';

import { useEffect, useState } from 'react';
import type { PriceResult } from '@/lib/prices';

const PROVIDER_LABELS = {
  tcgplayer: 'TCGPlayer (USD)',
  cardmarket: 'Cardmarket (EUR)',
  pokeprice: 'pokeprice.io (EUR)',
};

function fmt(val?: number, currency = 'USD') {
  if (val == null) return '–';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(val);
}

export function CardPrices({ tcgId }: { tcgId: string }) {
  const [data, setData] = useState<PriceResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/prices?tcgId=${encodeURIComponent(tcgId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [tcgId]);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs text-muted-foreground mb-3">Marktpreise</p>
        <div className="h-16 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!data || data.variants.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs text-muted-foreground mb-1">Marktpreise</p>
        <p className="text-sm text-muted-foreground/60">Keine Preisdaten verfügbar</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Marktpreise</p>
        <span className="text-[10px] text-muted-foreground/50">
          {PROVIDER_LABELS[data.provider]}
          {data.updatedAt ? ` · ${data.updatedAt}` : ''}
        </span>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground/60">
            <th className="text-left font-normal pb-1">Variante</th>
            <th className="text-right font-normal pb-1">Low</th>
            <th className="text-right font-normal pb-1">Market</th>
            <th className="text-right font-normal pb-1">High</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.variants.map(v => (
            <tr key={v.label}>
              <td className="py-1.5 text-muted-foreground">{v.label}</td>
              <td className="py-1.5 text-right tabular-nums">{fmt(v.low, data.currency)}</td>
              <td className="py-1.5 text-right tabular-nums font-medium">{fmt(v.market ?? v.trend, data.currency)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmt(v.high, data.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
