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
  /**
   * Sprachübergreifende Vervollständigung über die Pokédex-Nummer. Namens-
   * Treffer decken oft nur EINE Sprache ab (z.B. „Froxy" → nur die deutschen
   * Froakie-Karten). Englisch-only-Auflagen desselben Pokémon (z.B. das
   * McDonald's-Set `2021swsh-22`, intern nur „Froakie", ohne DE-Namen) fehlen
   * dadurch. Ist die Brücke aktiv, ziehen wir über die `nationalDexNumber` der
   * Namens-Treffer ALLE Karten derselben Art nach — egal in welcher Sprache der
   * aufgedruckte Name vorliegt. Nur bei fokussierter Suche (≤ 4 Arten) aktiv,
   * damit ein generischer Begriff die Liste nicht aufbläht.
   */
  bridgeByDex?: boolean;
}

export interface CatalogSearchResult {
  cards: CatalogCard[];
  /** Sortier-Vorschlag: bei reiner Pokédex-Nummer nach Dex-Nr. */
  sortHint?: 'pokedex';
}

/** Trifft ein einzelnes Suchwort eine Karte? (Name EN/DE, Illustrator, Nummer)
 *  — Substring-Vergleich, damit z.B. „morii" auch „Yuka Morii" trifft. */
function matchesWord(c: CatalogCard, word: string): boolean {
  const w = word.toLowerCase();
  if (
    (c.nameLower ?? c.name.toLowerCase()).includes(w) ||
    (c.nameDeLower ?? c.nameDe?.toLowerCase() ?? '').includes(w) ||
    (c.artist?.toLowerCase() ?? '').includes(w)
  ) return true;
  // Reine Zahl: Kartennummer mit/ohne führende Nullen
  if (/^\d+$/.test(w)) {
    return (c.number ?? '').replace(/^0+/, '') === w.replace(/^0+/, '');
  }
  return false;
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
  // Namenssuche NICHT server-seitig set-scopen: `searchCatalog(q, setId)` bräuchte
  // einen Composite-Index (setId + nameDeLower/nameLower-Range), der nicht
  // existiert → die Query würfe. Stattdessen ungescopet holen (bei gesetztem Set
  // eine größere Kandidatenmenge) und wie Dex-/Illustrator-Treffer client-seitig
  // auf das Set filtern.
  const byName = async (part: string) =>
    scopeToSet(await searchCatalog(part, '', setId ? candidateLimit : displayLimit));
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

  // 2. Mehrwort: jedes Wort muss (in Name ODER Illustrator) vorkommen, UND über
  //    alle Wörter. Vorgehen: pro Wort die Kandidaten (Name ∪ Illustrator) holen,
  //    dann die KLEINSTE (selektivste) Menge als Basis nehmen und in-memory
  //    prüfen, dass ALLE Wörter treffen.
  //
  //    Warum die kleinste Menge + in-memory statt Schnittmenge gekappter Server-
  //    Mengen: ein häufiges Wort (z.B. Vorname „yuka" über viele Illustratoren)
  //    läuft ins `candidateLimit` und schnitte gültige Treffer ab. Die seltenste
  //    Abfrage (z.B. ein Pokémon-Name mit ~80 Karten) ist dagegen vollständig; die
  //    übrigen Wörter werden am `artist`/`name`-Feld der Karte selbst geprüft —
  //    limit-unabhängig. So findet „Glurak Yuka Morii" die Glurak-Karten von Yuka
  //    Morii, und „Yuka Morii" liefert alle Yuka-Morii-Karten (korrekte Set-Zähler).
  if (hits.length === 0 && words.length > 1 && words.length <= 6 && words.every(w => w.length >= minLen)) {
    const perWord = await Promise.all(words.map(async w => {
      const [nameHits, artistHits] = await Promise.all([byName(w), byArtist(w, candidateLimit)]);
      const map = new Map<string, CatalogCard>();
      [...nameHits, ...artistHits].forEach(c => map.set(c.id, c));
      return map;
    }));
    const base = perWord.reduce((a, b) => (b.size < a.size ? b : a));
    hits = [...base.values()].filter(c => words.every(w => matchesWord(c, w)));
  }

  // 3. Reine Illustrator-Suche (Einzelwort-Fallback)
  if (hits.length === 0 && q.length >= minLen) {
    hits = await byArtist(q, displayLimit);
  }

  // 4. Dex-Brücke: sprachübergreifend nachziehen (siehe `bridgeByDex`-Doc). Nur
  //    wenn es Namens-/Illustrator-Treffer gibt und NICHT bereits eine reine
  //    Dex-Suche lief (die ist schon vollständig). ≤ 4 Arten = fokussierte Suche.
  if (opts.bridgeByDex && hits.length > 0 && !dexNum) {
    const dexNums = [...new Set(hits.map(c => c.nationalDexNumber).filter((n): n is number => typeof n === 'number'))];
    if (dexNums.length > 0 && dexNums.length <= 4) {
      const seen = new Set(hits.map(c => c.id));
      // Pro Art gedeckelt (nicht `candidateLimit`): ein häufiges Pokémon wie
      // Pikachu hat >150 Karten — ungedeckelt würde die Brücke bei jedem
      // Tastendruck hunderte Reads auslösen. Die Anzeige kappt ohnehin früher.
      const perDex = Math.min(candidateLimit, 120);
      const bridged = scopeToSet(
        (await Promise.all(dexNums.map(n => getCardsByDexNumber(n, perDex)))).flat(),
      );
      // Namens-Treffer bleiben vorne; nur die zusätzlich gefundenen anhängen.
      for (const c of bridged) if (!seen.has(c.id)) { seen.add(c.id); hits.push(c); }
    }
  }

  return { cards: hits };
}
