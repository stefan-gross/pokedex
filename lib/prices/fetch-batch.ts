import type { PriceResult } from './types';

/** Dünner Client-Wrapper um `POST /api/prices/batch` — die einzige Stelle,
 *  die den rohen `fetch`-Aufruf macht. Von `usePricesBatch` (React-Hook) und
 *  Seiten, die den Aufruf manuell steuern wollen (z.B. Set-Detailseite, die
 *  das Ergebnis in eine eigene mergbare `priceMap` überführt), gemeinsam
 *  genutzt. */
export async function fetchPricesBatch(tcgIds: string[], setId?: string): Promise<Map<string, PriceResult | null>> {
  if (tcgIds.length === 0) return new Map();
  const res = await fetch('/api/prices/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(setId ? { tcgIds, setId } : { tcgIds }),
  });
  if (!res.ok) return new Map();
  const data: { prices?: Record<string, PriceResult | null> } = await res.json();
  return new Map(Object.entries(data.prices ?? {}));
}
