'use client';

import { Loader2 } from 'lucide-react';
import { usePrice } from '@/lib/hooks/use-price';

interface Props {
  tcgId: string | undefined;
}

function fmt(n: number | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

/** Variant-Tabelle mit Low/Mid/Market/Trend pro Cardmarket-Variant.
 *  Für CardDetailSheet — zeigt detaillierte Preise + Stand der Daten. */
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
        Keine Cardmarket-Preise verfügbar
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground flex items-center justify-between">
        <span>Cardmarket</span>
        {data.updatedAt && <span>Stand: {data.updatedAt}</span>}
      </div>

      {data.variants.map(v => (
        <div key={v.label} className="rounded-xl bg-secondary px-3 py-2.5">
          <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">
            {v.label}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[10px] text-muted-foreground">Low</div>
              <div className="text-sm font-semibold">{fmt(v.low)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Trend</div>
              <div className="text-sm font-semibold">{fmt(v.trend)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Markt</div>
              <div className="text-sm font-semibold" style={{ color: 'var(--pokedex-red)' }}>
                {fmt(v.market)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
