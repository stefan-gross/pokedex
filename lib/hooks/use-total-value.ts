'use client';

import { useEffect, useState } from 'react';
import { getPricesByTcgIds, type CachedPriceClient } from '@/lib/firestore/prices';
import type { CardDoc } from '@/types';
import type { PriceVariant } from '@/lib/prices/types';
import type { CardVariant } from '@/types';

/** Findet die Preis-Variante für eine Karten-Variante (Mapping wie in CardPriceDetail). */
function findVariantPrice(variants: PriceVariant[], appVariant: CardVariant): PriceVariant | undefined {
  const byLabel = (label: string) => variants.find(v => v.label === label);
  switch (appVariant) {
    case 'standard': return byLabel('Normal');
    case 'reverse':  return byLabel('Reverse Holo');
    case 'holo':     return byLabel('Holo') ?? byLabel('Normal');
    case '1st-ed':   return byLabel('1st Edition Holo') ?? byLabel('1st Edition') ?? byLabel('Normal');
    case 'alt-art':
    case 'promo':
    default:         return variants[0];
  }
}

export interface TotalValueState {
  total: number;
  loading: boolean;
  /** Wie viele Karten der Eingangsliste einen Preis hatten. */
  withPrice: number;
  totalCards: number;
}

/** Summiert grob den Wert einer Kartenliste (Trend-Preis pro Karte × quantity).
 *  USD-Preise werden 1:1 als EUR addiert — grobe Einordnung, kein exakter Verkaufswert. */
export function useTotalValue(cards: CardDoc[] | null): TotalValueState {
  const [state, setState] = useState<TotalValueState>({ total: 0, loading: !!cards, withPrice: 0, totalCards: 0 });

  useEffect(() => {
    if (!cards) { setState({ total: 0, loading: true, withPrice: 0, totalCards: 0 }); return; }
    if (cards.length === 0) { setState({ total: 0, loading: false, withPrice: 0, totalCards: 0 }); return; }

    let alive = true;
    setState(s => ({ ...s, loading: true }));

    const uniqueTcgIds = Array.from(new Set(cards.map(c => c.tcgId).filter((x): x is string => !!x)));
    getPricesByTcgIds(uniqueTcgIds).then(pricesMap => {
      if (!alive) return;
      let total = 0;
      let withPrice = 0;
      for (const card of cards) {
        if (!card.tcgId) continue;
        const entry: CachedPriceClient | null | undefined = pricesMap.get(card.tcgId);
        if (!entry) continue;
        const variantPrice = findVariantPrice(entry.variants, card.variant);
        const price = variantPrice?.trend ?? variantPrice?.market;
        if (price == null) continue;
        total += price * (card.quantity || 1);
        withPrice++;
      }
      setState({ total, loading: false, withPrice, totalCards: cards.length });
    }).catch(() => {
      if (!alive) return;
      setState({ total: 0, loading: false, withPrice: 0, totalCards: cards.length });
    });

    return () => { alive = false; };
  }, [cards]);

  return state;
}
