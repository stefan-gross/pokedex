/**
 * Testhand — reiner Rechen-Layer. Expandiert das Rezept zu N Einzelkarten,
 * mischt (Fisher-Yates) und zieht 7. Mulligan-Regel: keine Basis-Pokémon-Karte
 * in der Starthand. `rng` injizierbar für Tests (Default Math.random).
 */
import type { DeckCardRef } from '@/types';
import type { CatalogCard } from '../firestore/catalog';
import { isBasicPokemon } from './rules';

export const OPENING_HAND_SIZE = 7;

export interface TestHandResult {
  /** Gezogene Karten als catalogIds. */
  hand: string[];
  /** true = keine Basis-Pokémon-Karte in der Hand → Mulligan nötig. */
  mulligan: boolean;
}

/** Rezept → flaches Array aus catalogIds (count-fach). */
export function expandDeck(cards: DeckCardRef[]): string[] {
  const out: string[] = [];
  for (const ref of cards) for (let i = 0; i < ref.count; i++) out.push(ref.catalogId);
  return out;
}

export function drawTestHand(
  cards: DeckCardRef[],
  byId: Map<string, CatalogCard>,
  rng: () => number = Math.random,
): TestHandResult {
  const deck = expandDeck(cards);
  // Fisher-Yates (nur bis Position 7 nötig, aber voll ist simpel + korrekt).
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const hand = deck.slice(0, OPENING_HAND_SIZE);
  const mulligan = !hand.some(id => isBasicPokemon(byId.get(id)));
  return { hand, mulligan };
}
