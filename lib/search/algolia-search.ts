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
  /** Wahre Gesamttrefferzahl laut Algolia (kann > cards.length sein, wenn die
   *  Menge über `maxHits` hinaus gedeckelt wurde). */
  nbHits?: number;
  /** Anzahl Algolia-Such-Requests, die dieser Aufruf verbraucht hat (Seiten). */
  requests?: number;
}

/** Wie viele Records maximal materialisiert werden (Deckel gegen Riesen-Payloads
 *  bei sehr breiten Suchen). Deckt praktisch alle echten Suchen ab; darüber wird
 *  die wahre Gesamtzahl trotzdem via `nbHits` angezeigt. Algolia liefert je
 *  Request bis zu 1000 Hits → maxHits/1000 = max. Requests pro Suche. */
const ALGOLIA_MAX_HITS = 4000;
const ALGOLIA_PAGE_SIZE = 1000;

/** Volltext-/Facetten-Suche via Algolia. Holt die KOMPLETTE Treffermenge
 *  (mehrseitig, gedeckelt bei `ALGOLIA_MAX_HITS`), damit Facetten-Zähler,
 *  Sortierung und Gesamtzahl clientseitig über alle Treffer exakt sind.
 *  `null` = nicht konfiguriert/Fehler (Aufrufer fällt auf die bestehende Suche
 *  zurück). */
export async function searchViaAlgolia(
  query: string,
  opts: { region?: string; maxHits?: number } = {},
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
  if (opts.region) facetFilters.push(`region:${opts.region}`);

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

  const maxHits = Math.min(opts.maxHits ?? ALGOLIA_MAX_HITS, ALGOLIA_MAX_HITS);
  const commonParams = {
    query: textQuery,
    hitsPerPage: ALGOLIA_PAGE_SIZE,
    ...(facetFilters.length ? { facetFilters } : {}),
    ...(numericFilters.length ? { numericFilters } : {}),
  };
  try {
    // Erste Seite holen — liefert nbHits (wahre Gesamtzahl) + Seite 0.
    const first = await client.searchSingleIndex({
      indexName: ALGOLIA_INDEX,
      searchParams: { ...commonParams, page: 0 },
    });
    const cards = (first.hits as unknown as CatalogCard[]).map(h => ({ ...h }));
    const nbHits = first.nbHits ?? cards.length;
    let requests = 1;

    // Weitere Seiten nachladen, bis die Menge komplett (oder der Deckel erreicht)
    // ist. So sind Facetten/Sortierung/Gesamtzahl clientseitig über ALLE Treffer.
    const wanted = Math.min(nbHits, maxHits);
    for (let page = 1; cards.length < wanted; page++) {
      const res = await client.searchSingleIndex({
        indexName: ALGOLIA_INDEX,
        searchParams: { ...commonParams, page },
      });
      requests++;
      const more = (res.hits as unknown as CatalogCard[]).map(h => ({ ...h }));
      cards.push(...more);
      if (more.length === 0) break; // Sicherheitsausstieg
    }

    return { cards, processingMs: first.processingTimeMS, nbHits, requests };
  } catch {
    return null;
  }
}
