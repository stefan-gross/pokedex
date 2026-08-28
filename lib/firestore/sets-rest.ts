/**
 * REST-Variante der Set-Lookups (tcg_sets, public-read) — umgeht wie
 * `catalog-rest.ts` den Firestore-Web-SDK-WebChannel-Cold-Start. Genutzt für
 * Dashboard-Logos, /sets-Seite, Karten-Detail (setMeta) und den Scanner.
 */
import type { TcgSet } from './sets';
import { runFirestoreQuery, DOC_PATH_BASE } from './rest-shared';

const runQuery = (structuredQuery: Record<string, unknown>) => runFirestoreQuery<TcgSet>(structuredQuery);

/** REST-Variante von `getSetById`. */
export async function getSetByIdRest(setId: string): Promise<TcgSet | null> {
  if (!setId) return null;
  const rows = await runQuery({
    from: [{ collectionId: 'tcg_sets' }],
    where: { fieldFilter: { field: { fieldPath: '__name__' }, op: 'EQUAL', value: { referenceValue: `${DOC_PATH_BASE}/tcg_sets/${setId}` } } },
    limit: 1,
  });
  return rows[0] ?? null;
}

/** REST-Variante von `getAllSets` — nach releaseDate absteigend (wie SDK;
 *  `orderBy` blendet Sets ohne releaseDate aus, identisch zum SDK-Verhalten). */
export async function getAllSetsRest(): Promise<TcgSet[]> {
  return runQuery({
    from: [{ collectionId: 'tcg_sets' }],
    orderBy: [{ field: { fieldPath: 'releaseDate' }, direction: 'DESCENDING' }],
  });
}

/** REST-Variante von `getSetIdsByPrintedTotal`. */
export async function getSetIdsByPrintedTotalRest(printedTotal: number): Promise<string[]> {
  const rows = await runQuery({
    from: [{ collectionId: 'tcg_sets' }],
    where: { fieldFilter: { field: { fieldPath: 'printedTotal' }, op: 'EQUAL', value: { integerValue: String(printedTotal) } } },
  });
  return rows.map(s => s.id);
}
