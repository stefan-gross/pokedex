/**
 * Kreuzreaktive Facetten-Zähler via Algolia ("disjunctive faceting").
 *
 * Liefert pro Filterdimension `Wert → Anzahl` INNERHALB der aktuellen Auswahl —
 * und zwar so, dass die gerade betrachtete Dimension ihren EIGENEN Filter NICHT
 * auf sich anwendet (sonst sähe man nur den gewählten Wert). Werte mit 0 Treffern
 * liefert Algolia gar nicht erst zurück → 0-Optionen fallen automatisch weg.
 *
 * Warum Algolia statt Firestore: Firestore filtert pro Query nur EIN Feld
 * server-seitig (Composite-Index-Vermeidung), Zähler über Kombinationen (z.B.
 * "Rarity + Kartenart") bräuchten zusätzliche Indizes ODER das Laden tausender
 * Dokumente. Algolia rechnet die Facetten-Zähler nativ über den ganzen Index in
 * ein paar günstigen Requests (`hitsPerPage: 0`, nur Zähler, keine Hits).
 *
 * Owned-Filter (Vorhanden/Fehlen) ist Nutzerdaten und NICHT im Index → wird hier
 * bewusst ignoriert; der Aufrufer nutzt bei aktivem Owned-Filter den bestehenden
 * (client-/Firestore-seitigen) Zähler-Pfad.
 */
import { getAlgoliaSearchClient, ALGOLIA_INDEX } from './algolia';
import { rarityMatchValues, rarityLabelOf, SPECIAL_MECHANIC_KEYS } from '@/lib/card-constants';

/** Aktive Katalog-Filter (Owned bleibt außen vor — s. Modul-Doku). */
export interface FacetFilterState {
  setId?: string;
  supertype?: string;          // 'Pokémon' | 'Trainer' | 'Energy'
  types?: string[];            // rohe Typ-Werte (OR)
  rarityGroup?: string;        // Rarity-GRUPPEN-Label (→ rarityMatchValues)
  region?: string;
  specialMechanics?: string[]; // Subtyp-Keys (OR)
  query?: string;              // optionaler Volltext (Suchmodus)
}

export interface AlgoliaFacetCounts {
  nbHits: number;                        // Gesamttreffer unter ALLEN aktiven Filtern
  supertype: Record<string, number>;
  types: Record<string, number>;
  rarities: Record<string, number>;      // nach Rarity-GRUPPEN-Label aggregiert
  regions: Record<string, number>;       // Kartenanzahl je Region (keine Arten — kein Facet)
  sets: Record<string, number>;
  specialForms: number;                  // Treffer, wenn "Sonderformen" zusätzlich gesetzt würde
}

// Facet-Attribute im Index (app/api/admin/algolia-reindex/route.ts → INDEX_SETTINGS).
type Dim = 'supertype' | 'types' | 'rarity' | 'region' | 'setId';
const DIMS: Dim[] = ['supertype', 'types', 'rarity', 'region', 'setId'];

/** Aktive facetFilters bauen — optional OHNE die Dimension `exclude` (disjunktiv). */
function buildFacetFilters(f: FacetFilterState, exclude?: Dim | 'special'): (string | string[])[] {
  const ff: (string | string[])[] = [];
  if (exclude !== 'setId' && f.setId) ff.push(`setId:${f.setId}`);
  if (exclude !== 'supertype' && f.supertype) ff.push(`supertype:${f.supertype}`);
  if (exclude !== 'types' && f.types?.length) ff.push(f.types.map(t => `types:${t}`)); // OR über Typen
  if (exclude !== 'rarity' && f.rarityGroup) {
    const vals = rarityMatchValues(f.rarityGroup);
    if (vals.length) ff.push(vals.map(v => `rarity:${v}`)); // OR über die Rohwerte der Gruppe
  }
  if (exclude !== 'region' && f.region) ff.push(`region:${f.region}`);
  if (exclude !== 'special' && f.specialMechanics?.length) ff.push(f.specialMechanics.map(s => `subtypes:${s}`)); // OR
  return ff;
}

