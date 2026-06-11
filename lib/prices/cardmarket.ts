import type { IPriceProvider, PriceResult, PriceVariant } from './types';

const TCG_BASE = 'https://api.pokemontcg.io/v2';

/** pokemontcg.io syndiziert Cardmarket-Daten in folgenden Feldern: */
interface CardmarketPrices {
  averageSellPrice?: number;
  lowPrice?: number;
  trendPrice?: number;
  avg1?: number;
  avg7?: number;
  avg30?: number;
  reverseHoloSell?: number;
  reverseHoloLow?: number;
  reverseHoloTrend?: number;
  reverseHoloAvg1?: number;
  reverseHoloAvg7?: number;
  reverseHoloAvg30?: number;
}

interface CardmarketData {
  url?: string;
  updatedAt?: string;
  prices?: CardmarketPrices;
}

/** Liest „Normal"-Variant aus den Standard-Feldern. */
function readNormal(p: CardmarketPrices): PriceVariant | null {
  if (
    p.averageSellPrice == null &&
    p.lowPrice == null &&
    p.trendPrice == null &&
    p.avg7 == null
  ) return null;
  return {
    label: 'Normal',
    low:    p.lowPrice,
    mid:    p.avg7,
    market: p.averageSellPrice,
    trend:  p.trendPrice,
  };
}

/** Liest „Reverse Holo"-Variant aus den reverseHolo*-Feldern. */
function readReverseHolo(p: CardmarketPrices): PriceVariant | null {
  if (
    p.reverseHoloSell == null &&
    p.reverseHoloLow == null &&
    p.reverseHoloTrend == null &&
    p.reverseHoloAvg7 == null
  ) return null;
  return {
    label: 'Reverse Holo',
    low:    p.reverseHoloLow,
    mid:    p.reverseHoloAvg7,
    market: p.reverseHoloSell,
    trend:  p.reverseHoloTrend,
  };
}

export const cardmarketProvider: IPriceProvider = {
  name: 'cardmarket',
  currency: 'EUR',

  async fetchPrices(tcgId: string): Promise<PriceResult | null> {
    const headers: Record<string, string> = process.env.POKEMON_TCG_API_KEY
      ? { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY }
      : {};

    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 8000);

    try {
      const res = await fetch(`${TCG_BASE}/cards/${tcgId}`, {
        headers,
        next: { revalidate: 3600 },
        signal: abort.signal,
      });
      if (!res.ok) return null;

      const json = await res.json();
      const cardmarket: CardmarketData | undefined = json.data?.cardmarket;
      const prices = cardmarket?.prices;
      if (!prices) return null;

      const variants: PriceVariant[] = [];
      const normal = readNormal(prices);
      if (normal) variants.push(normal);
      const reverse = readReverseHolo(prices);
      if (reverse) variants.push(reverse);

      if (variants.length === 0) return null;

      return {
        provider: 'cardmarket',
        currency: 'EUR',
        updatedAt: cardmarket.updatedAt,
        variants,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  },
};
