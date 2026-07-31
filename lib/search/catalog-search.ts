import {
  searchCatalog, searchCatalogByArtist, getCardsByDexNumber, type CatalogCard,
} from '@/lib/firestore/catalog';

export interface CatalogSearchOptions {
  /** Vorfilterung auf ein Set — scopt Namens-, Illustrator- UND Dex-Treffer. */
  setId?: string;
  /** Max. direkt angezeigte Treffer (Default 300). */
  displayLimit?: number;
  /** Zwischenmenge für die Mehrwort-Schnittmenge (Default 1000, nie direkt angezeigt). */
  candidateLimit?: number;
  /** Mindestlänge pro Wort für Mehrwort-/Illustrator-Suche (Default 3). */
  minComboLen?: number;
}

export interface CatalogSearchResult {
  cards: CatalogCard[];
  /** Sortier-Vorschlag: bei reiner Pokédex-Nummer nach Dex-Nr. */
  sortHint?: 'pokedex';
}

/**
 * Server-seitige Katalog-Suche — die gemeinsame Such-Semantik der Suche-Seite,
 * gekapselt und **set-vorfilterbar**. Ablauf (wie zuvor inline in
 * `collection/page.tsx` `doSearch`):
 *   0. Pokédex-Nummer („#25"/reine Zahl 1–1025) → `getCardsByDexNumber`
 *   1. ganze Eingabe als Name (`searchCatalog`, DE+EN, set-scopebar)
 *   2. Mehrwort: pro Wort Name ∪ Illustrator, über alle Wörter Schnittmenge
 *   3. reine Illustrator-Suche als Einzelwort-Fallback
 *
 * NEU ggü. der alten Inline-Variante: der `setId`-Filter wirkt jetzt auch auf
 * die **Illustrator-** und **Dex-**Treffer (client-seitig gefiltert, da
 * `searchCatalogByArtist`/`getCardsByDexNumber` keinen `setId`-Query-Param haben)
 * — vorher scopte der Set-Filter nur die Namens-Treffer.
 */
export async function searchCatalogCards(
  query: string,
  opts: CatalogSearchOptions = {},
): Promise<CatalogSearchResult> {
  const q = query.trim();
  if (!q) return { cards: [] };

  const setId = opts.setId ?? '';
  const displayLimit = opts.displayLimit ?? 300;
  const candidateLimit = opts.candidateLimit ?? 1000;
  const minLen = opts.minComboLen ?? 3;

  const scopeToSet = (cards: CatalogCard[]) => (setId ? cards.filter(c => c.setId === setId) : cards);
  const byName = (part: string) => searchCatalog(part, setId, displayLimit);
  const byArtist = async (word: string, limit: number) => scopeToSet(await searchCatalogByArtist(word, limit));

  // 0. Pokédex-Nummer
  const dexMatch = q.match(/^#?(\d{1,4})$/);
  const dexNum = dexMatch ? parseInt(dexMatch[1], 10) : null;
  if (dexNum && dexNum >= 1 && dexNum <= 1025) {
    const dexHits = scopeToSet(await getCardsByDexNumber(dexNum, displayLimit));
    if (dexHits.length > 0) return { cards: dexHits, sortHint: 'pokedex' };
  }

  const words = q.split(/\s+/).filter(Boolean);

  // 1. Gesamte Eingabe als Name
  let hits = await byName(q);

  // 2. Mehrwort: pro Wort Name ∪ Illustrator, Schnittmenge über alle Wörter
  if (hits.length === 0 && words.length > 1 && words.length <= 6 && words.every(w => w.length >= minLen)) {
    const perWordMaps = await Promise.all(words.map(async w => {
      const [nameHits, artistHits] = await Promise.all([byName(w), byArtist(w, candidateLimit)]);
      const map = new Map<string, CatalogCard>();
      [...nameHits, ...artistHits].forEach(c => map.set(c.id, c));
      return map;
    }));
    let ids = new Set(perWordMaps[0].keys());
    for (const m of perWordMaps.slice(1)) ids = new Set([...ids].filter(id => m.has(id)));
    if (ids.size > 0) hits = [...ids].map(id => perWordMaps.find(m => m.has(id))!.get(id)!);
  }

  // 3. Reine Illustrator-Suche (Einzelwort-Fallback)
  if (hits.length === 0 && q.length >= minLen) {
    hits = await byArtist(q, displayLimit);
  }

  return { cards: hits };
}
