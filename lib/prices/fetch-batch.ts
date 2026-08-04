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

/** Phase 1 (sofort): nur der Cache-Stand + Liste der noch nachzuholenden
 *  (fehlenden/veralteten) IDs — kein Live-Refresh, daher schnell. */
export async function fetchPricesCache(
  tcgIds: string[],
  setId?: string,
): Promise<{ prices: Map<string, PriceResult | null>; stale: string[] }> {
  if (tcgIds.length === 0) return { prices: new Map(), stale: [] };
  const res = await fetch('/api/prices/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tcgIds, mode: 'cache', ...(setId ? { setId } : {}) }),
  });
  if (!res.ok) return { prices: new Map(), stale: tcgIds };
  const data: { prices?: Record<string, PriceResult | null>; stale?: string[] } = await res.json();
  return { prices: new Map(Object.entries(data.prices ?? {})), stale: data.stale ?? [] };
}

/** Phase 2 (Hintergrund): einen kleinen Chunk stale IDs live nachholen.
 *  Der Aufrufer chunkt + merged jeden Chunk sofort in seine Anzeige. */
export async function fetchPricesRefresh(tcgIds: string[], setId?: string): Promise<Map<string, PriceResult | null>> {
  if (tcgIds.length === 0) return new Map();
  const res = await fetch('/api/prices/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tcgIds, mode: 'refresh', ...(setId ? { setId } : {}) }),
  });
  if (!res.ok) return new Map();
  const data: { prices?: Record<string, PriceResult | null> } = await res.json();
  return new Map(Object.entries(data.prices ?? {}));
}

/** Teilt eine ID-Liste in Chunks fester Größe (für das paced Nachladen). */
export function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
