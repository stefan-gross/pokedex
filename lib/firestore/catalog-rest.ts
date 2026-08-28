/**
 * REST-API-Variante der Catalog-Lookups — siehe `rest-shared.ts` für den
 * Hintergrund (WebSocket-Cold-Start-Workaround). `tcg_catalog` ist public-read
 * (`allow read: if true`), Auth-Header ist hier also optional/unbenutzt.
 * Für private Collections (cards/binders/wishlists) siehe die analogen
 * `*-rest.ts`-Dateien, die dasselbe `runFirestoreQuery` mit Auth-Token nutzen.
 */

import { BROWSE_SORT_FIELD, type BrowseFilter, type BrowseSortKey, type CatalogCard } from './catalog';
import { runFirestoreQuery, runFirestoreCount, DOC_PATH_BASE } from './rest-shared';

const runQuery = (structuredQuery: Record<string, unknown>) => runFirestoreQuery<CatalogCard>(structuredQuery);

const docRef = (id: string) => ({ referenceValue: `${DOC_PATH_BASE}/tcg_catalog/${id}` });

/** REST-Variante von getCardBySetCodeAndNumber (catalog.ts). */
export async function getCardBySetCodeAndNumberRest(
  setCode: string,
  number: string,
): Promise<CatalogCard | null> {
  const results = await runQuery({
    from: [{ collectionId: 'tcg_catalog' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'setCode' }, op: 'EQUAL', value: { stringValue: setCode } } },
          { fieldFilter: { field: { fieldPath: 'number'  }, op: 'EQUAL', value: { stringValue: number  } } },
        ],
      },
    },
    limit: 1,
  });
  return results[0] ?? null;
}

/** REST-Variante: exakte Karte über Set-ID + Nummer (für den printedTotal→Set→
 *  Karte-Pfad im Scanner, wenn kein Set-Kürzel gelesen wurde). */
export async function getCardBySetAndNumberRest(
  setId: string,
  number: string,
): Promise<CatalogCard | null> {
  const results = await runQuery({
    from: [{ collectionId: 'tcg_catalog' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'setId'  }, op: 'EQUAL', value: { stringValue: setId  } } },
          { fieldFilter: { field: { fieldPath: 'number' }, op: 'EQUAL', value: { stringValue: number } } },
        ],
      },
    },
    limit: 1,
  });
  return results[0] ?? null;
}

/** REST-Variante von getCardsByDexNumber (catalog.ts). */
export async function getCardsByDexNumberRest(
  dexNum: number,
  maxResults = 100,
): Promise<CatalogCard[]> {
  return runQuery({
    from: [{ collectionId: 'tcg_catalog' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'nationalDexNumber' },
        op: 'EQUAL',
        value: { integerValue: String(dexNum) },
      },
    },
    limit: maxResults,
  });
}

/** Lookup über (Name × Number) — Fallback wenn setCode UND dex fehlen.
 *  Sucht parallel auf nameLower (EN) und nameDeLower (DE), dedupliziert per id. */
export async function getCardsByNameAndNumberRest(
  name: string,
  number: string,
  maxResults = 20,
): Promise<CatalogCard[]> {
  const nameLower = name.trim().toLowerCase();
  if (!nameLower || !number) return [];

  const queryFor = (field: 'nameLower' | 'nameDeLower') => runQuery({
    from: [{ collectionId: 'tcg_catalog' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: field    }, op: 'EQUAL', value: { stringValue: nameLower } } },
          { fieldFilter: { field: { fieldPath: 'number' }, op: 'EQUAL', value: { stringValue: number    } } },
        ],
      },
    },
    limit: maxResults,
  });

  const [a, b] = await Promise.all([queryFor('nameLower'), queryFor('nameDeLower')]);
  const seen = new Set<string>();
  const merged: CatalogCard[] = [];
  for (const c of [...a, ...b]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    merged.push(c);
  }
  return merged;
}

