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
  // Deutschen Namen bevorzugen (wie catalogCardToInfo) — sonst zeigten
  // KI-generierte Karten englische Namen, während UI-Adds deutsche speichern.
  return { catalogId: card.id, count, name: card.nameDe ?? card.name, setId: card.setId, number: card.number, supertype: card.supertype };
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

  /** Summe der Exemplare, deren Karte `pred` erfüllt (z.B. nur Pokémon/Trainer). */
  totalBy(pred: (c: CatalogCard) => boolean): number {
    let s = 0; for (const v of this.items.values()) if (pred(v.card)) s += v.count; return s;
  }

  /** Momentaufnahme (Karte + Anzahl) — für rollenbezogenes Rebalancing. */
  snapshot(): { card: CatalogCard; count: number }[] {
    return [...this.items.values()].map(v => ({ card: v.card, count: v.count }));
  }

  /** Entfernt bis zu `n` Exemplare einer Karte; pflegt den Namenszähler.
   *  Gibt die tatsächlich entfernte Anzahl zurück. */
  reduce(card: CatalogCard, n: number): number {
    const cur = this.items.get(card.id);
    if (!cur || n <= 0) return 0;
    const cut = Math.min(n, cur.count);
    cur.count -= cut;
    if (!isBasicEnergy(card)) {
      const k = cardNameKey(card.name);
      this.nameCount.set(k, Math.max(0, (this.nameCount.get(k) ?? 0) - cut));
    }
    if (cur.count === 0) this.items.delete(card.id);
    return cut;
  }

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
  "Professor's Research": 4, 'Iono': 3, 'Arven': 4, "Boss's Orders": 2,
  'Ultra Ball': 4, 'Nest Ball': 3, 'Buddy-Buddy Poffin': 4, 'Switch': 2,
  'Super Rod': 1, 'Earthen Vessel': 2, 'Rare Candy': 4,
};
const STAGE_COUNTS = [4, 2, 3];             // Kern-Linie: Basis / Stufe 1 / Stufe 2
const SECONDARY_STAGE_COUNTS = [2, 1, 1];   // weitere Angreifer-Linien: schlanker

// Makro-Form-Grenzen (Deck-Bau-Faustregeln): Trainer nicht über ~34, Pokémon
// mindestens ~14 — verhindert das „40 Trainer / 8 Pokémon"-Ungleichgewicht.
const TRAINER_CAP = 34;
const POKEMON_TARGET = 14;

const isPokemonCard = (c: CatalogCard) => c.supertype === 'Pokémon';
const isTrainerCard = (c: CatalogCard) => c.supertype === 'Trainer';

/** Familien-Schlüssel (kleinste Dex-Nr.) — um Kern- von Neben-Linien zu trennen. */
function famKey(c: CatalogCard): number {
  return c.evolutionFamily?.length ? Math.min(...c.evolutionFamily) : (c.nationalDexNumber ?? -1);
}

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

/** Empfohlene Basis-Energie-Anzahl aus den Attackenkosten des Decks: teure
 *  Attacken (viele Energie-Symbole) → mehr Energie. Heuristik 6 + maxKosten*2,
 *  gedeckelt auf 8–15 (übliche Spanne). */
export function targetEnergyCount(pool: PoolCard[]): number {
  let maxCost = 1;
  for (const p of pool) {
    if (p.card.supertype !== 'Pokémon') continue;
    for (const at of p.card.attacks ?? []) maxCost = Math.max(maxCost, (at.cost ?? []).length);
  }
  return Math.min(15, Math.max(8, 6 + maxCost * 2));
}

/** Fügt bis zu `n` Basis-Energie hinzu (spread über den Energie-Pool). */
function addEnergy(b: DeckBuilder, energy: CatalogCard[], n: number) {
  if (n <= 0 || energy.length === 0) return;
  b.add(energy[0], n);
}

/** Bringt ein (teilweise gefülltes) Deck auf genau 60 in gesunder Makro-Form:
 *  Trainer über dem Deckel abbauen, dann in Priorität Pokémon (bis Ziel) →
 *  Energie (bis Ziel) → Trainer (bis Deckel) → Rest auffüllen. Genutzt von
 *  beiden Pfaden, damit eine schiefe (KI- oder Regel-)Verteilung normalisiert
 *  wird. */
