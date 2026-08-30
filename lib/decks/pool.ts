/**
 * Kandidaten-Pool für den Deck-Generator (D8). Wird CLIENT-seitig gebaut (nutzt
 * die erprobten Katalog-Reads aus D7) und dann an die Gemini-Route geschickt —
 * Gemini wählt NUR per Index aus diesem Pool, wodurch ID-Halluzination
 * unmöglich wird (ein Out-of-Range-Index wird serverseitig einfach verworfen).
 * Derselbe Pool speist auch den regelbasierten Fallback-Generator (generate.ts).
 */
import { getCatalogCardsByIds, getCardsByEvolutionFamily, type CatalogCard } from '../firestore/catalog';
import { browseCatalogRest } from '../firestore/catalog-rest';
import { searchCatalogCards } from '../search/catalog-search';
import { isBasicEnergy, isBasicPokemon, isCardLegal, cardNameKey } from './rules';
import { TRAINER_STAPLES, STAGE2_STAPLE, ENERGY_TYPES_WITH_BASIC } from './suggestions';
import type { DeckFormat } from '@/types';

export type PoolRole = 'core' | 'evolution' | 'trainer' | 'energy';

export interface PoolCard {
  card: CatalogCard;
  role: PoolRole;
  /** Besessene Exemplare dieses Drucks. */
  owned: number;
  /** Evolutionsstufe (0=Basis,1,2) — nur für Pokémon relevant. */
  stage: number;
}

export interface PoolParams {
  format: DeckFormat;
  /** Katalog-ID der Kern-Karte (falls direkt gewählt). */
  coreId?: string;
  /** Kern-Name (Freitext/Suche), falls keine ID. */
  coreName?: string;
  /** Bevorzugter Energie-/Pokémon-Typ; sonst aus der Kernkarte abgeleitet. */
  type?: string;
  ownership: 'owned' | 'prefer' | 'best';
}

function stageOf(card: CatalogCard): number {
  if (card.subtypes?.includes('Stage 2')) return 2;
  if (card.subtypes?.includes('Stage 1')) return 1;
  return 0;
}

/** Wählt je Kartennamen den „besten" Druck: bevorzugt besessen, dann format-legal,
 *  dann der teuerste (meist die aktuellste/spielbarste Auflage). */
function pickBestPrint(cards: CatalogCard[], ownedByTcgId: Map<string, number>, format: DeckFormat): CatalogCard | null {
  const legal = cards.filter(c => isCardLegal(c, format));
  const pool = legal.length ? legal : cards;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    const ao = (ownedByTcgId.get(a.id) ?? 0) > 0 ? 1 : 0;
    const bo = (ownedByTcgId.get(b.id) ?? 0) > 0 ? 1 : 0;
    if (ao !== bo) return bo - ao;
    return (b.priceEur ?? 0) - (a.priceEur ?? 0);
  })[0];
}

async function resolveByName(name: string, ownedByTcgId: Map<string, number>, format: DeckFormat, pokemonOnly = false): Promise<CatalogCard | null> {
  let hits: CatalogCard[] = [];
  try { hits = (await searchCatalogCards(name, { displayLimit: 20 })).cards; }
  catch { return null; }
  const key = name.toLowerCase();
  let exact = hits.filter(c => c.name.toLowerCase() === key || c.nameDe?.toLowerCase() === key);
  if (pokemonOnly) exact = exact.filter(c => c.supertype === 'Pokémon');
  return pickBestPrint(exact.length ? exact : hits, ownedByTcgId, format);
}

/** Evolutionsstufe als Rang (2=Stufe2 … 0=Basis) — für Angreifer-Ranking. */
function stageRank(c: CatalogCard): number {
  return c.subtypes?.includes('Stage 2') ? 2 : c.subtypes?.includes('Stage 1') ? 1 : 0;
}

/** Familien-Schlüssel (kleinste Dex-Nr. der Evolutionsfamilie, sonst eigene
 *  Dex-Nr.) — um Linien-Duplikate zu erkennen. */