/* ── Browse (REST-Variante von catalog.ts) ──────────────────────────────────
 * Umgeht den Firestore-Web-SDK-WebChannel-Cold-Start (10–30 s auf iOS-PWA), der
 * beim Öffnen der Suche / Umschalten der Sortierung als „Hänger" spürbar war.
 * `tcg_catalog` ist public-read → kein Auth nötig, ein simpler HTTPS-Call.
 * Cursor: die zuletzt geladene Karte (statt SDK-QueryDocumentSnapshot). */

/** Server-seitiger `where`-Filter — gleiche Priorität wie im SDK (`browseCatalog`):
 *  setId > types > type > rarity > specialMechanics > evolutionStage > supertype.
 *  null = kein Filter (ungefilterter „Alle"-Browse mit server-`orderBy`). */
function browseWhere(f: BrowseFilter): Record<string, unknown> | null {
  const eq        = (field: string, v: string) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL',              value: { stringValue: v } } });
  const arrAny    = (field: string, vs: string[]) => ({ fieldFilter: { field: { fieldPath: field }, op: 'ARRAY_CONTAINS_ANY', value: { arrayValue: { values: vs.map(v => ({ stringValue: v })) } } } });
  const arrHas    = (field: string, v: string) => ({ fieldFilter: { field: { fieldPath: field }, op: 'ARRAY_CONTAINS',     value: { stringValue: v } } });
  const inOp      = (field: string, vs: string[]) => ({ fieldFilter: { field: { fieldPath: field }, op: 'IN',                value: { arrayValue: { values: vs.map(v => ({ stringValue: v })) } } } });
  if (f.setId)                    return eq('setId', f.setId);
  if (f.types?.length)            return arrAny('types', f.types.slice(0, 30));
  if (f.type)                     return arrHas('types', f.type);
  if (f.rarityKeys?.length)       return inOp('rarity', f.rarityKeys.slice(0, 30));
  if (f.specialMechanics?.length) return arrAny('subtypes', f.specialMechanics.slice(0, 30));
  if (f.evolutionStage)           return arrHas('subtypes', f.evolutionStage);
  if (f.supertype)                return eq('supertype', f.supertype);
  return null;
}

/** Cursor-Wert des Sortierfelds passend typisiert (Firestore vergleicht Cursor
 *  wertbasiert; Typ muss zum gespeicherten Feld passen). */
function sortValue(field: string, v: unknown): Record<string, unknown> {
  if (field === 'nameLower') return { stringValue: String(v ?? '') };
  if (field === 'priceEur')  return { doubleValue: Number(v ?? 0) };
  return { integerValue: String(Math.trunc(Number(v ?? 0))) }; // hp, nationalDexNumber
}

export interface BrowsePageRest {
  cards: CatalogCard[];
  hasMore: boolean;
}

/** REST-Variante von `browseCatalog`. `after` = zuletzt geladene Karte (Cursor).
 *  Ohne Filter: server-`orderBy` aufs Sortierfeld (+ `__name__` als Tiebreaker);
 *  mit Filter: keine Sortierung server-seitig (wie SDK) → `__name__`-Reihenfolge,
 *  der Aufrufer sortiert client-seitig. */
export async function browseCatalogRest(
  filter: BrowseFilter,
  after: CatalogCard | null,
  pageSize: number,
  sort: BrowseSortKey,
  desc: boolean,
): Promise<BrowsePageRest> {
  const where = browseWhere(filter);
  const dir = desc ? 'DESCENDING' : 'ASCENDING';
  const q: Record<string, unknown> = { from: [{ collectionId: 'tcg_catalog' }], limit: pageSize };
  if (where) q.where = where;

  if (!where) {
    const field = BROWSE_SORT_FIELD[sort];
    q.orderBy = [
      { field: { fieldPath: field },      direction: dir },
      { field: { fieldPath: '__name__' }, direction: dir },
    ];
    if (after) q.startAt = {
      values: [sortValue(field, (after as unknown as Record<string, unknown>)[field]), docRef(after.id)],
      before: false,
    };
  } else {
    q.orderBy = [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }];
    if (after) q.startAt = { values: [docRef(after.id)], before: false };
  }

  const cards = await runQuery(q);
  return { cards, hasMore: cards.length === pageSize };
}

