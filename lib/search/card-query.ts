import type { CardInfo } from '@/lib/card-info';
import { parseSearchQuery, matchesStructured } from '@/lib/search/query-parser';

/**
 * Reiner In-Memory-Such-Matcher über bereits geladene Karten — die gemeinsame
 * Such-Semantik für Kontexte, in denen die Kartenmenge schon im Speicher liegt
 * (z.B. die Set-Detailseite, die das ganze Set als `CardInfo[]` hält). Spiegelt
 * die Absicht der server-seitigen Suche der Suche-Seite (`collection/page.tsx`
 * `doSearch`), arbeitet aber ohne Firestore-Query:
 *
 *  - leere Eingabe → alle Karten
 *  - **Strukturierte Schlüsselwörter** (Typ „Feuer", Subtyp „ex", Kartenart) via
 *    `parseSearchQuery` — identisch zur server-seitigen Suche, damit „ex",
 *    „Glurak ex", „Feuer ex" auch hier funktionieren (nicht nur reine Namen).
 *  - Mehrwort-Schnitt über den Rest-Freitext: JEDES Wort muss die Karte treffen
 *  - ein Wort trifft, wenn es in **Name** (DE), **nameEn**, **Illustrator**
 *    (`artist`) oder **Nummer** (mit/ohne führende Nullen) vorkommt, oder — bei
 *    rein numerischen Wörtern — die **National-Dex-Nummer** exakt trifft.
 *
 * Damit deckt es u.a. „Morii" (Illustrator), „Knapfel Morii" (Name ∩ Illustrator)
 * und „100"/„#100" (Nummer bzw. Dex) ab.
 */
export function filterCardsByQuery<T extends CardInfo>(cards: T[], query: string): T[] {
  const raw = query.trim();
  if (!raw) return cards;

  // Strukturierte Schlüsselwörter (Typ/Subtyp/Kartenart) abspalten; nur der
  // Rest ist Freitext für die Name/Illustrator/Nummer-Suche.
  const parsed = parseSearchQuery(raw);
  const list = parsed.hasStructured ? cards.filter(c => matchesStructured(c, parsed)) : cards;

  const q = parsed.freeText.trim().toLowerCase();
  if (!q) return list;  // z.B. reines „ex" → nur strukturiert gefiltert

  const words = q.split(/\s+/).map(w => w.replace(/^#/, '')).filter(Boolean);
  if (words.length === 0) return list;

  const stripZeros = (s: string) => s.replace(/^0+/, '');

  const wordMatches = (c: CardInfo, w: string): boolean => {
    if (c.name.toLowerCase().includes(w)) return true;
    if (c.nameEn?.toLowerCase().includes(w)) return true;
    if (c.artist?.toLowerCase().includes(w)) return true;
    const num = c.number.toLowerCase();
    if (num.includes(w)) return true;
    const wNum = stripZeros(w);
    if (wNum && stripZeros(num).includes(wNum)) return true;
    if (/^\d+$/.test(w) && c.nationalDexNumber === parseInt(w, 10)) return true;
    return false;
  };

  const exact = list.filter(c => words.every(w => wordMatches(c, w)));
  if (exact.length > 0) return exact;

  // Tippfehler-Fallback: NUR wenn exakt 0 Treffer. Jedes Wort (ab 4 Zeichen,
  // keine reinen Zahlen) darf per Edit-Distanz ~1 Tippfehler je 4 Zeichen gegen
  // ein Token aus Name/engl. Name/Illustrator haben. So findet die getippte Zeile
  // „Mickrick Yuka Morii" die Karte „Micrick" (Distanz 1) auch ohne Autosuggest.
  // Beschränkt auf die (kleine) geladene Menge → kein Rauschen/Perf-Problem.
  const wordMatchesFuzzy = (c: CardInfo, w: string): boolean => {
    if (wordMatches(c, w)) return true;
    if (w.length < 4 || /^\d+$/.test(w)) return false;
    const maxD = Math.max(1, Math.floor(w.length / 4));
    const hitField = (text?: string) =>
      !!text && text.toLowerCase().split(/\s+/).some(tok =>
        Math.abs(tok.length - w.length) <= maxD && levBounded(w, tok, maxD) <= maxD);
    return hitField(c.name) || hitField(c.nameEn) || hitField(c.artist);
  };
  return list.filter(c => words.every(w => wordMatchesFuzzy(c, w)));
}

/** Levenshtein-Distanz mit früher Obergrenze (Abbruch, sobald > max). */
function levBounded(a: string, b: string, max: number): number {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1);
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[lb];
}