function familyKey(c: CatalogCard): number {
  return c.evolutionFamily?.length ? Math.min(...c.evolutionFamily) : (c.nationalDexNumber ?? -1);
}

/** Fügt die komplette Evolutionslinie eines Seed-Pokémon in den Pool (Basis +
 *  alle Stufen, je Name bester Druck). `primaryId` markiert die Kernkarte. */
async function addEvolutionLine(
  seed: CatalogCard,
  push: (card: CatalogCard, role: PoolRole) => void,
  ownedByTcgId: Map<string, number>,
  format: DeckFormat,
  primaryId?: string,
): Promise<void> {
  if (!seed.evolutionFamily?.length) { push(seed, seed.id === primaryId ? 'core' : 'evolution'); return; }
  const byDex = new Map<number, CatalogCard[]>();
  for (const dex of new Set(seed.evolutionFamily)) {
    let fam: CatalogCard[] = [];
    try { fam = await getCardsByEvolutionFamily(dex); } catch { /* skip */ }
    for (const c of fam) {
      if (c.supertype !== 'Pokémon' || !isCardLegal(c, format)) continue;
      const arr = byDex.get(c.nationalDexNumber ?? -1) ?? [];
      arr.push(c); byDex.set(c.nationalDexNumber ?? -1, arr);
    }
  }
  for (const [, prints] of byDex) {
    // je Name (nicht je dex) besten Druck wählen — Formen/Varianten getrennt.
    const byName = new Map<string, CatalogCard[]>();
    for (const c of prints) { const k = cardNameKey(c.name); (byName.get(k) ?? byName.set(k, []).get(k)!).push(c); }
    for (const [, group] of byName) {
      const best = pickBestPrint(group, ownedByTcgId, format);
      if (best) push(best, best.id === primaryId ? 'core' : 'evolution');
    }
  }
}

/** Angreifer-Kandidaten eines Typs aus dem Katalog (Sample, clientseitig
 *  gerankt) — für „Bestes Deck" und die „Bevorzugt eigene"-Vervollständigung.
 *  Nur Pokémon mit Attacken, format-legal. */
async function catalogTypeAttackers(type: string, format: DeckFormat): Promise<CatalogCard[]> {
  try {
    // types-Filter erlaubt server-seitig kein price-orderBy (Composite-Index) →
    // größeres Sample holen und clientseitig nach Stufe/KP/Preis ranken.
    const { cards } = await browseCatalogRest({ types: [type] }, null, 250, 'name', false);
    return cards.filter(c => c.supertype === 'Pokémon' && (c.attacks?.length ?? 0) > 0 && isCardLegal(c, format));
  } catch { return []; }
}

// So viele Angreifer-Linien (inkl. Kern) darf ein Typ-Deck haben — genug für
// 12–18 Pokémon über mehrere Linien statt einer dünnen Einzel-Linie.
const MAX_ATTACKER_LINES = 3;

/** Baut den Kandidaten-Pool: Kern-Evolutionslinie + weitere Angreifer-Linien des
 *  Typs (modusabhängig) + Trainer-Staples + Basis-Energie. Bei ownership='owned'
 *  am Ende auf Besessenes gefiltert. */