function finishDeck(b: DeckBuilder, pool: PoolCard[], energyTarget: number) {
  const { energy } = poolMaps(pool);
  const poolPokemon = pool.filter(p => p.role === 'core' || p.role === 'evolution').map(p => p.card);
  const poolTrainers = pool.filter(p => p.role === 'trainer').map(p => p.card);

  // 1. Trainer-Deckel: überzählige Trainer abbauen (meistkopierte zuerst, aber
  //    je Karte mind. 1 behalten — erhält die Engine-Vielfalt).
  let trOver = b.totalBy(isTrainerCard) - TRAINER_CAP;
  if (trOver > 0) {
    for (const it of b.snapshot().filter(x => isTrainerCard(x.card)).sort((a, c) => c.count - a.count)) {
      if (trOver <= 0) break;
      const cut = Math.min(trOver, it.count - 1);
      if (cut > 0) { b.reduce(it.card, cut); trOver -= cut; }
    }
  }

  // 2. Pokémon bis Ziel aufstocken (round-robin, 4er-Regel über add()).
  let guard = 0;
  while (b.total() < DECK_SIZE && b.totalBy(isPokemonCard) < POKEMON_TARGET && guard++ < 300) {
    let progressed = false;
    for (const c of poolPokemon) {
      if (b.total() >= DECK_SIZE || b.totalBy(isPokemonCard) >= POKEMON_TARGET) break;
      if (b.add(c, 1) > 0) progressed = true;
    }
    if (!progressed) break;
  }
  // 3. Energie bis Zielmenge.
  if (b.total() < DECK_SIZE) {
    const need = Math.min(energyTarget - b.totalBy(isBasicEnergy), DECK_SIZE - b.total());
    addEnergy(b, energy, need);
  }
  // 4. Trainer bis zum Deckel auffüllen.
  if (b.total() < DECK_SIZE) for (const c of poolTrainers) {
    if (b.total() >= DECK_SIZE || b.totalBy(isTrainerCard) >= TRAINER_CAP) break;
    b.add(c, Math.min(MAX_COPIES, TRAINER_CAP - b.totalBy(isTrainerCard)));
  }
  // 5. Rest: erst mehr Energie, dann alles.
  if (b.total() < DECK_SIZE) fillWithEnergy(b, energy);
  if (b.total() < DECK_SIZE) for (const p of pool) { if (b.total() >= DECK_SIZE) break; b.add(p.card, MAX_COPIES); }
  b.trimTo(DECK_SIZE);
}

/** Rein regelbasierter Deckbau aus dem Pool (Fallback + „ohne KI"). */
export function assembleDeck({ pool, existing = [] }: GenerateOpts): DeckCardRef[] {
  const { byId, energy } = poolMaps(pool);
  const b = new DeckBuilder();
  b.seed(existing, byId);

  // 1. Evolutionslinien: Kern-Linie in voller Zielmenge, weitere Linien schlanker.
  const coreCard = pool.find(p => p.role === 'core')?.card;
  const coreFam = coreCard ? famKey(coreCard) : -999;
  for (const p of pool.filter(p => p.role === 'core' || p.role === 'evolution')) {
    const counts = famKey(p.card) === coreFam ? STAGE_COUNTS : SECONDARY_STAGE_COUNTS;
    b.add(p.card, counts[Math.min(p.stage, 2)]);
  }
  // 2. Trainer-Staples in empfohlener Anzahl.
  for (const p of pool.filter(p => p.role === 'trainer')) {
    b.add(p.card, STAPLE_COUNTS[p.card.name] ?? 2);
  }
  // 3. Energie = Zielmenge aus Attackenkosten (nicht der ganze Rest).
  addEnergy(b, energy, Math.min(targetEnergyCount(pool), DECK_SIZE - b.total()));
  // 4. Auf 60 normalisieren (Trainer-Deckel, Pokémon-Floor, Prioritäts-Auffüllung).
  finishDeck(b, pool, targetEnergyCount(pool));
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
  // Auf 60 normalisieren — dieselbe Makro-Form-Korrektur wie im Regel-Pfad:
  // deckelt z.B. eine KI-Ausgabe mit zu vielen Trainern und stockt Pokémon auf.
  finishDeck(b, pool, targetEnergyCount(pool));
  return b.refs();
}
