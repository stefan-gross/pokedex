'use client';

import { useEffect, useState } from 'react';
import { fetchPricesBatch } from '@/lib/prices/fetch-batch';
import { findVariantPrice } from '@/lib/prices/value-tier';
import type { CardDoc } from '@/types';

export interface TotalValueState {
  total: number;
  loading: boolean;
  /** Wie viele Karten der Eingangsliste einen Preis hatten. */
  withPrice: number;
  totalCards: number;
  /** Karte mit dem höchsten Einzelpreis (nicht × quantity) — für die Hero-
   *  Anzeige im Dashboard. Nur Karten mit `tcgImageUrl` sind Kandidaten. */
  topCard: CardDoc | null;
}

/** Summiert grob den Wert einer Kartenliste (Trend-Preis pro Karte × quantity).
 *  USD-Preise werden 1:1 als EUR addiert — grobe Einordnung, kein exakter Verkaufswert. */
export function useTotalValue(cards: CardDoc[] | null): TotalValueState {
  const [state, setState] = useState<TotalValueState>({ total: 0, loading: !!cards, withPrice: 0, totalCards: 0, topCard: null });

  useEffect(() => {
    if (!cards) { setState({ total: 0, loading: true, withPrice: 0, totalCards: 0, topCard: null }); return; }
    if (cards.length === 0) { setState({ total: 0, loading: false, withPrice: 0, totalCards: 0, topCard: null }); return; }

    let alive = true;
    setState(s => ({ ...s, loading: true }));

    const uniqueTcgIds = Array.from(new Set(cards.map(c => c.tcgId).filter((x): x is string => !!x)));
    fetchPricesBatch(uniqueTcgIds).then(pricesMap => {
      if (!alive) return;
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
        if (card.tcgImageUrl && price > topPrice) {
          topPrice = price;
          topCard = card;
        }
      }
      setState({ total, loading: false, withPrice, totalCards: cards.length, topCard });
    }).catch(() => {
      if (!alive) return;
      setState({ total: 0, loading: false, withPrice: 0, totalCards: cards.length, topCard: null });
    });

    return () => { alive = false; };
  }, [cards]);

  return state;
}
