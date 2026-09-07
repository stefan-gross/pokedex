/**
 * Such-Adapter gegen Algolia. Liefert dieselbe Form wie `searchCatalogCards`
 * (`{ cards: CatalogCard[] }`), sodass die bestehende UI-Pipeline
 * (catalogCardToInfo, Facetten, Sortierung) unverändert läuft. Die indexierten
 * Records SIND das volle Katalog-Doc → Hits ≈ CatalogCard.
 *
 * Strukturierte Schlüsselwörter (Typ „Feuer", Subtyp „ex", Kartenart, Dex-Nr.)
 * werden — wie in der bestehenden Suche — via `parseSearchQuery` abgespalten und
 * als Algolia-`facetFilters`/`numericFilters` gesetzt; der Rest ist Volltext.
 * So funktioniert „Glurak ex", „ex", „Feuer ex", „#25" auch hier.
 */
import { getAlgoliaSearchClient, ALGOLIA_INDEX } from './algolia';
import { parseSearchQuery, SUBTYPE_CATALOG_VALUES } from './query-parser';
import type { CatalogCard } from '@/lib/firestore/catalog';

export interface AlgoliaSearchResult {
  cards: CatalogCard[];
  processingMs?: number;
  nbHits?: number;
}

/** Volltext-/Facetten-Suche via Algolia. `null` = nicht konfiguriert/Fehler
 *  (Aufrufer fällt auf die bestehende Suche zurück). */
export async function searchViaAlgolia(
  query: string,
  opts: { displayLimit?: number } = {},
): Promise<AlgoliaSearchResult | null> {
  const client = getAlgoliaSearchClient();
  if (!client) return null;
  const raw = query.trim();
  if (!raw) return { cards: [] };

  const parsed = parseSearchQuery(raw);

  // Strukturierte Filter → facetFilters (Top-Level = UND, verschachtelt = ODER).
  const facetFilters: (string | string[])[] = [];
  if (parsed.types.length) facetFilters.push(parsed.types.map(t => `types:${t}`)); // ODER über Typen
  for (const st of parsed.subtypes) {
    // je Subtyp ein ODER über die Katalog-Werte (modern „ex" + alt „EX"); mehrere
    // Subtypen sind UND-verknüpft (eigene Gruppen).
    const vals = SUBTYPE_CATALOG_VALUES[st] ?? [st];
    facetFilters.push(vals.map(v => `subtypes:${v}`));
  }
  if (parsed.supertype) facetFilters.push(`supertype:${parsed.supertype}`);

  // Pokédex-Nummer („#25"/reine Zahl 1–1025) → numericFilter statt Volltext.
  const numericFilters: string[] = [];
  const effQ = parsed.hasStructured ? parsed.freeText.trim() : raw;
  const dexMatch = effQ.match(/^#?(\d{1,4})$/);
  const dexNum = dexMatch ? parseInt(dexMatch[1], 10) : null;
  let textQuery = effQ;
  if (dexNum && dexNum >= 1 && dexNum <= 1025) {
    numericFilters.push(`nationalDexNumber=${dexNum}`);
    textQuery = ''; // die Zahl nicht zusätzlich als Volltext suchen
  }

  const hitsPerPage = Math.min(opts.displayLimit ?? 400, 1000);
  try {
    const res = await client.searchSingleIndex({
      indexName: ALGOLIA_INDEX,
      searchParams: {
        query: textQuery,
        hitsPerPage,
        page: 0,
        ...(facetFilters.length ? { facetFilters } : {}),
        ...(numericFilters.length ? { numericFilters } : {}),
      },
    });
    const cards = (res.hits as unknown as CatalogCard[]).map(h => ({ ...h }));
    return { cards, processingMs: res.processingTimeMS, nbHits: res.nbHits };
  } catch {
    return null;
  }
}
