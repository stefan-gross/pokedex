import { NextRequest, NextResponse } from 'next/server';
import { isFresh, toResult, refreshAndCache, refreshAndCacheSet, type CachedPrices } from '@/lib/prices/cache';
import { getAdminDb } from '@/lib/firebase/admin';
import type { PriceResult } from '@/lib/prices/types';

export const maxDuration = 60;

/** Harte Kappung der tatsächlichen Live-Refreshes pro Aufruf (nur im
 *  `setId`-losen Fallback-Pfad relevant) — bereits frische Treffer zählen
 *  nicht dazu. Rest bleibt `null` und wird beim nächsten Aufruf der gleichen
 *  Stelle nachgeholt (z.B. erneutes Sortieren). */
const MAX_LIVE_REFRESHES = 60;
/** Etwas großzügigere Pause als bei Einzelkarten-Refreshes — bei vielen
 *  Karten in Folge führt zu knappes Pacing sonst zu Timeouts/Rate-Limiting
 *  beim Anbieter (beobachtet: viele "aborted"-Fehler bei 100ms). */
const LIVE_REFRESH_DELAY_MS = 200;

/** Batch-Variante derselben Regel wie `ensureFreshPrice` ("fehlt oder älter
 *  als die TTL → live nachholen, sonst Cache") — nur für viele Karten statt
 *  einer. Der Cache-Freshness-Check ist immer ein gebündelter `getAll`-Read
 *  (statt einem Read pro Karte). Für den Live-Refresh: ist `setId` bekannt
 *  (Set-Detailseite kennt ihr Set von vornherein), wird das GANZE Set in
 *  einem Bulk-Request nachgeholt (`refreshAndCacheSet`); ohne `setId`
 *  (z.B. Wunschliste — IDs aus verschiedenen Sets) bleibt der bestehende
 *  Karte-für-Karte-Fallback mit Pacing/Kappung. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const tcgIds: string[] = Array.isArray(body?.tcgIds) ? body.tcgIds.filter((x: unknown) => typeof x === 'string') : [];
  const setId: string | undefined = typeof body?.setId === 'string' ? body.setId : undefined;
  if (tcgIds.length === 0) {
    return NextResponse.json({ error: 'tcgIds required' }, { status: 400 });
  }

  const db = getAdminDb();
  const prices: Record<string, PriceResult | null> = {};

  const refs = tcgIds.map(id => db.collection('tcg_catalog').doc(id));
  const cachedById = new Map<string, CachedPrices | undefined>();
  try {
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, i) => cachedById.set(tcgIds[i], snap.data()?.prices as CachedPrices | undefined));
  } catch (e) {
    console.warn('[prices/batch] cache read error', e);
  }

  const stale: string[] = [];
  for (const tcgId of tcgIds) {
    const cached = cachedById.get(tcgId);
    if (cached && isFresh(cached)) {
      prices[tcgId] = toResult(cached);
    } else {
      stale.push(tcgId);
    }
  }

  if (stale.length > 0) {
    if (setId) {
      const refreshed = await refreshAndCacheSet(setId, stale);
      for (const tcgId of stale) prices[tcgId] = refreshed.get(tcgId) ?? null;
    } else {
      let liveRefreshes = 0;
      for (const tcgId of stale) {
        if (liveRefreshes >= MAX_LIVE_REFRESHES) {
          prices[tcgId] = null;
          continue;
        }
        prices[tcgId] = await refreshAndCache(tcgId);
        liveRefreshes++;
        await new Promise(r => setTimeout(r, LIVE_REFRESH_DELAY_MS));
      }
    }
  }

  return NextResponse.json({ prices });
}
