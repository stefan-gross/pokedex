/**
 * Regelbasierte Deck-Vorschläge (KI-Stufe a) — KEIN LLM, rein deterministisch,
 * daher kein Mapping-/Halluzinationsrisiko: jeder Vorschlag ist eine konkrete
 * Katalog-Karte. Vier Regeln: Evolutionslücke (fehlende Basis), Playset
 * (auf 4× auffüllen), Basis-Energie zum Deck-Typ, Trainer-Staples. Async, weil
 * Kandidaten (Basis-Pokémon, Energie, Staples) frisch aus dem Katalog aufgelöst
 * und auf Format-Legalität geprüft werden.
 */
import { getCardsByEvolutionFamily, type CatalogCard } from '../firestore/catalog';
import { searchCatalogCards } from '../search/catalog-search';
import { isBasicEnergy, isBasicPokemon, isCardLegal, cardNameKey, MAX_COPIES } from './rules';
import type { DeckCardRef, CardDoc, DeckFormat } from '@/types';

export type SuggestionKind = 'evolution' | 'playset' | 'energy' | 'staple';

export interface DeckSuggestion {
  kind: SuggestionKind;
  card: CatalogCard;
  /** Wie viele Exemplare der Vorschlag hinzufügen würde. */
  addCount: number;
  reason: string;
  /** Besitzt der Nutzer schon genug Exemplare dieses Drucks? */
  ownedEnough: boolean;
}

// Kuratierte Standard-Trainer-Staples (englische Katalognamen). Bewusst
// zeitlose Karten; die konkrete legale Auflage wird zur Laufzeit aufgelöst.
const TRAINER_STAPLES = ["Professor's Research", 'Iono', "Boss's Orders", 'Ultra Ball', 'Nest Ball', 'Switch'];
// Für Decks mit Stufe-2-Pokémon zusätzlich.
const STAGE2_STAPLE = 'Rare Candy';

const ENERGY_TYPES_WITH_BASIC = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'];

interface DeckContext {
  cards: DeckCardRef[];
  byId: Map<string, CatalogCard>;
  ownedByTcgId: Map<string, number>;
  format: DeckFormat;
  /** Anzahl je Kartenname (über alle Drucke) — für die 4er-Regel. */
  nameCount: Map<string, number>;
  /** dex-Nummern der im Deck vertretenen Pokémon. */
  deckDex: Set<number>;
  /** catalogIds, die schon vorgeschlagen ODER schon bei 4× (Name) sind. */
  blocked: Set<string>;
}

function ownedEnough(ctx: DeckContext, card: CatalogCard, need: number): boolean {
  return (ctx.ownedByTcgId.get(card.id) ?? 0) >= need;
}

/** Verhindert Vorschläge, die die 4er-Regel sprengen oder Duplikate sind. */
function accept(ctx: DeckContext, card: CatalogCard, addCount: number): number {
  if (ctx.blocked.has(card.id)) return 0;
  if (!isCardLegal(card, ctx.format)) return 0;
  if (isBasicEnergy(card)) { ctx.blocked.add(card.id); return addCount; }   // Basis-Energie: keine 4er-Grenze
  const already = ctx.nameCount.get(cardNameKey(card.name)) ?? 0;
  const room = MAX_COPIES - already;
  if (room <= 0) return 0;
  ctx.blocked.add(card.id);
  return Math.min(addCount, room);
}

// ── Regel 1: Playset auffüllen ───────────────────────────────────────────────
function playsetSuggestions(ctx: DeckContext): DeckSuggestion[] {
  const out: DeckSuggestion[] = [];
  for (const ref of ctx.cards) {
    const card = ctx.byId.get(ref.catalogId);
    if (!card || isBasicEnergy(card) || card.supertype === 'Energy') continue;
    // Nur bei klarem Playset-Signal (2–3 Kopien dieses Drucks), sonst zu viel Rauschen.
    if (ref.count < 2 || ref.count >= MAX_COPIES) continue;
    const nameTotal = ctx.nameCount.get(cardNameKey(card.name)) ?? ref.count;
    const room = MAX_COPIES - nameTotal;
    if (room <= 0) continue;
    if (ctx.blocked.has(card.id)) continue;
    ctx.blocked.add(card.id);
    out.push({ kind: 'playset', card, addCount: room, reason: `Auf Playset auffüllen (auf ${MAX_COPIES}×)`, ownedEnough: ownedEnough(ctx, card, room) });
  }
  return out;
}

// ── Regel 2: Evolutionslücke (fehlende Basis) ───────────────────────────────
async function evolutionSuggestions(ctx: DeckContext): Promise<DeckSuggestion[]> {
  const out: DeckSuggestion[] = [];
  const seenBasicDex = new Set<number>();
  for (const ref of ctx.cards) {
    const card = ctx.byId.get(ref.catalogId);
    if (!card || card.supertype !== 'Pokémon') continue;
    const stage = card.subtypes?.find(s => s === 'Stage 1' || s === 'Stage 2');
    if (!stage || !card.evolutionFamily?.length) continue;
    const basicDex = Math.min(...card.evolutionFamily);
    if (basicDex === card.nationalDexNumber) continue;      // ist selbst die Basis
    if (ctx.deckDex.has(basicDex) || seenBasicDex.has(basicDex)) continue;   // Basis bereits im Deck/vorgeschlagen
    seenBasicDex.add(basicDex);

    let candidates: CatalogCard[] = [];
    try { candidates = await getCardsByEvolutionFamily(basicDex); }
    catch (e) { console.error('[suggestions] evo lookup', basicDex, e); continue; }
    const basics = candidates.filter(c => c.nationalDexNumber === basicDex && isBasicPokemon(c) && isCardLegal(c, ctx.format));
    if (basics.length === 0) continue;
    // Bevorzugt eine besessene Auflage.
    const pick = basics.find(c => (ctx.ownedByTcgId.get(c.id) ?? 0) > 0) ?? basics[0];
    const addCount = accept(ctx, pick, Math.min(ref.count, MAX_COPIES));
    if (addCount <= 0) continue;
    out.push({ kind: 'evolution', card: pick, addCount, reason: `Basis fehlt für ${card.nameDe ?? card.name}`, ownedEnough: ownedEnough(ctx, pick, addCount) });
  }
  return out;
}

