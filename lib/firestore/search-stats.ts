/**
 * Such-Nutzungszähler (pro Nutzer, monatlich). Zweck: die reale Zahl der
 * ausgeführten Suchen sichtbar machen — u.a. um abzuschätzen, ob das Free-Limit
 * einer externen Such-Engine (z.B. Algolia: 10.000 Suchen/Monat) reicht, BEVOR
 * man wechselt. Owner-gescopt wie `scan_stats` (Doc-ID == uid).
 *
 * Ein atomarer Merge-Write pro ausgeführter (entprellter) Suche — für eine
 * Familien-PWA vernachlässigbar. Zählt eine *fertige* Suche, nicht jeden
 * Tastendruck; bei einer echten Engine mit „search as you type" liegt die
 * tatsächliche Request-Zahl höher (Faktor ~Wortlänge) — im UI als Hinweis.
 */
import { doc, setDoc, getDoc, increment, serverTimestamp } from 'firebase/firestore';
import { db, currentUid } from '@/lib/firebase/client';

const COL = 'search_stats';

/** Monatsschlüssel „YYYY-MM" (lokale Zeit). */
export function searchMonthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Eine ausgeführte Suche zählen (monatlicher Bucket + Gesamt). Fehler ignorieren. */
export async function recordSearch(): Promise<void> {
  try {
    const uid = currentUid();
    if (!uid) return;
    await setDoc(
      doc(db, COL, uid),
      {
        ownerUid: uid,
        total: increment(1),
        months: { [searchMonthKey()]: increment(1) },
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch { /* Statistik ist optional */ }
}

export interface SearchStats {
  total: number;
  months: Record<string, number>;
}

/** Eigene Such-Statistik lesen (aktueller Nutzer). */
export async function getSearchStats(): Promise<SearchStats | null> {
  try {
    const uid = currentUid();
    if (!uid) return null;
    const snap = await getDoc(doc(db, COL, uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      total: typeof d.total === 'number' ? d.total : 0,
      months: (d.months ?? {}) as Record<string, number>,
    };
  } catch { return null; }
}
