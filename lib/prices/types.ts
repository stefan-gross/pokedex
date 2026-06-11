export type PriceProvider = 'cardmarket';
export type PriceCurrency = 'EUR';

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
  /** Wann pokemontcg.io die Daten zuletzt von Cardmarket synchronisiert hat (Format: "YYYY/MM/DD"). */
  updatedAt?: string;
  variants: PriceVariant[];
}

export interface IPriceProvider {
  readonly name: PriceProvider;
  readonly currency: PriceCurrency;
  fetchPrices(tcgId: string): Promise<PriceResult | null>;
}
