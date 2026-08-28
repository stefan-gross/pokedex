/**
 * REST-API-Variante der Catalog-Lookups — siehe `rest-shared.ts` für den
 * Hintergrund (WebSocket-Cold-Start-Workaround). `tcg_catalog` ist public-read
 * (`allow read: if true`), Auth-Header ist hier also optional/unbenutzt.
 * Für private Collections (cards/binders/wishlists) siehe die analogen
 * `*-rest.ts`-Dateien, die dasselbe `runFirestoreQuery` mit Auth-Token nutzen.
 */

import { BROWSE_SORT_FIELD, type BrowseFilter, type BrowseSortKey, type CatalogCard, type FilterCounts } from './catalog';
import { RARITY_GROUPS, SPECIAL_MECHANIC_KEYS, rarityMatchValues } from '../card-constants';
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

/** REST-Variante von `searchCatalog` (Prefix-Namenssuche EN+DE, gemerged). */
export async function searchCatalogRest(q: string, setId = '', maxResults = 300): Promise<CatalogCard[]> {
  const lower = q.toLowerCase();
  if (!lower) return [];
  const end = lower + ''; // Unicode-Sentinel: alle Strings mit Präfix `lower`
  const queryFor = (field: 'nameLower' | 'nameDeLower') => {
    const range = [
      { fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: lower } } },
      { fieldFilter: { field: { fieldPath: field }, op: 'LESS_THAN_OR_EQUAL',    value: { stringValue: end   } } },
    ];
    const filters = setId
      ? [{ fieldFilter: { field: { fieldPath: 'setId' }, op: 'EQUAL', value: { stringValue: setId } } }, ...range]
      : range;
    return runQuery({
      from: [{ collectionId: 'tcg_catalog' }],
      where: { compositeFilter: { op: 'AND', filters } },
      orderBy: [{ field: { fieldPath: field }, direction: 'ASCENDING' }],
      limit: maxResults,
    });
  };
  const [de, en] = await Promise.all([queryFor('nameDeLower'), queryFor('nameLower')]);
  const byId = new Map<string, CatalogCard>();
  for (const c of [...de, ...en]) if (!byId.has(c.id)) byId.set(c.id, c);
  return [...byId.values()].slice(0, maxResults);
}

/** REST-Variante von `searchCatalogByArtist` (Illustrator-Wortsuche). */
export async function searchCatalogByArtistRest(q: string, maxResults = 300): Promise<CatalogCard[]> {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const docs = await runQuery({
    from: [{ collectionId: 'tcg_catalog' }],
    where: { fieldFilter: { field: { fieldPath: 'artistTokens' }, op: 'ARRAY_CONTAINS_ANY', value: { arrayValue: { values: tokens.slice(0, 30).map(t => ({ stringValue: t })) } } } },
    limit: maxResults,
  });
  if (tokens.length === 1) return docs;
  return docs.filter(c => tokens.every(t => c.artistTokens?.includes(t)));
}

/** REST-Variante von `getSortableCount` — `orderBy(field)` zählt (wie im SDK)
 *  nur Docs, die das Feld besitzen. */
export async function getSortableCountRest(field: string): Promise<number> {
  try {
    return await runFirestoreCount({
      from: [{ collectionId: 'tcg_catalog' }],
      orderBy: [{ field: { fieldPath: field }, direction: 'ASCENDING' }],
    });
  } catch { return 0; }
}

/** REST-Variante von `getCatalogFilterCounts` (Typ-/Supertype-/Rarity-/Sonderform-
 *  Zähler per Aggregation, parallel). */
export async function getCatalogFilterCountsRest(activeFilter: BrowseFilter = {}): Promise<FilterCounts> {
  const TYPES = ['Fire', 'Water', 'Grass', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless'];
  const SUPERTYPES = ['Pokémon', 'Trainer', 'Energy'];

  const arrHas = (field: string, v: string) => ({ fieldFilter: { field: { fieldPath: field }, op: 'ARRAY_CONTAINS', value: { stringValue: v } } });
  const eq     = (field: string, v: string) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL',          value: { stringValue: v } } });
  const arrAny = (field: string, vs: string[]) => ({ fieldFilter: { field: { fieldPath: field }, op: 'ARRAY_CONTAINS_ANY', value: { arrayValue: { values: vs.map(v => ({ stringValue: v })) } } } });
  const inOp   = (field: string, vs: string[]) => ({ fieldFilter: { field: { fieldPath: field }, op: 'IN',           value: { arrayValue: { values: vs.map(v => ({ stringValue: v })) } } } });

  const countWhere = async (filters: Record<string, unknown>[]): Promise<number> => {
    const where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } };
    try { return await runFirestoreCount({ from: [{ collectionId: 'tcg_catalog' }], where }); }
    catch { return 0; }
  };

  const [typeCounts, supertypeCounts, rarityCounts, specialForms] = await Promise.all([
    Promise.all(TYPES.map(async t => {
      const f = [arrHas('types', t)];
      if (activeFilter.supertype) f.push(eq('supertype', activeFilter.supertype));
      return [t, await countWhere(f)] as [string, number];
    })),
    Promise.all(SUPERTYPES.map(async s => {
      const f = [eq('supertype', s)];
      if (activeFilter.type) f.push(arrHas('types', activeFilter.type));
      return [s, await countWhere(f)] as [string, number];
    })),
    Promise.all(RARITY_GROUPS.map(async g => {
      const variants = rarityMatchValues(g.label);
      if (!variants.length) return [g.label, 0] as [string, number];
      return [g.label, await countWhere([inOp('rarity', variants)])] as [string, number];
    })),
    countWhere([arrAny('subtypes', [...SPECIAL_MECHANIC_KEYS])]),
  ]);

  return {
    types:        Object.fromEntries(typeCounts),
    supertypes:   Object.fromEntries(supertypeCounts),
    rarities:     Object.fromEntries(rarityCounts),
    specialForms: specialForms as number,
  };
}

/** REST-Variante von `getCardsByEvolutionFamily`. */
export async function getCardsByEvolutionFamilyRest(dexNum: number, maxResults = 200): Promise<CatalogCard[]> {
  return runQuery({
    from: [{ collectionId: 'tcg_catalog' }],
    where: { fieldFilter: { field: { fieldPath: 'evolutionFamily' }, op: 'ARRAY_CONTAINS', value: { integerValue: String(dexNum) } } },
    limit: maxResults,
  });
}

/** REST-Variante von `getCatalogCount` (Gesamtzahl aus `tcg_catalog_meta/sync`). */
export async function getCatalogCountRest(): Promise<number> {
  try {
    const rows = await runFirestoreQuery<{ syncedTotal?: number }>({
      from: [{ collectionId: 'tcg_catalog_meta' }],
      where: { fieldFilter: { field: { fieldPath: '__name__' }, op: 'EQUAL', value: { referenceValue: `${DOC_PATH_BASE}/tcg_catalog_meta/sync` } } },
      limit: 1,
    });
    return rows[0]?.syncedTotal ?? 0;
  } catch { return 0; }
}

/** Anzahl Katalog-Karten in einem Set (REST-Aggregation) — Dashboard-Fortschritt. */
export async function getSetCardCountRest(setId: string): Promise<number> {
  try {
    return await runFirestoreCount({
      from: [{ collectionId: 'tcg_catalog' }],
      where: { fieldFilter: { field: { fieldPath: 'setId' }, op: 'EQUAL', value: { stringValue: setId } } },
    });
  } catch { return -1; }
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
