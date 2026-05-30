export type PriceProvider = 'tcgplayer' | 'cardmarket' | 'pokeprice';
export type PriceCurrency = 'USD' | 'EUR';

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
  updatedAt?: string;
  variants: PriceVariant[];
}

export interface IPriceProvider {
  readonly name: PriceProvider;
  readonly currency: PriceCurrency;
  fetchPrices(tcgId: string): Promise<PriceResult | null>;
}
