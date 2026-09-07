/**
 * Such-Adapter gegen Algolia (Prototyp). Liefert dieselbe Form wie
 * `searchCatalogCards` (`{ cards: CatalogCard[] }`), sodass die bestehende
 * UI-Pipeline (catalogCardToInfo, Facetten, Sortierung) unverändert läuft.
 * Die indexierten Records SIND das volle Katalog-Doc → Hits ≈ CatalogCard.
 */
import { getAlgoliaSearchClient, ALGOLIA_INDEX } from './algolia';
import type { CatalogCard } from '@/lib/firestore/catalog';

export interface AlgoliaSearchResult {
  cards: CatalogCard[];
  /** Roh-Timing (ms) der Algolia-Antwort (processingTimeMS) — für den Vergleich. */
  processingMs?: number;
  nbHits?: number;
}

/** Volltextsuche via Algolia. Gibt `null`, wenn nicht konfiguriert/Fehler
 *  (Aufrufer fällt dann auf die bestehende Suche zurück). */
export async function searchViaAlgolia(
  query: string,
  opts: { displayLimit?: number } = {},
): Promise<AlgoliaSearchResult | null> {
  const client = getAlgoliaSearchClient();
  if (!client) return null;
  const q = query.trim();
  if (!q) return { cards: [] };
  const hitsPerPage = Math.min(opts.displayLimit ?? 400, 1000);
  try {
    const res = await client.searchSingleIndex({
      indexName: ALGOLIA_INDEX,
      searchParams: { query: q, hitsPerPage, page: 0 },
    });
    // Hits sind die indexierten Katalog-Docs (+ objectID) → als CatalogCard nutzen.
    const cards = (res.hits as unknown as CatalogCard[]).map(h => ({ ...h }));
    return { cards, processingMs: res.processingTimeMS, nbHits: res.nbHits };
  } catch {
    return null;
  }
}
