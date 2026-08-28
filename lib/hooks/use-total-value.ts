'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchPricesCache, fetchPricesRefresh, chunkIds } from '@/lib/prices/fetch-batch';
import { findVariantPrice } from '@/lib/prices/value-tier';
import type { PriceResult } from '@/lib/prices/types';
import type { CardDoc } from '@/types';

export interface TotalValueState {
  total: number;
  loading: boolean;
  /** Wie viele Karten der Eingangsliste einen Preis hatten. */
  withPrice: number;
  totalCards: number;
  /** Karte mit dem höchsten Einzelpreis (nicht × quantity) — für die Hero-
   *  Anzeige im Dashboard. Kandidaten: Karten mit `tcgId` (Bild wird live aus
   *  dem Katalog aufgelöst, nicht mehr eingefroren). */
  topCard: CardDoc | null;
}

const CHUNK_SIZE = 12;

/** Summiert grob den Wert einer Kartenliste (Trend-Preis pro Karte × quantity).
 *  USD-Preise werden 1:1 als EUR addiert — grobe Einordnung, kein exakter Verkaufswert.
 *
 *  Zweiphasig & nicht-blockierend (wie `usePricesBatch`): Phase 1 rechnet den
 *  Gesamtwert sofort aus dem Preis-Cache, Phase 2 holt fehlende/veraltete IDs im
 *  Hintergrund in kleinen Chunks nach und aktualisiert die Summe live. Vorher lief
 *  EIN blockierender `fetchPricesBatch`-Refresh, der serverseitig alle stale IDs
 *  sequenziell mit 200 ms Pacing holt — bei großen Sammlungen näherte sich der
 *  eine Request `maxDuration=60` und konnte timeouten → Gesamtwert blieb 0. */
export function useTotalValue(cards: CardDoc[] | null): TotalValueState {
  const [state, setState] = useState<TotalValueState>({ total: 0, loading: !!cards, withPrice: 0, totalCards: 0, topCard: null });

  // Stabiler Inhalts-Key: tcgId + Menge + Variante bestimmen den Wert. So löst
  // nur eine INHALTLICHE Änderung ein Neuladen aus, nicht schon eine neue
  // Array-Identität desselben Bestands (Dashboard reicht `cards` oft neu durch).
  const key = useMemo(
    () => cards ? cards.map(c => `${c.tcgId ?? ''}:${c.quantity ?? 1}:${c.variant ?? ''}`).join('|') : null,
    [cards],
  );

  useEffect(() => {
    if (!cards) { setState({ total: 0, loading: true, withPrice: 0, totalCards: 0, topCard: null }); return; }
    if (cards.length === 0) { setState({ total: 0, loading: false, withPrice: 0, totalCards: 0, topCard: null }); return; }

    let alive = true;
    setState(s => ({ ...s, loading: true }));

    const uniqueTcgIds = Array.from(new Set(cards.map(c => c.tcgId).filter((x): x is string => !!x)));

    // Gesamtwert + Top-Karte aus dem aktuellen Preis-Stand (akkumulierte Map) rechnen.
    const compute = (pricesMap: Map<string, PriceResult | null>) => {
      let total = 0;
      let withPrice = 0;
      let topCard: CardDoc | null = null;
      let topPrice = -Infinity;
      for (const card of cards) {
        if (!card.tcgId) continue;
        const entry = pricesMap.get(card.tcgId);
        if (!entry) continue;
        const variantPrice = findVariantPrice(entry.variants, card.variant);
        const price = variantPrice?.trend ?? variantPrice?.market;
        if (price == null) continue;
        total += price * (card.quantity || 1);
        withPrice++;
        // Kandidat für die Hero-Anzeige: braucht einen Katalog-Verweis (Bild
        // wird im Dashboard live aus dem Katalog aufgelöst, nicht eingefroren).
        if (!card.pendingCatalog && price > topPrice) {
          topPrice = price;
          topCard = card;
        }
      }
      return { total, withPrice, topCard };
    };

    (async () => {
      const acc = new Map<string, PriceResult | null>();

      // Phase 1: Cache-Stand sofort verrechnen.
      const { prices, stale } = await fetchPricesCache(uniqueTcgIds);
      if (!alive) return;
      prices.forEach((v, k) => acc.set(k, v));
      setState({ ...compute(acc), loading: stale.length > 0, totalCards: cards.length });
      if (stale.length === 0) return;

      // Phase 2: stale IDs chunk-weise nachholen, nach jedem Chunk neu verrechnen.
      for (const chunk of chunkIds(stale, CHUNK_SIZE)) {
        const refreshed = await fetchPricesRefresh(chunk);
        if (!alive) return;
        refreshed.forEach((v, k) => acc.set(k, v));
        setState({ ...compute(acc), loading: true, totalCards: cards.length });
      }
      if (alive) setState(s => ({ ...s, loading: false }));
    })().catch(() => {
      if (!alive) return;
      setState(s => ({ ...s, loading: false }));
    });

    return () => { alive = false; };
    // Neu laden nur bei inhaltlicher Änderung (key), nicht bei neuer Array-Identität.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