/** REST-Variante von `browseUnpriced` (Karten ohne Preis, `__name__`-Reihenfolge). */
export async function browseUnpricedRest(
  after: CatalogCard | null,
  pageSize: number,
): Promise<BrowsePageRest> {
  const q: Record<string, unknown> = {
    from: [{ collectionId: 'tcg_catalog' }],
    where: { fieldFilter: { field: { fieldPath: 'hasPrice' }, op: 'EQUAL', value: { booleanValue: false } } },
    orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
    limit: pageSize,
  };
  if (after) q.startAt = { values: [docRef(after.id)], before: false };
  const cards = await runQuery(q);
  return { cards, hasMore: cards.length === pageSize };
}

/** REST-Variante von `getBrowseCount` (exakte Trefferzahl per Aggregation). */
export async function getBrowseCountRest(filter: BrowseFilter = {}): Promise<number> {
  const where = browseWhere(filter);
  const sq: Record<string, unknown> = { from: [{ collectionId: 'tcg_catalog' }] };
  if (where) sq.where = where;
  try { return await runFirestoreCount(sq); } catch { return -1; }
}

/** REST-Variante von `getCatalogCardsByIds` — Chunks à 30 (`__name__ IN`), parallel. */
export async function getCatalogCardsByIdsRest(ids: string[]): Promise<CatalogCard[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const results = await Promise.all(chunks.map(chunk => runQuery({
    from: [{ collectionId: 'tcg_catalog' }],
    where: { fieldFilter: { field: { fieldPath: '__name__' }, op: 'IN', value: { arrayValue: { values: chunk.map(docRef) } } } },
  })));
  return results.flat();
}

/** National-Dex einer Art über ihren deutschen ODER englischen Namen. Für das
 *  artbewusste Namens-Gate in resolve-card (R2): „Froxy"(de)/„Froakie"(en) → 656,
 *  damit eine englisch-only-Auflage bei deutschem Scan-Namen nicht am Namens-Gate
 *  scheitert. Nur bei EINDEUTIGER Art (genau eine Dex-Nr.) zurückgegeben — sonst
 *  null (nicht raten). */
export async function getDexForNameRest(name: string): Promise<number | null> {
  const nl = name.trim().toLowerCase();
  if (nl.length < 2) return null;
  const queryFor = (field: 'nameLower' | 'nameDeLower') => runQuery({
    from: [{ collectionId: 'tcg_catalog' }],
    where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: nl } } },
    limit: 10,
  });
  const [a, b] = await Promise.all([queryFor('nameLower'), queryFor('nameDeLower')]);
  const dexes = new Set<number>();
  for (const c of [...a, ...b]) if (typeof c.nationalDexNumber === 'number') dexes.add(c.nationalDexNumber);
  return dexes.size === 1 ? [...dexes][0] : null;
}

/** Name-Präfix-Suche (Range) auf nameLower ODER nameDeLower. Für den Promo-
 *  Fallback (resolve-card R5): holt Karten derselben Art, wenn Name (Bindestrich/
 *  Suffix) und Nummer (Set-Präfix wie „XY133") nicht EXAKT gleichen — der
 *  Aufrufer filtert in-memory per Nummer-Suffix + Namens-Gegenprobe. */
export async function getCardsByNamePrefixRest(
  prefixLower: string,
  maxResults = 40,
): Promise<CatalogCard[]> {
  const p = prefixLower.trim().toLowerCase();
  if (p.length < 2) return [];
  const end = p + ''; // Unicode-Sentinel: alle Strings mit Präfix p
  const queryFor = (field: 'nameLower' | 'nameDeLower') => runQuery({
    from: [{ collectionId: 'tcg_catalog' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: p   } } },
          { fieldFilter: { field: { fieldPath: field }, op: 'LESS_THAN',             value: { stringValue: end } } },
        ],
      },
    },
    orderBy: [{ field: { fieldPath: field }, direction: 'ASCENDING' }],
    limit: maxResults,
  });

  const [a, b] = await Promise.all([queryFor('nameLower'), queryFor('nameDeLower')]);
  const seen = new Set<string>();
  const merged: CatalogCard[] = [];
  for (const c of [...a, ...b]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    merged.push(c);
  }
  return merged;
}