/** Ist die Dimension aktuell gefiltert? (→ braucht eine eigene disjunktive Query) */
function isSelected(f: FacetFilterState, dim: Dim): boolean {
  switch (dim) {
    case 'supertype': return !!f.supertype;
    case 'types':     return !!f.types?.length;
    case 'rarity':    return !!f.rarityGroup;
    case 'region':    return !!f.region;
    case 'setId':     return !!f.setId;
  }
}

/**
 * Holt die kreuzreaktiven Facetten-Zähler. `null` = Algolia nicht konfiguriert
 * oder Fehler → Aufrufer nutzt den bestehenden Zähler-Pfad.
 * `onRequests` meldet die Anzahl verbrauchter Algolia-Requests (fürs Budget).
 */
export async function getAlgoliaFacetCounts(
  f: FacetFilterState,
  onRequests?: (n: number) => void,
): Promise<AlgoliaFacetCounts | null> {
  const client = getAlgoliaSearchClient();
  if (!client) return null;

  const query = f.query?.trim() ?? '';
  const selectedDims = DIMS.filter(d => isSelected(f, d));
  const unselectedDims = DIMS.filter(d => !isSelected(f, d));

  // Requests zusammenstellen (ein Multi-Query-Batch):
  //  [0] Basis: alle Filter aktiv, Facetten für die NICHT gewählten Dimensionen
  //      (+ liefert nbHits = Gesamttreffer). Für gewählte Dimensionen wäre der
  //      Basis-Zähler degeneriert → separate disjunktive Query je gewählter Dim.
  //  [1..] je gewählter Dimension: alle Filter AUSSER dieser einen.
  //  [letzte] Sonderformen: alle Filter außer Sonderformen + Sonderform-OR → nbHits.
  const requests: Record<string, unknown>[] = [];
  const base = {
    indexName: ALGOLIA_INDEX, query, hitsPerPage: 0, maxValuesPerFacet: 300,
    facetFilters: buildFacetFilters(f), facets: unselectedDims.length ? unselectedDims : ['supertype'],
  };
  requests.push(base);
  for (const d of selectedDims) {
    requests.push({
      indexName: ALGOLIA_INDEX, query, hitsPerPage: 0, maxValuesPerFacet: 300,
      facetFilters: buildFacetFilters(f, d), facets: [d],
    });
  }
  const specialIdx = requests.length;
  requests.push({
    indexName: ALGOLIA_INDEX, query, hitsPerPage: 0,
    facetFilters: [...buildFacetFilters(f, 'special'), SPECIAL_MECHANIC_KEYS.map(s => `subtypes:${s}`)],
  });

  try {
    const { results } = await client.search(
      { requests } as Parameters<typeof client.search>[0],
    ) as { results: { facets?: Record<string, Record<string, number>>; nbHits?: number }[] };
    onRequests?.(requests.length);

    // Facetten aus allen Ergebnissen mergen: Basis zuerst, disjunktive je Dim
    // überschreiben (stehen später in der Liste).
    const facetAgg: Record<string, Record<string, number>> = {};
    for (let i = 0; i < specialIdx; i++) {
      const fac = results[i]?.facets;
      if (fac) for (const [k, v] of Object.entries(fac)) facetAgg[k] = v;
    }

    // Rarity: Rohwerte → Gruppen-Label aggregieren.
    const rarities: Record<string, number> = {};
    for (const [raw, count] of Object.entries(facetAgg.rarity ?? {})) {
      const lbl = rarityLabelOf(raw);
      rarities[lbl] = (rarities[lbl] ?? 0) + count;
    }

    return {
      nbHits: results[0]?.nbHits ?? 0,
      supertype: facetAgg.supertype ?? {},
      types: facetAgg.types ?? {},
      rarities,
      regions: facetAgg.region ?? {},
      sets: facetAgg.setId ?? {},
      specialForms: results[specialIdx]?.nbHits ?? 0,
    };
  } catch {
    return null;
  }
}
