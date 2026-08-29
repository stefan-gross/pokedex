/**
 * Deck-Generator-Kern (D8). Zwei Wege, beide aus demselben Kandidaten-Pool
 * (pool.ts) und beide garantiert regelkonform:
 *  - `assembleDeck`  : rein regelbasiert (Fallback + „ohne KI").
 *  - `applyAiPicks`  : nimmt Gemini-Auswahlen (Pool-Indizes), verwirft Ungültiges,
 *                      erzwingt die Regeln und repariert auf 60 (Energie auffüllen /
 *                      Übermaß kürzen / fehlendes Basis-Pokémon ergänzen).
 * Nie werden ungeprüfte LLM-Daten übernommen — jeder Eintrag ist eine Pool-Karte.
 */
import { DECK_SIZE, MAX_COPIES, isBasicEnergy, isBasicPokemon, cardNameKey } from './rules';
import type { PoolCard } from './pool';
import type { CatalogCard } from '../firestore/catalog';
import type { DeckCardRef } from '@/types';

function toRef(card: CatalogCard, count: number): DeckCardRef {
  return { catalogId: card.id, count, name: card.name, setId: card.setId, number: card.number, supertype: card.supertype };
}

/** Baut ein Deck inkrementell auf und hält dabei die harten Regeln ein
 *  (max. 4 je Name außer Basis-Energie, max. 60 gesamt). */
class DeckBuilder {
  private items = new Map<string, { card: CatalogCard; count: number }>();
  private nameCount = new Map<string, number>();

  seed(existing: DeckCardRef[], poolById: Map<string, CatalogCard>) {
    for (const ref of existing) {
      const card = poolById.get(ref.catalogId) ?? ({ id: ref.catalogId, name: ref.name, setId: ref.setId, number: ref.number, supertype: ref.supertype } as CatalogCard);
      this.items.set(ref.catalogId, { card, count: ref.count });
      if (!isBasicEnergy(card)) this.nameCount.set(cardNameKey(card.name), (this.nameCount.get(cardNameKey(card.name)) ?? 0) + ref.count);
    }
  }

  total(): number { let s = 0; for (const v of this.items.values()) s += v.count; return s; }

  /** Fügt bis zu `n` Exemplare hinzu; respektiert 4er-Regel je Name + 60er-Deck.
   *  Gibt die tatsächlich hinzugefügte Anzahl zurück. */
  add(card: CatalogCard, n: number): number {
    if (n <= 0) return 0;
    const room60 = DECK_SIZE - this.total();
    if (room60 <= 0) return 0;
    let allow = Math.min(n, room60);
    if (!isBasicEnergy(card)) {
      const key = cardNameKey(card.name);
      const already = this.nameCount.get(key) ?? 0;
      allow = Math.min(allow, MAX_COPIES - already);
      if (allow <= 0) return 0;
      this.nameCount.set(key, already + allow);
    }
    const cur = this.items.get(card.id);
    if (cur) cur.count += allow;
    else this.items.set(card.id, { card, count: allow });
    return allow;
  }

  /** Reduziert Energie (dann sonstige) bis das Deck ≤ 60 ist. */
  trimTo(size: number) {
    const order = [...this.items.values()].sort((a, b) => {
      const ae = isBasicEnergy(a.card) ? 0 : 1, be = isBasicEnergy(b.card) ? 0 : 1;
      return ae - be;   // Energie zuerst reduzieren
    });
    let over = this.total() - size;
    for (const it of order) {
      if (over <= 0) break;
      const cut = Math.min(over, it.count);
      it.count -= cut; over -= cut;
      if (it.count === 0) this.items.delete(it.card.id);
    }
  }

  hasBasicPokemon(): boolean { return [...this.items.values()].some(v => isBasicPokemon(v.card)); }

  refs(): DeckCardRef[] { return [...this.items.values()].filter(v => v.count > 0).map(v => toRef(v.card, v.count)); }
}

