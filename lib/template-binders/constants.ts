import type { CardVariant, CardCondition } from '@/types';

/** National-Dex-Größe für die Pokédex-Vorlage (keine Regionsauswahl —
 *  siehe Plan „Vorlagen-Binder"). */
export const NATIONAL_DEX_TOTAL = 1025;

/** Welche Variante gewinnt einen Slot, wenn mehrere besessene Karten
 *  darauf passen (z.B. normal + Reverse Holo derselben Nummer im
 *  Master-Set)? Absteigend sortiert — erster Treffer gewinnt. Bewusst
 *  leicht änderbar: einfach die Reihenfolge umstellen, wirkt sich sofort
 *  app-weit auf alle Vorlagen-Binder aus. */
export const VARIANT_PRIORITY: CardVariant[] = [
  'alt-art', '1st-ed', 'promo', 'holo', 'reverse', 'standard',
];

/** Welcher Zustand gewinnt einen Slot, wenn mehrere besessene Karten gleicher
 *  Variante darauf passen — bester Zustand zuerst. Zweites Kriterium nach der
 *  Variante bei der Slot-Gewinner-Wahl (siehe `slot-winner.ts`). */
export const CONDITION_PRIORITY: CardCondition[] = ['NM', 'LP', 'MP', 'HP', 'Poor'];

/** Pokédex-Vorlage: zählt ein rein englisch besessener Print als „besessen"
 *  für den Dex-Slot, solange keine deutsche Karte vorhanden ist? Noch nicht
 *  final entschieden — `true` vermeidet, dass Kinder jede Karte nochmal auf
 *  Deutsch kaufen müssen, nur weil ein Scan zufällig eine EN-Karte traf.
 *  `false` würde den Slot bis zu einer echten DE-Karte als „fehlend" führen
 *  (treibt dann auch die Wunschliste). Einfach umstellen, um das globale
 *  Verhalten zu ändern. */
export const POKEDEX_SLOT_LANGUAGE_FALLBACK = true;