export async function buildCandidatePool(params: PoolParams, ownedByTcgId: Map<string, number>): Promise<PoolCard[]> {
  const out: PoolCard[] = [];
  const seen = new Set<string>();
  const push = (card: CatalogCard, role: PoolRole) => {
    if (seen.has(card.id)) return;
    seen.add(card.id);
    out.push({ card, role, owned: ownedByTcgId.get(card.id) ?? 0, stage: stageOf(card) });
  };

  // 1. Kernkarte auflösen.
  let core: CatalogCard | null = null;
  if (params.coreId) core = (await getCatalogCardsByIds([params.coreId]))[0] ?? null;
  if (!core && params.coreName) core = await resolveByName(params.coreName, ownedByTcgId, params.format, true);

  const type = params.type ?? core?.types?.[0];

  // 2. Kern-Evolutionslinie (Basis + alle Stufen, je Name bester Druck).
  if (core) await addEvolutionLine(core, push, ownedByTcgId, params.format, core.id);

  // 2b. Weitere Angreifer-Linien desselben Typs — Quelle je Sammlungs-Modus:
  //     • 'best'   → beste Katalog-Angreifer des Typs (Besitz egal)
  //     • 'owned'  → nur besessene Angreifer des Typs
  //     • 'prefer' → besessene zuerst, dann Katalog zur Vervollständigung
  if (type) {
    const addedFamilies = new Set<number>(out.filter(p => p.card.supertype === 'Pokémon').map(p => familyKey(p.card)));

    let ownedAttackers: CatalogCard[] = [];
    if (params.ownership !== 'best' && ownedByTcgId.size) {
      const ownedCatalog = await getCatalogCardsByIds([...ownedByTcgId.keys()]);
      ownedAttackers = ownedCatalog.filter(c =>
        c.supertype === 'Pokémon' && (c.types ?? []).includes(type) && (c.attacks?.length ?? 0) > 0 && isCardLegal(c, params.format));
    }
    const catAttackers = params.ownership === 'owned' ? [] : await catalogTypeAttackers(type, params.format);

    const rank = (a: CatalogCard, b: CatalogCard) =>
      (stageRank(b) - stageRank(a)) || ((b.hp ?? 0) - (a.hp ?? 0)) || ((b.priceEur ?? 0) - (a.priceEur ?? 0));
    ownedAttackers.sort(rank);
    catAttackers.sort(rank);
    const ordered = params.ownership === 'owned' ? ownedAttackers
      : params.ownership === 'best' ? catAttackers
      : [...ownedAttackers, ...catAttackers];   // 'prefer'

    for (const seed of ordered) {
      if (addedFamilies.size >= MAX_ATTACKER_LINES) break;
      const fk = familyKey(seed);
      if (addedFamilies.has(fk)) continue;
      addedFamilies.add(fk);
      await addEvolutionLine(seed, push, ownedByTcgId, params.format);
    }
  }

  // 3. Trainer-Staples (bei Stufe-2-Kern zusätzlich Rare Candy).
  const hasStage2 = out.some(p => p.stage === 2);
  const staples = [...TRAINER_STAPLES, ...(hasStage2 ? [STAGE2_STAPLE] : [])];
  for (const name of staples) {
    const card = await resolveByName(name, ownedByTcgId, params.format);
    if (card && (card.supertype === 'Trainer')) push(card, 'trainer');
  }

  // 4. Basis-Energie des Typs (falls Typ mit Basis-Energie).
  if (type && ENERGY_TYPES_WITH_BASIC.includes(type)) {
    let hits: CatalogCard[] = [];
    try { hits = (await searchCatalogCards(`${type} Energy`, { displayLimit: 20 })).cards; } catch { /* skip */ }
    const basic = hits.find(c => isBasicEnergy(c) && isCardLegal(c, params.format)
      && ((c.types ?? []).includes(type) || c.name.toLowerCase().includes(type.toLowerCase())));
    if (basic) push(basic, 'energy');
  }

  // 5. ownership-Filter: nur-besessen kappt auf Besitz (Basis-Energie bleibt,
  //    die gilt immer als verfügbar).
  if (params.ownership === 'owned') {
    return out.filter(p => p.owned > 0 || p.role === 'energy');
  }
  return out;
}

/** Kompakte, an Gemini gesendete Pool-Zeile (Index = Auswahlschlüssel). */
export interface PoolLine {
  index: number;
  name: string;
  supertype: string;
  subtype: string;
  type: string;
  owned: boolean;
}

export function toPoolLines(pool: PoolCard[]): PoolLine[] {
  return pool.map((p, i) => ({
    index: i,
    name: p.card.name,
    supertype: p.card.supertype,
    subtype: p.card.subtypes?.[0] ?? '',
    type: p.card.types?.[0] ?? '',
    owned: p.owned > 0,
  }));
}

export const hasBasicPokemonInPool = (pool: PoolCard[]) => pool.some(p => isBasicPokemon(p.card));