// ── Regel 3: Basis-Energie zum Deck-Typ ─────────────────────────────────────
async function energySuggestions(ctx: DeckContext): Promise<DeckSuggestion[]> {
  // Deck-Typen gewichtet nach Pokémon-Anzahl.
  const typeWeight = new Map<string, number>();
  for (const ref of ctx.cards) {
    const card = ctx.byId.get(ref.catalogId);
    if (!card || card.supertype !== 'Pokémon') continue;
    for (const t of card.types ?? []) if (ENERGY_TYPES_WITH_BASIC.includes(t)) typeWeight.set(t, (typeWeight.get(t) ?? 0) + ref.count);
  }
  // Bereits vorhandene Basis-Energie je Typ.
  const haveEnergyType = new Set<string>();
  for (const ref of ctx.cards) {
    const card = ctx.byId.get(ref.catalogId);
    if (card && isBasicEnergy(card)) for (const t of card.types ?? []) haveEnergyType.add(t);
  }
  const topTypes = [...typeWeight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]);

  const out: DeckSuggestion[] = [];
  for (const type of topTypes) {
    if (haveEnergyType.has(type)) continue;   // schon Energie dieses Typs im Deck
    let hits: CatalogCard[] = [];
    try { hits = (await searchCatalogCards(`${type} Energy`, { displayLimit: 20 })).cards; }
    catch (e) { console.error('[suggestions] energy lookup', type, e); continue; }
    const basic = hits.find(c => isBasicEnergy(c) && (c.types ?? []).includes(type) && isCardLegal(c, ctx.format));
    if (!basic) continue;
    const addCount = accept(ctx, basic, 8);
    if (addCount <= 0) continue;
    out.push({ kind: 'energy', card: basic, addCount, reason: `Basis-Energie für ${type}-Pokémon`, ownedEnough: true });
  }
  return out;
}

// ── Regel 4: Trainer-Staples ────────────────────────────────────────────────
async function stapleSuggestions(ctx: DeckContext): Promise<DeckSuggestion[]> {
  const inDeck = new Set([...ctx.nameCount.keys()]);
  const hasStage2 = ctx.cards.some(r => ctx.byId.get(r.catalogId)?.subtypes?.includes('Stage 2'));
  const wanted = [...TRAINER_STAPLES, ...(hasStage2 ? [STAGE2_STAPLE] : [])];

  const out: DeckSuggestion[] = [];
  for (const name of wanted) {
    if (inDeck.has(cardNameKey(name))) continue;   // schon im Deck
    let hits: CatalogCard[] = [];
    try { hits = (await searchCatalogCards(name, { displayLimit: 12 })).cards; }
    catch (e) { console.error('[suggestions] staple lookup', name, e); continue; }
    const key = name.toLowerCase();
    const legal = hits.filter(c => (c.name.toLowerCase() === key || c.nameDe?.toLowerCase() === key) && isCardLegal(c, ctx.format));
    if (legal.length === 0) continue;
    const pick = legal.find(c => (ctx.ownedByTcgId.get(c.id) ?? 0) > 0) ?? legal[0];
    const addCount = accept(ctx, pick, 2);
    if (addCount <= 0) continue;
    out.push({ kind: 'staple', card: pick, addCount, reason: `Bewährte Trainer-Karte`, ownedEnough: ownedEnough(ctx, pick, addCount) });
  }
  return out;
}

/** Erzeugt regelbasierte Vorschläge für ein Deck. Reihenfolge: Evolutionslücken
 *  → Playset → Energie → Staples (wichtigste zuerst). */
export async function computeDeckSuggestions(
  cards: DeckCardRef[],
  byId: Map<string, CatalogCard>,
  owned: CardDoc[],
  format: DeckFormat,
): Promise<DeckSuggestion[]> {
  const ownedByTcgId = new Map<string, number>();
  for (const c of owned) if (c.tcgId) ownedByTcgId.set(c.tcgId, (ownedByTcgId.get(c.tcgId) ?? 0) + (c.quantity ?? 1));

  const nameCount = new Map<string, number>();
  const deckDex = new Set<number>();
  for (const ref of cards) {
    const card = byId.get(ref.catalogId);
    const key = cardNameKey(card?.name ?? ref.name);
    nameCount.set(key, (nameCount.get(key) ?? 0) + ref.count);
    if (card?.nationalDexNumber) deckDex.add(card.nationalDexNumber);
  }

  const ctx: DeckContext = { cards, byId, ownedByTcgId, format, nameCount, deckDex, blocked: new Set() };

  // Evolution zuerst (blockt Playset-Doppelvorschläge auf dieselbe Karte).
  const evo = await evolutionSuggestions(ctx);
  const playset = playsetSuggestions(ctx);
  const energy = await energySuggestions(ctx);
  const staples = await stapleSuggestions(ctx);
  return [...evo, ...playset, ...energy, ...staples];
}
