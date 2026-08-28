/**
 * Deck-Statistiken — reiner Rechen-Layer (kein I/O). Eingabe: Rezept + Katalog-
 * Map. Preis/Legalität kommen frisch aus dem Katalog (nie aus DeckCardRef).
 */
import type { DeckCardRef } from '@/types';
import type { CatalogCard } from '../firestore/catalog';
import { trendFromCached } from '../prices/trend-from-cached';
import { isBasicPokemon } from './rules';

export interface DeckStats {
  total: number;
  byCategory: { pokemon: number; trainer: number; energy: number; other: number };
  /** EN-Typname → Anzahl (über Pokémon-Karten, × Deck-Anzahl). */
  byType: Record<string, number>;
  basicPokemonCount: number;
  /** Energiekosten-Länge einer Attacke → Anzahl solcher Attacken (× Deck-Anzahl). */
  energyCostHistogram: Record<number, number>;
  /** Grober Gesamtwert in € (Trendpreis × Anzahl; fehlende Preise = 0). */
  totalValueEur: number;
}

function unitPrice(card: CatalogCard | undefined): number {
  if (!card) return 0;
  return card.priceEur ?? trendFromCached(card.prices) ?? 0;
}

export function computeDeckStats(cards: DeckCardRef[], byId: Map<string, CatalogCard>): DeckStats {
  const stats: DeckStats = {
    total: 0,
    byCategory: { pokemon: 0, trainer: 0, energy: 0, other: 0 },
    byType: {},
    basicPokemonCount: 0,
    energyCostHistogram: {},
    totalValueEur: 0,
  };

  for (const ref of cards) {
    const n = ref.count;
    stats.total += n;
    const card = byId.get(ref.catalogId);
    const supertype = card?.supertype ?? ref.supertype;

    // Kategorie
    if (supertype === 'Pokémon') stats.byCategory.pokemon += n;
    else if (supertype === 'Trainer') stats.byCategory.trainer += n;
    else if (supertype === 'Energy') stats.byCategory.energy += n;
    else stats.byCategory.other += n;

    // Typ-Verteilung (nur Pokémon)
    if (supertype === 'Pokémon' && card?.types?.length) {
      for (const t of card.types) stats.byType[t] = (stats.byType[t] ?? 0) + n;
    }

    // Basis-Pokémon
    if (isBasicPokemon(card)) stats.basicPokemonCount += n;

    // Energiekosten-Histogramm (je Attacke, × Deck-Anzahl)
    if (card?.attacks?.length) {
      for (const atk of card.attacks) {
        const cost = atk.cost?.length ?? 0;
        stats.energyCostHistogram[cost] = (stats.energyCostHistogram[cost] ?? 0) + n;
      }
    }

    // Wert
    stats.totalValueEur += unitPrice(card) * n;
  }

  return stats;
}
