import { NextRequest, NextResponse } from 'next/server';
import { isFresh, toResult, refreshAndCache, refreshAndCacheSet, type CachedPrices } from '@/lib/prices/cache';
import { getAdminDb } from '@/lib/firebase/admin';
import type { PriceResult } from '@/lib/prices/types';

export const maxDuration = 60;

/** Etwas großzügigere Pause als bei Einzelkarten-Refreshes — bei vielen
 *  Karten in Folge führt zu knappes Pacing sonst zu Timeouts/Rate-Limiting
 *  beim Anbieter (beobachtet: viele "aborted"-Fehler bei 100ms). */
const LIVE_REFRESH_DELAY_MS = 200;

/**
 * Zwei Modi (zweiphasiges, nicht-blockierendes Preis-Laden in Listen):
 *  - `mode:'cache'` (Phase 1, sofort): NUR gebündelter Cache-Read (`getAll`),
 *    kein Live-Refresh. Liefert `{ prices, stale }` — `prices` enthält auch
 *    leicht veraltete Cache-Werte (Liste zeigt sofort den letzten Stand),
 *    `stale` listet fehlende/abgelaufene IDs, die die Phase 2 nachholt.
 *  - `mode:'refresh'` (Phase 2, Hintergrund): holt die übergebenen IDs live
 *    nach. Der Client schickt kleine Chunks + paced selbst → KEINE 60er-
 *    Kappung mehr (die früher Preise „erst beim Neuöffnen" sichtbar machte).
 *    Ist `setId` gesetzt, läuft ein Set-Bulk-Request (`refreshAndCacheSet`),
 *    sonst Karte-für-Karte mit Pacing.
 * Ohne `mode` → `refresh` (Abwärtskompatibilität für Einmal-Abrufe). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const tcgIds: string[] = Array.isArray(body?.tcgIds) ? body.tcgIds.filter((x: unknown) => typeof x === 'string') : [];
  const setId: string | undefined = typeof body?.setId === 'string' ? body.setId : undefined;
  const mode: 'cache' | 'refresh' = body?.mode === 'cache' ? 'cache' : 'refresh';
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

  // Phase 1: nur Cache. Vorhandene (auch leicht veraltete) Werte sofort liefern,
  // fehlende/abgelaufene als `stale` melden — Phase 2 holt sie im Hintergrund.
  if (mode === 'cache') {
    const stale: string[] = [];
    for (const tcgId of tcgIds) {
      const cached = cachedById.get(tcgId);
      if (cached) prices[tcgId] = toResult(cached);
      if (!cached || !isFresh(cached)) stale.push(tcgId);
    }
    return NextResponse.json({ prices, stale });
  }

  // Phase 2 (refresh): nur die wirklich noch nicht frischen IDs live nachholen;
  // bereits frische Treffer direkt aus dem Cache beantworten.
  const stale: string[] = [];
  for (const tcgId of tcgIds) {
    const cached = cachedById.get(tcgId);
    if (cached && isFresh(cached)) prices[tcgId] = toResult(cached);
    else stale.push(tcgId);
  }

  if (stale.length > 0) {
    if (setId) {
      const refreshed = await refreshAndCacheSet(setId, stale);
      for (const tcgId of stale) prices[tcgId] = refreshed.get(tcgId) ?? null;
    } else {
      for (const tcgId of stale) {
        prices[tcgId] = await refreshAndCache(tcgId);
        await new Promise(r => setTimeout(r, LIVE_REFRESH_DELAY_MS));
      }
    }
  }

  return NextResponse.json({ prices });
}
