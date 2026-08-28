/**
 * Deck-Regel-Engine — reiner, synchroner Layer (kein I/O), damit die UI bei
 * jedem Stepper-Klick live validieren kann. Eingabe: das Rezept (DeckCardRef[])
 * + eine Map catalogId → CatalogCard (vom Aufrufer via getCatalogCardsByIds
 * geladen). Siehe Feature-Plan in .claude/plans/plan.md.
 */
import type { DeckCardRef, DeckFormat } from '@/types';
import type { CatalogCard } from '../firestore/catalog';

export const DECK_SIZE = 60;
export const MAX_COPIES = 4;

/** Basis-Energie = jede Energie-Karte, die NICHT als Spezial-Energie markiert
 *  ist. Robuste Heuristik gegen unvollständige `subtypes` (laut CatalogCard-
 *  Kommentar erst „ab nächstem Sync" voll): supertype 'Energy' + kein 'Special'.
 *  Basis-Energie ist von der 4er-Regel ausgenommen und gilt beim Besitz-Abgleich
 *  immer als vorhanden (kein Bedarf). */
export function isBasicEnergy(card: CatalogCard | undefined): boolean {
  if (!card || card.supertype !== 'Energy') return false;
  return !(card.subtypes?.includes('Special'));
}

/** Basis-Pokémon (Stufe 0) — für die „mind. 1 Basis-Pokémon"-Regel. */
export function isBasicPokemon(card: CatalogCard | undefined): boolean {
  return !!card && card.supertype === 'Pokémon' && !!card.subtypes?.includes('Basic');
}

/** Normalisierter Kartenname für die 4er-Regel: verschiedene DRUCKE derselben
 *  Karte (unterschiedliche catalogId, gleicher Name) zählen zusammen. */
export function cardNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Ist die Karte im gewählten Format legal? Primär über die Katalog-Felder
 *  `legal.standard/expanded` (vom Sync gepflegt); 'unlimited' = immer legal. */
export function isCardLegal(card: CatalogCard | undefined, format: DeckFormat): boolean {
  if (format === 'unlimited') return true;
  if (!card) return false;
  if (format === 'standard') return card.legal?.standard === true;
  if (format === 'expanded') return card.legal?.expanded === true;
  return true;
}

export type DeckRuleCode = 'count' | 'max-copies' | 'no-basic-pokemon' | 'illegal-card';

export interface DeckRuleIssue {
  code: DeckRuleCode;
  severity: 'block' | 'warn';
  message: string;
  /** Betroffene Deckkarten (catalogId) — für Hervorhebung in der UI. */
  catalogIds?: string[];
}

export interface DeckValidation {
  totalCount: number;
  /** true = keine block-Issues → Deck ist spielbar. */
  valid: boolean;
  issues: DeckRuleIssue[];
}

/** Prüft ein Deck-Rezept gegen die (harten) Baubregeln + Format-Legalität. */
export function validateDeck(
  cards: DeckCardRef[],
  byId: Map<string, CatalogCard>,
  format: DeckFormat,
): DeckValidation {
  const issues: DeckRuleIssue[] = [];
  const totalCount = cards.reduce((s, c) => s + c.count, 0);

  // 1. Genau 60 Karten.
  if (totalCount !== DECK_SIZE) {
    issues.push({ code: 'count', severity: 'block', message: `${totalCount}/${DECK_SIZE} Karten` });
  }

  // 2. Max. 4 gleiche Karte PER NAME — Basis-Energie ausgenommen.
  const byName = new Map<string, { name: string; count: number; ids: string[] }>();
  for (const ref of cards) {
    if (isBasicEnergy(byId.get(ref.catalogId))) continue;
    const key = cardNameKey(ref.name);
    const e = byName.get(key) ?? { name: ref.name, count: 0, ids: [] };
    e.count += ref.count;
    e.ids.push(ref.catalogId);
    byName.set(key, e);
  }
  for (const e of byName.values()) {
    if (e.count > MAX_COPIES) {
      issues.push({ code: 'max-copies', severity: 'block', message: `${e.name}: ${e.count}× (max. ${MAX_COPIES})`, catalogIds: e.ids });
    }
  }

  // 3. Mind. 1 Basis-Pokémon.
  if (!cards.some(c => isBasicPokemon(byId.get(c.catalogId)))) {
    issues.push({ code: 'no-basic-pokemon', severity: 'block', message: 'Kein Basis-Pokémon im Deck' });
  }

  // 4. Format-Legalität (nur Standard/Expanded).
  if (format !== 'unlimited') {
    const illegal = cards.filter(c => !isCardLegal(byId.get(c.catalogId), format));
    if (illegal.length) {
      const fmt = format === 'standard' ? 'Standard' : 'Expanded';
      issues.push({ code: 'illegal-card', severity: 'block', message: `${illegal.length} Karte(n) nicht ${fmt}-legal`, catalogIds: illegal.map(c => c.catalogId) });
    }
  }

  return { totalCount, valid: !issues.some(i => i.severity === 'block'), issues };
}
