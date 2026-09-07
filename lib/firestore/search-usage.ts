/**
 * GLOBALER Zähler der Algolia-Suchen pro Monat (`meta/search_usage`). Das
 * Algolia-Free-Limit (10.000/Monat) gilt app-weit — also über alle Nutzer/Geräte
 * zusammen, nicht pro Nutzer. Ein gemeinsames Doc, alle eingeloggten Nutzer
 * inkrementieren (unkritischer Zähler; Worst Case = App fällt früher auf Firestore
 * zurück, kein Datenverlust). Read ist öffentlich, Write nur eingeloggt.
 */
import { doc, setDoc, getDoc, increment, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';

const REF = () => doc(db, 'meta', 'search_usage');

/** Monatsschlüssel „YYYY-MM" (lokale Zeit). */
export function usageMonthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Eine ausgeführte Algolia-Suche global zählen. Fire&forget. */
export async function recordAlgoliaSearch(): Promise<void> {
  try {
    await setDoc(REF(), { months: { [usageMonthKey()]: increment(1) }, updatedAt: serverTimestamp() }, { merge: true });
  } catch { /* Zähler ist optional */ }
}

/** Globalen Zählerstand des aktuellen Monats lesen (0 wenn keiner). */
export async function getAlgoliaUsage(): Promise<number> {
  try {
    const snap = await getDoc(REF());
    if (!snap.exists()) return 0;
    const months = (snap.data()?.months ?? {}) as Record<string, number>;
    return months[usageMonthKey()] ?? 0;
  } catch { return 0; }
}