// Regelbasierte Zielmengen je Trainer-Staple + Evolutionsstufe.
const STAPLE_COUNTS: Record<string, number> = {
  "Professor's Research": 4, 'Iono': 3, "Boss's Orders": 2,
  'Ultra Ball': 4, 'Nest Ball': 3, 'Switch': 2, 'Rare Candy': 4,
};
const STAGE_COUNTS = [4, 2, 3];   // Basis / Stufe 1 / Stufe 2

export interface GenerateOpts {
  existing?: DeckCardRef[];
  /** Pool-Karten (mit Index-Position wie an Gemini gesendet). */
  pool: PoolCard[];
}

function poolMaps(pool: PoolCard[]) {
  const byId = new Map(pool.map(p => [p.card.id, p.card]));
  const energy = pool.filter(p => p.role === 'energy').map(p => p.card);
  return { byId, energy };
}

/** Füllt bis 60 mit Basis-Energie aus dem Pool auf (Fallback ohne: nichts). */
function fillWithEnergy(b: DeckBuilder, energy: CatalogCard[]) {
  let i = 0;
  while (b.total() < DECK_SIZE && energy.length) {
    const before = b.total();
    b.add(energy[i % energy.length], DECK_SIZE - b.total());
    i++;
    if (b.total() === before) break;   // kein Fortschritt (sollte nicht passieren)
  }
}

/** Rein regelbasierter Deckbau aus dem Pool (Fallback + „ohne KI"). */
export function assembleDeck({ pool, existing = [] }: GenerateOpts): DeckCardRef[] {
  const { byId, energy } = poolMaps(pool);
  const b = new DeckBuilder();
  b.seed(existing, byId);

  // Evolutionslinie(n): je Stufe die Zielmenge.
  for (const p of pool.filter(p => p.role === 'core' || p.role === 'evolution')) {
    b.add(p.card, STAGE_COUNTS[Math.min(p.stage, 2)]);
  }
  // Trainer-Staples.
  for (const p of pool.filter(p => p.role === 'trainer')) {
    b.add(p.card, STAPLE_COUNTS[p.card.name] ?? 2);
  }
  // Rest mit Energie auffüllen.
  fillWithEnergy(b, energy);
  // Sicherheitsnetz: falls immer noch < 60 (kein Energie im Pool), Staples/Linie aufstocken.
  if (b.total() < DECK_SIZE) {
    for (const p of pool) { if (b.total() >= DECK_SIZE) break; b.add(p.card, MAX_COPIES); }
  }
  b.trimTo(DECK_SIZE);
  return b.refs();
}

export interface AiPick { index: number; count: number; }

/** Wendet Gemini-Auswahlen an: Ungültiges/Out-of-Range verworfen, Regeln
 *  erzwungen, dann auf genau 60 repariert (Energie auffüllen / kürzen /
 *  Basis-Pokémon sicherstellen). */
export function applyAiPicks(picks: AiPick[], { pool, existing = [] }: GenerateOpts): DeckCardRef[] {
  const { byId, energy } = poolMaps(pool);
  const b = new DeckBuilder();
  b.seed(existing, byId);

  for (const pick of picks) {
    const p = pool[pick.index];                 // Out-of-Range → undefined → übersprungen
    if (!p || !Number.isFinite(pick.count) || pick.count <= 0) continue;
    b.add(p.card, Math.floor(pick.count));
  }

  // Basis-Pokémon sicherstellen (Regel 3): sonst ein Basis-Pokémon aus dem Pool.
  if (!b.hasBasicPokemon()) {
    const basic = pool.find(p => isBasicPokemon(p.card));
    if (basic) b.add(basic.card, STAGE_COUNTS[0]);
  }
  // Auf 60 reparieren.
  if (b.total() < DECK_SIZE) fillWithEnergy(b, energy);
  if (b.total() < DECK_SIZE) for (const p of pool) { if (b.total() >= DECK_SIZE) break; b.add(p.card, MAX_COPIES); }
  b.trimTo(DECK_SIZE);
  return b.refs();
}
