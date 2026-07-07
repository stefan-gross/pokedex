import { NextRequest, NextResponse } from 'next/server';
import { isFresh, toResult, refreshAndCache, type CachedPrices } from '@/lib/prices/cache';
import { getAdminDb } from '@/lib/firebase/admin';
import type { PriceResult } from '@/lib/prices/types';

export const maxDuration = 60;

/** Harte Kappung der tatsächlichen Live-Refreshes pro Aufruf — bereits
 *  frische Treffer zählen nicht dazu. Rest bleibt `null` und wird beim
 *  nächsten Aufruf der gleichen Stelle nachgeholt (z.B. erneutes Sortieren). */
const MAX_LIVE_REFRESHES = 60;
/** Etwas großzügigere Pause als bei Einzelkarten-Refreshes — bei vielen
 *  Karten in Folge führt zu knappes Pacing sonst zu Timeouts/Rate-Limiting
 *  beim Anbieter (beobachtet: viele "aborted"-Fehler bei 100ms). */
const LIVE_REFRESH_DELAY_MS = 200;

/** Batch-Variante derselben Regel wie `ensureFreshPrice` ("fehlt oder älter
 *  als die TTL → live nachholen, sonst Cache") — nur für viele Karten statt
 *  einer, mit Pacing/Kappung nur für die Karten, die tatsächlich live
 *  nachgefragt werden müssen. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const tcgIds: string[] = Array.isArray(body?.tcgIds) ? body.tcgIds.filter((x: unknown) => typeof x === 'string') : [];
  if (tcgIds.length === 0) {
    return NextResponse.json({ error: 'tcgIds required' }, { status: 400 });
  }

  const db = getAdminDb();
  const prices: Record<string, PriceResult | null> = {};
  let liveRefreshes = 0;

  for (const tcgId of tcgIds) {
    let cached: CachedPrices | undefined;
    try {
      const snap = await db.collection('tcg_catalog').doc(tcgId).get();
      cached = snap.data()?.prices as CachedPrices | undefined;
    } catch (e) {
      console.warn('[prices/batch] cache read error', tcgId, e);
    }

    if (cached && isFresh(cached)) {
      prices[tcgId] = toResult(cached);
      continue;
    }
    if (liveRefreshes >= MAX_LIVE_REFRESHES) {
      prices[tcgId] = null;
      continue;
    }
    prices[tcgId] = await refreshAndCache(tcgId);
    liveRefreshes++;
    await new Promise(r => setTimeout(r, LIVE_REFRESH_DELAY_MS));
  }

  return NextResponse.json({ prices });
}
