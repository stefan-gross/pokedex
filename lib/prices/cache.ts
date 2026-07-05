import { Timestamp } from 'firebase-admin/firestore';
import { activeProvider } from '@/lib/prices';
import { getAdminDb } from '@/lib/firebase/admin';
import type { PriceResult, PriceProvider, PriceCurrency } from './types';

/** TTL: nach 24 h gilt der gecachte Preis als stale → Live-Refresh. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Leere Cache-Einträge (empty: true) nur 1 h gültig — neue Sets bekommen oft
 *  innerhalb von Stunden Cardmarket-/TCGplayer-Daten nachgeschoben. Außerdem
 *  müssen Einträge, die noch vor dem TCGplayer-Fallback-Deploy entstanden sind,
 *  zeitnah neu probiert werden. */
export const EMPTY_CACHE_TTL_MS = 60 * 60 * 1000;

/** Shape von `tcg_catalog.{tcgId}.prices`. Provider-generisch über Cardmarket + TCGplayer. */
export interface CachedPrices {
  cachedAt: Timestamp;
  provider?: PriceProvider;
  currency?: PriceCurrency;
  updatedAt?: string;
  variants?: PriceResult['variants'];
  empty?: boolean;
}

export function isFresh(c: CachedPrices | undefined): boolean {
  if (!c?.cachedAt) return false;
  const age = Date.now() - c.cachedAt.toMillis();
  const ttl = c.empty ? EMPTY_CACHE_TTL_MS : CACHE_TTL_MS;
  return age < ttl;
}

export function toResult(c: CachedPrices): PriceResult | null {
  if (c.empty || !c.variants || c.variants.length === 0) return null;
  return {
    provider: c.provider ?? 'cardmarket',
    currency: c.currency ?? 'EUR',
    updatedAt: c.updatedAt,
    variants: c.variants,
  };
}

/** Refresht alle besessenen Karten + alle „leeren"/„TCGplayer-Fallback"-Einträge.
 *  Wird sowohl vom täglichen Cron als auch vom manuellen Settings-Button genutzt.
 *  `upgraded` zählt Cache-Einträge, die von TCGplayer auf Cardmarket gewechselt haben. */
export async function refreshAllOwnedAndStale(): Promise<{
  refreshed: number; upgraded: number; errored: number; total: number;
}> {
  const db = getAdminDb();
  const tcgIds = new Set<string>();
  const previousProvider = new Map<string, PriceProvider | undefined>();

  try {
    const cardsSnap = await db.collection('cards').get();
    for (const doc of cardsSnap.docs) {
      const tcgId = doc.data()?.tcgId as string | undefined;
      if (tcgId) tcgIds.add(tcgId);
    }
  } catch (e) {
    console.warn('[refresh-prices] cards query failed', e);
  }

  try {
    const fallbackSnap = await db
      .collection('tcg_catalog')
      .where('prices.provider', '==', 'tcgplayer')
      .get();
    for (const doc of fallbackSnap.docs) {
      tcgIds.add(doc.id);
      previousProvider.set(doc.id, 'tcgplayer');
    }
    const emptySnap = await db
      .collection('tcg_catalog')
      .where('prices.empty', '==', true)
      .get();
    for (const doc of emptySnap.docs) tcgIds.add(doc.id);
  } catch (e) {
    console.warn('[refresh-prices] tcg_catalog query failed', e);
  }

  let refreshed = 0, upgraded = 0, errored = 0;
  for (const tcgId of tcgIds) {
    try {
      const result = await refreshAndCache(tcgId);
      refreshed++;
      const before = previousProvider.get(tcgId);
      if (before === 'tcgplayer' && result?.provider === 'cardmarket') upgraded++;
      await new Promise(r => setTimeout(r, 100));
    } catch {
      errored++;
    }
  }
  return { refreshed, upgraded, errored, total: tcgIds.size };
}

/** Holt live von pokemontcg.io und schreibt in Firestore. */
export async function refreshAndCache(tcgId: string): Promise<PriceResult | null> {
  const db = getAdminDb();
  const docRef = db.collection('tcg_catalog').doc(tcgId);
  const live = await activeProvider.fetchPrices(tcgId);
  console.log(`[prices] Live-Refresh ${tcgId}:`, live
    ? `${live.provider} ${live.variants[0]?.trend ?? live.variants[0]?.market ?? '?'} ${live.currency}`
    : 'kein Preis gefunden → wird als empty gecacht');
  try {
    const cachedAt = Timestamp.now();
    if (live) {
      await docRef.set({
        prices: {
          cachedAt,
          provider: live.provider,
          currency: live.currency,
          updatedAt: live.updatedAt ?? null,
          variants: live.variants,
          empty: false,
        },
      }, { merge: true });
    } else {
      await docRef.set({
        prices: { cachedAt, empty: true },
      }, { merge: true });
    }
  } catch (e) {
    console.warn('[prices] cache write error', e);
  }
  return live;
}
