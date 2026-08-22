import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { isAdminRequest } from '@/lib/admin-auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { toResult, type CachedPrices } from '@/lib/prices/cache';
import { pickTrendPrice } from '@/lib/prices/value-tier';

export const maxDuration = 60;

/**
 * Einmaliges Backfill des denormalisierten `priceEur`-Felds auf bestehende
 * `tcg_catalog`-Docs — abgeleitet aus den bereits inline gecachten `prices`.
 * Nötig, weil das serverseitige `orderBy('priceEur')` im Browse (globale
 * Preis-Sortierung) nur Docs sieht, die dieses Feld besitzen. Neue Preis-
 * Refreshes schreiben `priceEur` künftig automatisch (siehe lib/prices/cache).
 *
 * Zeitgeboxt + Cursor-basiert (Docs nach ID), damit die 60s-Grenze nicht reißt:
 * die Route verarbeitet einen Block und liefert `nextAfter`/`hasMore` zurück →
 * wiederholt aufrufen, bis `hasMore=false`.
 *
 * POST /api/admin/backfill-price-eur[?after=<docId>][&pageSize=400]
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

  let scanned = 0, updated = 0, cleared = 0, skipped = 0;
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
        const prices = data.prices as CachedPrices | undefined;
        const val = prices ? pickTrendPrice(toResult(prices)) : undefined;
        const current = typeof data.priceEur === 'number' ? data.priceEur : undefined;

        if (val != null) {
          if (current !== val) { batch.update(d.ref, { priceEur: val }); writes++; updated++; }
          else skipped++;
        } else if (current !== undefined) {
          batch.update(d.ref, { priceEur: FieldValue.delete() }); writes++; cleared++;
        } else {
          skipped++;
        }
      }
      if (writes > 0) await batch.commit();

      after = snap.docs[snap.docs.length - 1].id;
      if (snap.size < pageSize) { hasMore = false; break; }
    }

    return NextResponse.json({
      done: !hasMore, hasMore, nextAfter: hasMore ? after : null,
      scanned, updated, cleared, skipped, tookMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[backfill-price-eur]', err);
    return NextResponse.json({ error: String(err), nextAfter: after }, { status: 500 });
  }
}
