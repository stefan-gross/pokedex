import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { getAdminDb } from '@/lib/firebase/admin';

export const maxDuration = 60;

/**
 * Einmaliges Backfill des Sortier-Namens `nameSortLower` auf bestehende
 * `tcg_catalog`-Docs: deutscher Name (klein), sonst englischer Fallback. Nötig,
 * weil das serverseitige `orderBy('nameSortLower')` im Stöbern (Sortierung
 * „Name") nur Docs sieht, die das Feld besitzen — ohne Backfill fielen alle
 * Alt-Karten aus der Ansicht. Neue Syncs schreiben das Feld künftig automatisch
 * (siehe lib/tcgdex-source.ts + lib/sync-catalog.ts).
 *
 * Zeitgeboxt + Cursor-basiert (Docs nach ID), damit die 60s-Grenze nicht reißt:
 * verarbeitet einen Block und liefert `nextAfter`/`hasMore` → wiederholt
 * aufrufen, bis `hasMore=false`.
 *
 * POST /api/admin/backfill-name-sort[?after=<docId>][&pageSize=400]
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pageSize = Math.min(Math.max(Number(req.nextUrl.searchParams.get('pageSize')) || 400, 1), 500);
  let after = req.nextUrl.searchParams.get('after')?.trim() || null;

  const db = getAdminDb();
  const col = db.collection('tcg_catalog');
  const startedAt = Date.now();
  const BUDGET_MS = Math.min(Math.max(Number(req.nextUrl.searchParams.get('budgetMs')) || 50_000, 1_000), 55_000);

  let scanned = 0, updated = 0, skipped = 0;
  let hasMore = true;

  try {
    while (Date.now() - startedAt < BUDGET_MS) {
      let q = col.orderBy('__name__').limit(pageSize);
      if (after) q = q.startAfter(after);
      const snap = await q.get();
      if (snap.empty) { hasMore = false; break; }

      const batch = db.batch();
      let writes = 0;
      for (const d of snap.docs) {
        scanned++;
        const data = d.data();
        const name = typeof data.name === 'string' ? data.name : '';
        const nameDe = typeof data.nameDe === 'string' ? data.nameDe : undefined;
        const desired = (nameDe ?? name).toLowerCase();
        if (!desired) { skipped++; continue; }
        if (data.nameSortLower !== desired) {
          batch.update(d.ref, { nameSortLower: desired }); writes++; updated++;
        } else skipped++;
      }
      if (writes > 0) await batch.commit();

      after = snap.docs[snap.docs.length - 1].id;
      if (snap.size < pageSize) { hasMore = false; break; }
    }

    return NextResponse.json({
      done: !hasMore, hasMore, nextAfter: hasMore ? after : null,
      scanned, updated, skipped, tookMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[backfill-name-sort]', err);
    return NextResponse.json({ error: String(err), nextAfter: after }, { status: 500 });
  }
}
