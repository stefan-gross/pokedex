'use client';

import { useEffect, useState } from 'react';
import { fetchPricesCache, fetchPricesRefresh, chunkIds } from '@/lib/prices/fetch-batch';
import type { PriceResult } from '@/lib/prices/types';

/** Client-Wrapper um `/api/prices/batch` — dieselbe „fehlt oder älter als die
 *  TTL → live nachholen"-Regel wie `usePrice()`, nur für mehrere Karten.
 *  Zweiphasig & nicht-blockierend: Phase 1 liefert sofort den Cache-Stand
 *  (Liste zeigt vorhandene Preise ohne Warten), Phase 2 holt fehlende/veraltete
 *  IDs im Hintergrund in kleinen Chunks nach und merged jeden Chunk live in die
 *  Map — so füllen sich die Preise ohne erneutes Öffnen der Liste. Liefert volle
 *  `PriceResult` (inkl. Varianten) pro Karte. */
export interface UsePricesBatchState {
  prices: Map<string, PriceResult | null>;
  loading: boolean;
}

const CHUNK_SIZE = 12;

export function usePricesBatch(tcgIds: string[]): UsePricesBatchState {
  const key = [...tcgIds].sort().join(',');
  const [state, setState] = useState<UsePricesBatchState>({ prices: new Map(), loading: tcgIds.length > 0 });

  useEffect(() => {
    if (tcgIds.length === 0) { setState({ prices: new Map(), loading: false }); return; }

    let alive = true;
    setState(s => ({ ...s, loading: true }));

    (async () => {
      // Phase 1: Cache-Stand sofort anzeigen.
      const { prices, stale } = await fetchPricesCache(tcgIds);
      if (!alive) return;
      setState({ prices: new Map(prices), loading: stale.length > 0 });
      if (stale.length === 0) return;

      // Phase 2: stale IDs chunk-weise nachholen, jeden Chunk sofort mergen.
      for (const chunk of chunkIds(stale, CHUNK_SIZE)) {
        const refreshed = await fetchPricesRefresh(chunk);
        if (!alive) return;
        setState(s => {
          const merged = new Map(s.prices);
          refreshed.forEach((v, id) => merged.set(id, v));
          return { prices: merged, loading: true };
        });
      }
      if (alive) setState(s => ({ ...s, loading: false }));
    })().catch(() => { if (alive) setState(s => ({ ...s, loading: false })); });

    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
