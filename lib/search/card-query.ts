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

  return list.filter(c => words.every(w => wordMatches(c, w)));
}
