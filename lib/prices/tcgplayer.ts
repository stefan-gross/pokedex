import type { IPriceProvider, PriceResult, PriceVariant } from './types';

const TCG_BASE = 'https://api.pokemontcg.io/v2';

interface TcgPlayerEntry {
  low?: number;
  mid?: number;
  high?: number;
  market?: number;
  directLow?: number | null;
}

interface TcgPlayerData {
  updatedAt?: string;
  prices?: Record<string, TcgPlayerEntry>;
}

const VARIANT_LABELS: Record<string, string> = {
  normal: 'Normal',
  holofoil: 'Holofoil',
  reverseHolofoil: 'Reverse Holo',
  '1stEditionNormal': '1st Ed. Normal',
  '1stEditionHolofoil': '1st Ed. Holo',
};

export const tcgPlayerProvider: IPriceProvider = {
  name: 'tcgplayer',
  currency: 'USD',

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
      const tcgplayer: TcgPlayerData | undefined = json.data?.tcgplayer;
      if (!tcgplayer?.prices) return null;

      const variants: PriceVariant[] = Object.entries(tcgplayer.prices).map(([key, entry]) => ({
        label: VARIANT_LABELS[key] ?? key,
        low: entry.low ?? undefined,
        mid: entry.mid ?? undefined,
        high: entry.high ?? undefined,
        market: entry.market ?? undefined,
      }));

      return {
        provider: 'tcgplayer',
        currency: 'USD',
        updatedAt: tcgplayer.updatedAt,
        variants,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  },
};
