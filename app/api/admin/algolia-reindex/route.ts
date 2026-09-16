import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { ALGOLIA_INDEX } from '@/lib/search/algolia';
import { INDEX_SETTINGS, catalogDocToRecord, getAlgoliaAdminClient } from '@/lib/search/algolia-admin';

export const maxDuration = 60;

/**
 * Backfill/Reindex des Katalogs nach Algolia. Zeitgeboxt + cursor-basiert (Docs
 * nach ID) — wiederholt aufrufen, bis `hasMore=false`. Beim ersten Aufruf
 * (`after` leer) werden zusätzlich die Index-Settings gesetzt.
 *
 * POST /api/admin/algolia-reindex[?after=<docId>][&pageSize=500]
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const client = getAlgoliaAdminClient();
  if (!client) {
    return NextResponse.json({ error: 'Algolia nicht konfiguriert (APP_ID/ADMIN_KEY fehlen)' }, { status: 400 });
  }

  const pageSize = Math.min(Math.max(Number(req.nextUrl.searchParams.get('pageSize')) || 500, 1), 1000);
  let after = req.nextUrl.searchParams.get('after')?.trim() || null;

  const db = getAdminDb();
  const col = db.collection('tcg_catalog');
  const startedAt = Date.now();
  const BUDGET_MS = Math.min(Math.max(Number(req.nextUrl.searchParams.get('budgetMs')) || 50_000, 1_000), 55_000);

  let scanned = 0, indexed = 0;
  let hasMore = true;
  let settingsSet = false;

  try {
    if (!after) {
      await client.setSettings({ indexName: ALGOLIA_INDEX, indexSettings: INDEX_SETTINGS });
      settingsSet = true;
      // Nur Settings anwenden (kein Re-Scan der 21k Docs) — z.B. um allein
      // paginationLimitedTo/customRanking zu aktualisieren.
      if (req.nextUrl.searchParams.get('settingsOnly') === '1') {
        return NextResponse.json({ ok: true, settingsSet, scanned: 0, indexed: 0, hasMore: false });
      }
    }

    while (Date.now() - startedAt < BUDGET_MS) {
      let q = col.orderBy('__name__').limit(pageSize);
      if (after) q = q.startAfter(after);
      const snap = await q.get();
      if (snap.empty) { hasMore = false; break; }

      const objects = snap.docs.map(d => catalogDocToRecord(d.id, d.data()));
      await client.saveObjects({ indexName: ALGOLIA_INDEX, objects });
      scanned += snap.size;
      indexed += objects.length;

      after = snap.docs[snap.docs.length - 1].id;
      if (snap.size < pageSize) { hasMore = false; break; }
    }

    return NextResponse.json({
      done: !hasMore, hasMore, nextAfter: hasMore ? after : null,
      scanned, indexed, settingsSet, tookMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[algolia-reindex]', err);
    return NextResponse.json({ error: String(err), nextAfter: after }, { status: 500 });
  }
}
