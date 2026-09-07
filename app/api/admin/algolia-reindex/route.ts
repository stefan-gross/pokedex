import { NextRequest, NextResponse } from 'next/server';
import { algoliasearch } from 'algoliasearch';
import { isAdminRequest } from '@/lib/admin-auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { ALGOLIA_INDEX } from '@/lib/search/algolia';

export const maxDuration = 60;

/** Detail-only Textfelder, die bei zu großen Records (Algolia-Limit 10 KB) zuerst
 *  wegfallen — für die Suche irrelevant, nur fürs Kartendetail. */
const HEAVY_FIELDS = ['attacks', 'abilities', 'weaknesses', 'resistances', 'effect', 'flavorTextDe', 'variants', 'priceHistory'];

/** Katalog-Doc → Algolia-Record: objectID + JSON-sichere Felder, größenbegrenzt. */
function toRecord(id: string, data: Record<string, unknown>): Record<string, unknown> {
  // Firestore-Timestamps o.ä. (haben toMillis) → Zahl; sonst 1:1 übernehmen.
  const rec: Record<string, unknown> = { objectID: id };
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue;
    if (typeof v === 'object' && v !== null && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
      rec[k] = (v as { toMillis: () => number }).toMillis();
    } else {
      rec[k] = v;
    }
  }
  // Größe begrenzen: heavy (detail-only) Felder abwerfen, bis < ~9.5 KB.
  for (const f of HEAVY_FIELDS) {
    if (new TextEncoder().encode(JSON.stringify(rec)).length <= 9500) break;
    delete rec[f];
  }
  return rec;
}

const INDEX_SETTINGS = {
  // Reihenfolge = Priorität. Deutscher Name zuerst (= Anzeigename), dann engl.
  searchableAttributes: ['nameDe', 'name', 'unordered(artist)', 'number', 'setName', 'setCode'],
  // Facetten für die Filter (Zähler über die GANZE Treffermenge).
  attributesForFaceting: ['searchable(setId)', 'rarity', 'supertype', 'types', 'subtypes', 'searchable(artist)'],
  // Tiebreak bei gleicher Relevanz: alphabetisch nach dt. Sortiername.
  customRanking: ['asc(nameSortLower)'],
};

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
  const appId = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID;
  const adminKey = process.env.ALGOLIA_ADMIN_KEY;
  if (!appId || !adminKey) {
    return NextResponse.json({ error: 'Algolia nicht konfiguriert (APP_ID/ADMIN_KEY fehlen)' }, { status: 400 });
  }

  const pageSize = Math.min(Math.max(Number(req.nextUrl.searchParams.get('pageSize')) || 500, 1), 1000);
  let after = req.nextUrl.searchParams.get('after')?.trim() || null;

  const client = algoliasearch(appId, adminKey);
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
    }

    while (Date.now() - startedAt < BUDGET_MS) {
      let q = col.orderBy('__name__').limit(pageSize);
      if (after) q = q.startAfter(after);
      const snap = await q.get();
      if (snap.empty) { hasMore = false; break; }

      const objects = snap.docs.map(d => toRecord(d.id, d.data()));
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
