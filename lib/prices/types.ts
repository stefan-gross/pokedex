export type PriceProvider = 'cardmarket' | 'tcgplayer';
export type PriceCurrency = 'EUR' | 'USD';

export interface PriceVariant {
  label: string;
  low?: number;
  mid?: number;
  high?: number;
  market?: number;
  trend?: number;
}

export interface PriceResult {
  provider: PriceProvider;
  currency: PriceCurrency;
  /** Wann pokemontcg.io die Daten zuletzt synchronisiert hat (Format: "YYYY/MM/DD"). */
  updatedAt?: string;
  variants: PriceVariant[];
}

export interface IPriceProvider {
  readonly name: string;
  fetchPrices(tcgId: string): Promise<PriceResult | null>;
}
