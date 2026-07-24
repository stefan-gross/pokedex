import type { CardDoc } from '@/types';
import type { CatalogCard } from '@/lib/firestore/catalog';
import type { TemplateSlot } from './resolve';
import { VARIANT_PRIORITY, CONDITION_PRIORITY, POKEDEX_SLOT_LANGUAGE_FALLBACK } from './constants';

export interface SlotResolution {
  key: string;
  order: number;
  /** CardDoc-Id, die den Slot belegt, oder null wenn (noch) keine besessene
   *  Karte passt. */
  winnerCardId: string | null;
  /** Andere besessene CardDoc-Ids, die auf denselben Slot passen würden,
   *  aber verloren haben (z.B. die normale Karte, wenn eine Reverse Holo
   *  derselben Nummer gewinnt) — wandern nach „Meine Sammlung". */
  loserCardIds: string[];
  /** Katalog-Eintrag für den Platzhalter, wenn der Slot leer ist. */
  missingCatalog: CatalogCard | null;
}

/** Reine Funktion, keine Firestore-Calls — pro Slot wird aus den besessenen
 *  Karten, die zum Slot passen, EINE Gewinner-Karte bestimmt (Varianten-
 *  Priorität → deutsche Sprache als Tie-Break → älteste zuerst hinzugefügt
 *  für stabile Ergebnisse bei wiederholtem Sync). Alle anderen passenden
 *  Karten sind „Verlierer" und müssen vom Aufrufer nach „Meine Sammlung"
 *  verschoben werden.
 *
 *  `languageAware` gilt nur für Pokédex/Evolutionslinie (Slot = Dex-Nummer,
 *  viele mögliche Drucke): wenn `POKEDEX_SLOT_LANGUAGE_FALLBACK` false ist,
 *  zählt ein rein englisch besessener Druck dort NICHT als „besessen". */
export function resolveSlotWinners(
  slots: TemplateSlot[],
  ownedCards: CardDoc[],
  opts: { languageAware?: boolean } = {},
): SlotResolution[] {
  const ownedByTcgId = new Map<string, CardDoc[]>();
  for (const c of ownedCards) {
    if (!c.tcgId) continue;
    const arr = ownedByTcgId.get(c.tcgId);
    if (arr) arr.push(c); else ownedByTcgId.set(c.tcgId, [c]);
  }

  return slots.map(slot => {
    let candidates: CardDoc[] = [];
    for (const cc of slot.catalog) {
      const owned = ownedByTcgId.get(cc.id);
      if (owned) candidates.push(...owned);
    }

    if (opts.languageAware && !POKEDEX_SLOT_LANGUAGE_FALLBACK) {
      candidates = candidates.filter(c => c.language === 'de');
    }

    if (candidates.length === 0) {
      const missingCatalog = slot.catalog.find(c => c.nameDe && c.imgSmallDe) ?? slot.catalog[0] ?? null;
      return { key: slot.key, order: slot.order, winnerCardId: null, loserCardIds: [], missingCatalog };
    }

    // Rang-Reihenfolge: Variante → Zustand → Sprache (de) → ältestes zuerst
    // (stabil gegen unnötiges Tauschen bei wiederholtem Sync). Unbekannte
    // Werte (indexOf === -1) landen hinten statt vorne.
    const rank = (list: readonly string[], v: string) => {
      const i = list.indexOf(v);
      return i === -1 ? list.length : i;
    };
    const sorted = [...candidates].sort((a, b) => {
      const va = rank(VARIANT_PRIORITY, a.variant);
      const vb = rank(VARIANT_PRIORITY, b.variant);
      if (va !== vb) return va - vb;
      const ca = rank(CONDITION_PRIORITY, a.condition);
      const cb = rank(CONDITION_PRIORITY, b.condition);
      if (ca !== cb) return ca - cb;
      const la = a.language === 'de' ? 0 : 1;
      const lb = b.language === 'de' ? 0 : 1;
      if (la !== lb) return la - lb;
      return a.addedAt.toMillis() - b.addedAt.toMillis();
    });

    const [winner, ...losers] = sorted;
    return {
      key: slot.key,
      order: slot.order,
      winnerCardId: winner.id,
      loserCardIds: losers.map(c => c.id),
      missingCatalog: null,
    };
  });
}
