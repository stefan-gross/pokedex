import { Timestamp } from 'firebase-admin/firestore';
import { activeProvider } from '@/lib/prices';
import { fetchPricesForSet } from './pokemontcg';
import { getAdminDb } from '@/lib/firebase/admin';
import { TransientPriceError, type PriceResult, type PriceProvider, type PriceCurrency } from './types';

/** TTL: nach 7 Tagen gilt der gecachte Preis als stale → Live-Refresh.
 *  Preise ändern sich selten stark genug, um öfter nachzufragen — siehe
 *  `ensureFreshPrice`, die einzige Stelle, die diese Regel durchsetzt. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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

/** Zentrale „fresh-or-refresh"-Logik: gecachten Preis verwenden, wenn er
 *  existiert und `isFresh()` ist — sonst live nachholen (`refreshAndCache`).
 *  Einzige Stelle, die diese Regel implementiert; wird von der Einzelkarten-
 *  Preis-Route (`app/api/prices/route.ts`) UND der Batch-Route
 *  (`app/api/prices/batch/route.ts`) genutzt — für eine Karte oder viele. */
export async function ensureFreshPrice(tcgId: string, force = false): Promise<PriceResult | null> {
  const db = getAdminDb();
  const docRef = db.collection('tcg_catalog').doc(tcgId);

  if (!force) {
    try {
      const snap = await docRef.get();
      const cached = snap.data()?.prices as CachedPrices | undefined;
      if (cached && isFresh(cached)) {
        const ageMin = Math.round((Date.now() - cached.cachedAt.toMillis()) / 60000);
        console.log(`[prices] Cache-Hit ${tcgId}: ${cached.empty ? 'empty' : (cached.provider ?? 'cardmarket')}, ${ageMin}min alt`);
        return toResult(cached);
      }
    } catch (e) {
      console.warn('[prices] cache read error', e);
    }
  }

  return refreshAndCache(tcgId);
}

/** Holt live von pokemontcg.io und schreibt in Firestore. Bei einem
 *  transienten Fehler (Netzwerk/Timeout/5xx) wird NICHTS gecacht — der
 *  bestehende Cache-Stand (falls vorhanden) bleibt unangetastet, und der
 *  nächste Zugriff versucht es erneut live, statt eine Stunde lang
 *  fälschlich "kein Preis" anzuzeigen. Existiert bereits ein (ggf. leicht
 *  abgelaufener) Preis, wird der bei einem transienten Fehler als bester
 *  verfügbarer Wert zurückgegeben, statt gar keinen Preis zu zeigen. */
export async function refreshAndCache(tcgId: string): Promise<PriceResult | null> {
  const db = getAdminDb();
  const docRef = db.collection('tcg_catalog').doc(tcgId);

  let live: PriceResult | null;
  try {
    live = await activeProvider.fetchPrices(tcgId);
  } catch (e) {
    if (e instanceof TransientPriceError) {
      console.warn(`[prices] Live-Refresh ${tcgId}: transienter Fehler, Cache bleibt unverändert —`, e.message);
      try {
        const snap = await docRef.get();
        const cached = snap.data()?.prices as CachedPrices | undefined;
        if (cached) return toResult(cached);
      } catch { /* kein Cache verfügbar — unten null zurückgeben */ }
      return null;
    }
    throw e;
  }

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

/** Set-Bulk-Variante von `refreshAndCache` — holt Preise für ein ganzes Set
 *  in einem Request (`fetchPricesForSet`) und schreibt sie in einem
 *  gemeinsamen Batch, statt Karte für Karte sequenziell zu refreshen. Bei
 *  einem transienten Fehler bleibt der Cache unangetastet (gleiches Prinzip
 *  wie `refreshAndCache`) — die vorhandenen (ggf. leicht veralteten)
 *  Cache-Werte werden stattdessen zurückgegeben. */
export async function refreshAndCacheSet(setId: string, tcgIds: string[]): Promise<Map<string, PriceResult | null>> {
  const db = getAdminDb();

  let live: Map<string, PriceResult | null>;
  try {
    live = await fetchPricesForSet(setId);
  } catch (e) {
    if (e instanceof TransientPriceError) {
      console.warn(`[prices] Live-Refresh Set ${setId}: transienter Fehler, Cache bleibt unverändert —`, e.message);
      const out = new Map<string, PriceResult | null>();
      try {
        const refs = tcgIds.map(id => db.collection('tcg_catalog').doc(id));
        const snaps = await db.getAll(...refs);
        snaps.forEach((snap, i) => {
          const cached = snap.data()?.prices as CachedPrices | undefined;
          out.set(tcgIds[i], cached ? toResult(cached) : null);
        });
      } catch { /* kein Cache verfügbar — leere Map zurückgeben */ }
      return out;
    }
    throw e;
  }

  console.log(`[prices] Live-Refresh Set ${setId}: ${live.size} Karten in der Antwort, ${tcgIds.length} angefragt`);

  const cachedAt = Timestamp.now();
  const batch = db.batch();
  const out = new Map<string, PriceResult | null>();
  for (const tcgId of tcgIds) {
    if (!live.has(tcgId)) { out.set(tcgId, null); continue; } // fehlt in Antwort → nicht als "empty" cachen
    const result = live.get(tcgId) ?? null;
    const docRef = db.collection('tcg_catalog').doc(tcgId);
    batch.set(docRef, {
      prices: result
        ? { cachedAt, provider: result.provider, currency: result.currency, updatedAt: result.updatedAt ?? null, variants: result.variants, empty: false }
        : { cachedAt, empty: true },
    }, { merge: true });
    out.set(tcgId, result);
  }
  try {
    await batch.commit();
  } catch (e) {
    console.warn('[prices] Set-Batch-Write error', setId, e);
  }
  return out;
}
