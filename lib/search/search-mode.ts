/**
 * Suchmodus (pro Gerät, localStorage): steuert, ob die Suche über Algolia oder
 * die bestehende Firestore-Suche läuft.
 *  - 'auto'      → Algolia, bis das Monats-Budget erreicht ist, dann Firestore.
 *  - 'algolia'   → immer Algolia (Fallback nur bei Fehler).
 *  - 'firestore' → immer die bestehende Suche (Kostenkontrolle / Rückbau).
 */
export type SearchMode = 'auto' | 'algolia' | 'firestore';

const KEY = 'pokedex.search.mode';

/** Monats-Budget für Algolia-Suchen (knapp unter dem Free-Limit 10.000, damit
 *  vor dem harten Limit auf Firestore umgeschaltet wird). */
export const ALGOLIA_MONTHLY_BUDGET = 9500;

export function getSearchMode(): SearchMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'algolia' || v === 'firestore' || v === 'auto') return v;
  } catch { /* ignore */ }
  return 'auto';
}

export function setSearchMode(m: SearchMode): void {
  try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
}

/** Entscheidet anhand Modus + aktuellem (globalem) Monatszähler, ob Algolia
 *  genutzt werden soll. `usage` = bekannte Algolia-Suchen diesen Monat. */
export function shouldUseAlgolia(mode: SearchMode, usage: number): boolean {
  if (mode === 'firestore') return false;
  if (mode === 'algolia') return true;
  return usage < ALGOLIA_MONTHLY_BUDGET; // 'auto'
}
