import { collection, query, where, documentId, getDocs } from 'firebase/firestore';
import { db } from '../firebase/client';
import type { PriceVariant, PriceProvider, PriceCurrency } from '@/lib/prices/types';

const COL = 'tcg_catalog';

export interface CachedPriceClient {
  provider: PriceProvider;
  currency: PriceCurrency;
  variants: PriceVariant[];
}

/** Batched-Read: liest die `prices`-Subfields aus `tcg_catalog` für mehrere TCG-IDs.
 *  Map-Wert ist `null` wenn der Catalog-Doc keine Preisdaten hat (empty oder fehlt). */
export async function getPricesByTcgIds(
  ids: string[]
): Promise<Map<string, CachedPriceClient | null>> {
  const result = new Map<string, CachedPriceClient | null>();
  if (ids.length === 0) return result;
  // Firestore-Limit: max 30 IDs pro "in"-Query
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const snap = await getDocs(query(collection(db, COL), where(documentId(), 'in', chunk)));
    for (const d of snap.docs) {
      const p = d.data().prices;
      if (!p || p.empty || !Array.isArray(p.variants) || p.variants.length === 0) {
        result.set(d.id, null);
        continue;
      }
      result.set(d.id, {
        provider: (p.provider ?? 'cardmarket') as PriceProvider,
        currency: (p.currency ?? 'EUR') as PriceCurrency,
        variants: p.variants as PriceVariant[],
      });
    }
    for (const id of chunk) if (!result.has(id)) result.set(id, null);
  }
  return result;
}
