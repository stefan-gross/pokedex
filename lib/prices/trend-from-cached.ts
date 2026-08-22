import { pickTrendPrice } from './value-tier';
import type { PriceResult } from './types';

/** Client-sichere Trendpreis-Extraktion aus dem inline im Katalog-Doc
 *  gespeicherten `prices`-Feld (CachedPrices). BEWUSST ohne Import aus
 *  `lib/prices/cache.ts` — das zieht das Firebase-Admin-SDK in den Client-Bundle.
 *  Nur die `variants` werden für den Trend gebraucht. `null`, wenn kein Preis. */
export interface CachedPricesLike {
  empty?: boolean;
  provider?: string;
  currency?: string;
  variants?: PriceResult['variants'];
}

export function trendFromCached(prices: CachedPricesLike | null | undefined): number | null {
  if (!prices || prices.empty || !prices.variants || prices.variants.length === 0) return null;
  const v = pickTrendPrice({
    provider: (prices.provider as PriceResult['provider']) ?? 'cardmarket',
    currency: (prices.currency as PriceResult['currency']) ?? 'EUR',
    variants: prices.variants,
  });
  return v ?? null;
}
