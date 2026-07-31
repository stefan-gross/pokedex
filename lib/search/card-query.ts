import type { CardInfo } from '@/lib/card-info';

/**
 * Reiner In-Memory-Such-Matcher über bereits geladene Karten — die gemeinsame
 * Such-Semantik für Kontexte, in denen die Kartenmenge schon im Speicher liegt
 * (z.B. die Set-Detailseite, die das ganze Set als `CardInfo[]` hält). Spiegelt
 * die Absicht der server-seitigen Suche der Suche-Seite (`collection/page.tsx`
 * `doSearch`), arbeitet aber ohne Firestore-Query:
 *
 *  - leere Eingabe → alle Karten
 *  - Mehrwort-Schnitt: JEDES Wort muss die Karte treffen (UND über Wörter)
 *  - ein Wort trifft, wenn es in **Name** (DE), **nameEn**, **Illustrator**
 *    (`artist`) oder **Nummer** (mit/ohne führende Nullen) vorkommt, oder — bei
 *    rein numerischen Wörtern — die **National-Dex-Nummer** exakt trifft.
 *
 * Damit deckt es u.a. „Morii" (Illustrator), „Knapfel Morii" (Name ∩ Illustrator)
 * und „100"/„#100" (Nummer bzw. Dex) ab.
 */
export function filterCardsByQuery<T extends CardInfo>(cards: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return cards;

  const words = q.split(/\s+/).map(w => w.replace(/^#/, '')).filter(Boolean);
  if (words.length === 0) return cards;

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

  return cards.filter(c => words.every(w => wordMatches(c, w)));
}
