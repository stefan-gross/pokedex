'use client';

import { useEffect, useState } from 'react';
import { fetchPricesBatch } from '@/lib/prices/fetch-batch';
import type { PriceResult } from '@/lib/prices/types';

/** Client-Wrapper um `/api/prices/batch` — dieselbe „fehlt oder älter als die
 *  TTL → live nachholen"-Regel wie `usePrice()`, nur für mehrere Karten in
 *  einem Aufruf. Liefert volle `PriceResult` (inkl. Varianten) pro Karte,
 *  damit Aufrufer wahlweise `pickTrendPrice` oder eine Varianten-spezifische
 *  Auflösung (z.B. Reverse Holo) selbst vornehmen können. */
export interface UsePricesBatchState {
  prices: Map<string, PriceResult | null>;
  loading: boolean;
}

export function usePricesBatch(tcgIds: string[]): UsePricesBatchState {
  const key = [...tcgIds].sort().join(',');
  const [state, setState] = useState<UsePricesBatchState>({ prices: new Map(), loading: tcgIds.length > 0 });

  useEffect(() => {
    if (tcgIds.length === 0) { setState({ prices: new Map(), loading: false }); return; }

    let alive = true;
    setState(s => ({ ...s, loading: true }));

    fetchPricesBatch(tcgIds)
      .then(prices => { if (alive) setState({ prices, loading: false }); })
      .catch(() => { if (alive) setState({ prices: new Map(), loading: false }); });

    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
