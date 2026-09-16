import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { getAlgoliaAdminClient, reindexCatalogSince } from '@/lib/search/algolia-admin';

export const maxDuration = 60;

/**
 * Delta-Reindex des Algolia-Katalog-Index. Läuft NACH dem wöchentlichen
 * Katalog-Sync (vercel.json) und schiebt genau die seit dem letzten Lauf
 * geänderten/neuen Karten nach — anhand des `updatedAt`-Stempels, den `runSync`
 * setzt (Preis-Refresh/Enrich stempeln NICHT → kein unnötiger Index-Traffic).
 *
 * Wasserzeichen in `tcg_catalog_meta/algolia.lastReindexAt` (ms). Beim ERSTEN
 * Lauf (kein Wasserzeichen) wird es nur auf „jetzt" gesetzt und nichts gepusht —
 * der Grund-/Voll-Reindex läuft weiter über die Admin-Route (Settings-Button).
 *
 * GET /api/cron/algolia-reindex   (Authorization: Bearer CRON_SECRET)
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Ohne Admin-Key: sauber überspringen (kein Wasserzeichen setzen, damit ein
  // späteres Setzen der Keys sauber initialisiert).
  if (!getAlgoliaAdminClient()) {
    return NextResponse.json({ skipped: true, reason: 'Algolia nicht konfiguriert' });
  }

  const db = getAdminDb();
  const ref = db.collection('tcg_catalog_meta').doc('algolia');
  const snap = await ref.get();
  const lastReindexAt = snap.exists ? (snap.data()?.lastReindexAt as number | undefined) : undefined;

  // Erstlauf: Wasserzeichen initialisieren, nichts pushen (Index gilt als aktuell
  // aus dem letzten Voll-Reindex; ist er leer → einmal Settings-Reindex laufen).
  if (typeof lastReindexAt !== 'number') {
    const now = Date.now();
    await ref.set({ lastReindexAt: now, initializedAt: new Date().toISOString() }, { merge: true });
    console.log('[cron] algolia-reindex: Wasserzeichen initialisiert (kein Delta gepusht)');
    return NextResponse.json({ initialized: true, lastReindexAt: now });
  }

  const res = await reindexCatalogSince(lastReindexAt, { budgetMs: 50_000 });
  await ref.set({
    ...(res.watermark > lastReindexAt ? { lastReindexAt: res.watermark } : {}),
    lastRunAt: new Date().toISOString(),
    lastPushed: res.pushed,
    lastHasMore: res.hasMore,
  }, { merge: true });

  console.log(`[cron] algolia-reindex: ${res.pushed} Karten gepusht, hasMore=${res.hasMore}`);
  return NextResponse.json({ ok: true, ...res });
}
