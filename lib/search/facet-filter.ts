import type { CardInfo } from '@/lib/card-info';
import type { TcgType } from '@/lib/hooks/useCardBrowser';
import { rarityLabelOf } from '@/lib/card-constants';

/** Owned-Filter (Alle/Vorhanden/Fehlen) — geteilt zwischen Suche- und
 *  Set-Detailseite. */
export type OwnedFilter = 'all' | 'owned' | 'missing';
export type Supertype = 'Pokémon' | 'Trainer' | 'Energy';

/** Facetten-Dimensionen — u.a. für den `skip`-Parameter der kreuzreaktiven
 *  Zähler (siehe `applyFacetFilters`). */
export type FacetDim = 'owned' | 'supertype' | 'types' | 'evolutions' | 'specialMechanics' | 'rarity';

export interface FacetState {
  ownedFilter: OwnedFilter;
  activeSupertype: Supertype | 'all';
  activeTypes: Set<TcgType>;
  activeEvolutions: Set<string>;
  activeSpecialMechanics: Set<string>;
  activeRarity: string | null;
  ownedIds: Set<string>;
}

/**
 * Wendet alle aktiven Filter außer `skip` an — Basis für die kreuzreaktiven
 * Zähler: um zu wissen, wie viele Treffer eine Filter-OPTION selbst hätte, muss
 * man sie aus der eigenen Berechnung ausschließen (sonst würde z.B. die gerade
 * aktive Rarity immer 100% der gefilterten Menge zeigen).
 *
 * Rein client-seitig über `CardInfo[]` — geteilt zwischen Suche-Seite
 * (`collection/page.tsx`) und Set-Detailseite. Zuvor eine lokale Kopie in
 * `collection/page.tsx`.
 */
export function applyFacetFilters(cards: CardInfo[], f: FacetState, skip?: FacetDim): CardInfo[] {
  let r = cards;
  if (skip !== 'owned') {
    if (f.ownedFilter === 'owned')   r = r.filter(c => f.ownedIds.has(c.id));
    if (f.ownedFilter === 'missing') r = r.filter(c => !f.ownedIds.has(c.id));
  }
  if (skip !== 'supertype' && f.activeSupertype !== 'all') {
    r = r.filter(c => c.supertype?.toLowerCase() === f.activeSupertype.toLowerCase());
  }
  if (skip !== 'types' && f.activeTypes.size > 0) {
    r = r.filter(c => c.types?.some(t => f.activeTypes.has(t as TcgType)));
  }
  if (skip !== 'evolutions' && f.activeEvolutions.size > 0) {
    r = r.filter(c => c.subtypes?.some(s => f.activeEvolutions.has(s)));
  }
  if (skip !== 'specialMechanics' && f.activeSpecialMechanics.size > 0) {
    r = r.filter(c => c.subtypes?.some(s => f.activeSpecialMechanics.has(s)));
  }
  if (skip !== 'rarity' && f.activeRarity) {
    r = r.filter(c => rarityLabelOf(c.rarity) === f.activeRarity);
  }
  return r;
}
