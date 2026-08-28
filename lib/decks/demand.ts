/**
 * Besitz-Abgleich & Bedarfsberechnung für ein Deck — reiner Rechen-Layer.
 * Match über den EXAKTEN Druck (`CardDoc.tcgId === DeckCardRef.catalogId`).
 * Basis-Energie gilt immer als vorhanden (nie Bedarf). Der `missing`-Output
 * wird in Phase D4 auf WishlistItems gemappt (automatischer Bedarf).
 */
import type { DeckCardRef, CardDoc } from '@/types';
import type { CatalogCard } from '../firestore/catalog';
import { isBasicEnergy } from './rules';

export interface DeckCardOwnership {
  /** Anzahl im Deck (Soll). */
  need: number;
  /** Besessene Exemplare dieses Drucks, gekappt auf `need` (für „habe X/Y"). */
  owned: number;
  /** Rohe besessene Anzahl (ungekappt) — für Detail/Tooltip. */
  ownedRaw: number;
  /** Basis-Energie → immer als vorhanden behandelt. */
  isBasicEnergy: boolean;
}

/** Eine fehlende Karte (Grundlage für den automatischen Wunschlisten-Bedarf). */
export interface DeckDemandItem {
  catalogId: string;
  name: string;
  setId: string;
  number: string;
  missing: number;
}

export interface DeckDemand {
  perCard: Map<string, DeckCardOwnership>;
  /** Σ min(need, owned) inkl. Basis-Energie (die immer voll zählt) → „habe X/60". */
  ownedTotal: number;
  /** Σ need über alle Deckkarten (= Deck-Gesamtzahl). */
  neededTotal: number;
  /** Fehlende Karten (ohne Basis-Energie), aggregiert je Druck. */
  missing: DeckDemandItem[];
}

export function computeDeckDemand(
  cards: DeckCardRef[],
  byId: Map<string, CatalogCard>,
  ownedCards: CardDoc[],
): DeckDemand {
  // Besitz je exaktem Druck (tcgId) aufsummieren.
  const ownedByTcgId = new Map<string, number>();
  for (const c of ownedCards) {
    if (!c.tcgId) continue;
    ownedByTcgId.set(c.tcgId, (ownedByTcgId.get(c.tcgId) ?? 0) + (c.quantity ?? 1));
  }

  const perCard = new Map<string, DeckCardOwnership>();
  const missing: DeckDemandItem[] = [];
  let ownedTotal = 0;
  let neededTotal = 0;

  for (const ref of cards) {
    const need = ref.count;
    neededTotal += need;
    const basic = isBasicEnergy(byId.get(ref.catalogId));

    if (basic) {
      perCard.set(ref.catalogId, { need, owned: need, ownedRaw: need, isBasicEnergy: true });
      ownedTotal += need;
      continue;
    }

    const ownedRaw = ownedByTcgId.get(ref.catalogId) ?? 0;
    const owned = Math.min(need, ownedRaw);
    perCard.set(ref.catalogId, { need, owned, ownedRaw, isBasicEnergy: false });
    ownedTotal += owned;

    const miss = need - owned;
    if (miss > 0) {
      missing.push({ catalogId: ref.catalogId, name: ref.name, setId: ref.setId, number: ref.number, missing: miss });
    }
  }

  return { perCard, ownedTotal, neededTotal, missing };
}
