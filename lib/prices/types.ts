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

/** Ein Provider wirft dies statt `null` zurückzugeben, wenn die Anfrage aus
 *  transienten Gründen fehlschlägt (Netzwerk/Timeout/5xx/Rate-Limit) — im
 *  Unterschied zu einem `null`-Rückgabewert, der bedeutet "der Anbieter hat
 *  geantwortet, kennt aber keinen Preis für diese Karte". `refreshAndCache`
 *  darf einen transienten Fehler NICHT als "leer" cachen, sonst versteckt ein
 *  einzelner Netzwerk-Hänger den Preis für die volle Empty-TTL. */
export class TransientPriceError extends Error {}
