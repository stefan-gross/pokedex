/**
 * SERVER-ONLY Algolia-Admin (Backfill + inkrementeller Reindex). Nutzt den
 * ALGOLIA_ADMIN_KEY (schreibberechtigt) — darf NIEMALS clientseitig importiert
 * werden. Der clientsichere Such-Client lebt getrennt in `algolia.ts`.
 *
 * Hier zentralisiert (früher dupliziert in app/api/admin/algolia-reindex):
 *  - Record-Shaping (`catalogDocToRecord`) + Größenbegrenzung
 *  - Index-Settings (`INDEX_SETTINGS`, inkl. attributesForFaceting)
 *  - inkrementeller Delta-Reindex (`reindexCatalogSince`) für den Cron
 */
import { algoliasearch, type SearchClient } from 'algoliasearch';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { ALGOLIA_INDEX } from './algolia';

const CATALOG_COL = 'tcg_catalog';

/** Detail-only Textfelder, die bei zu großen Records (Algolia-Limit 10 KB) zuerst
 *  wegfallen — für die Suche irrelevant, nur fürs Kartendetail. */
const HEAVY_FIELDS = ['attacks', 'abilities', 'weaknesses', 'resistances', 'effect', 'flavorTextDe', 'variants', 'priceHistory'];

export const INDEX_SETTINGS = {
  // Reihenfolge = Priorität. Deutscher Name zuerst (= Anzeigename), dann engl.
  searchableAttributes: ['nameDe', 'name', 'unordered(artist)', 'number', 'setName', 'setCode'],
  // Facetten für die Filter (Zähler über die GANZE Treffermenge).
  attributesForFaceting: ['searchable(setId)', 'rarity', 'supertype', 'types', 'subtypes', 'searchable(artist)', 'region'],
  // Tiebreak bei gleicher Relevanz: alphabetisch nach dt. Sortiername.
  customRanking: ['asc(nameSortLower)'],
  // Pagination-Grenze anheben (Default 1000), damit breite Suchen ihre komplette
  // Treffermenge holen können. Deckungsgleich mit ALGOLIA_MAX_HITS.
  paginationLimitedTo: 4000,
};

/** Katalog-Doc → Algolia-Record: objectID + JSON-sichere Felder, größenbegrenzt. */
export function catalogDocToRecord(id: string, data: Record<string, unknown>): Record<string, unknown> {
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
  for (const f of HEAVY_FIELDS) {
    if (new TextEncoder().encode(JSON.stringify(rec)).length <= 9500) break;
    delete rec[f];
  }
  return rec;
}

/** Admin-Client (schreibend) — `null`, wenn App-ID/Admin-Key fehlen. */
export function getAlgoliaAdminClient(): SearchClient | null {
  const appId = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID;
  const adminKey = process.env.ALGOLIA_ADMIN_KEY;
  if (!appId || !adminKey) return null;
  return algoliasearch(appId, adminKey);
}

export interface ReindexSinceResult {
  skipped: boolean;   // Algolia nicht konfiguriert → übersprungen
  pushed: number;     // Anzahl an Algolia übergebener Records
  watermark: number;  // neues Wasserzeichen (max. verarbeitetes updatedAt in ms)
  hasMore: boolean;   // weitere Delta-Docs übrig (Budget/Seite erschöpft)
}

/**
 * Inkrementeller Reindex: alle Katalog-Docs mit `updatedAt > sinceMs` (aufsteigend)
 * an Algolia übergeben. Zeitgeboxt + seitenweise; gibt das neue Wasserzeichen und
 * `hasMore` zurück, damit der Cron bei sehr großen Deltas weiterlaufen kann.
 *
 * Nur `runSync` stempelt `updatedAt` (Preis-Refresh/Enrich nicht) → das Delta
 * enthält gezielt neue/geänderte Karten, kein täglicher Preis-Traffic.
 */
export async function reindexCatalogSince(
  sinceMs: number,
  opts: { budgetMs?: number; pageSize?: number } = {},
): Promise<ReindexSinceResult> {
  const client = getAlgoliaAdminClient();
  if (!client) return { skipped: true, pushed: 0, watermark: sinceMs, hasMore: false };

  const db = getAdminDb();
  const budgetMs = Math.min(Math.max(opts.budgetMs ?? 50_000, 1_000), 55_000);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 1000, 1), 1000);
  const startedAt = Date.now();

  let cursor = Timestamp.fromMillis(sinceMs);
  let watermark = sinceMs;
  let pushed = 0;
  let hasMore = true;

  while (Date.now() - startedAt < budgetMs) {
    const snap = await db.collection(CATALOG_COL)
      .where('updatedAt', '>', cursor)
      .orderBy('updatedAt', 'asc')
      .limit(pageSize)
      .get();
    if (snap.empty) { hasMore = false; break; }

    const objects = snap.docs.map(d => catalogDocToRecord(d.id, d.data()));
    await client.saveObjects({ indexName: ALGOLIA_INDEX, objects });
    pushed += objects.length;

    const lastTs = snap.docs[snap.docs.length - 1].data().updatedAt as Timestamp | undefined;
    if (lastTs) { cursor = lastTs; watermark = lastTs.toMillis(); }
    if (snap.size < pageSize) { hasMore = false; break; }
  }

  return { skipped: false, pushed, watermark, hasMore };
}
