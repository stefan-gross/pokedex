/**
 * REST-API-Variante der Catalog-Lookups — siehe `rest-shared.ts` für den
 * Hintergrund (WebSocket-Cold-Start-Workaround). `tcg_catalog` ist public-read
 * (`allow read: if true`), Auth-Header ist hier also optional/unbenutzt.
 * Für private Collections (cards/binders/wishlists) siehe die analogen
 * `*-rest.ts`-Dateien, die dasselbe `runFirestoreQuery` mit Auth-Token nutzen.
 */

import type { CatalogCard } from './catalog';
import { runFirestoreQuery } from './rest-shared';

const runQuery = (structuredQuery: Record<string, unknown>) => runFirestoreQuery<CatalogCard>(structuredQuery);

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
