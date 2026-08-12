/**
 * TCGdex als EINZIGE Katalog-Datenquelle (ersetzt pokemontcg.io + lib/tcgdex.ts).
 *
 * IDs sind TCGdex-nativ (Karte `me04-100`, Set `me04`) — kein pokemontcg-Mapping.
 *
 * Import-Strategie (live gegen api.tcgdex.net verifiziert):
 *  - **Voll-Daten (EN)** via GraphQL `cards(filters:{category}, pagination)`. Der
 *    `cards`-Query BRAUCHT ein `filters`-Arg (leer → Server-Bug) und kennt KEIN
 *    `set`-Filter; `category` (Pokemon/Trainer/Energy) deckt mit 3 Werten alle
 *    Karten ab. `set.serie` NICHT selektieren (non-nullable, bricht bei Sets ohne
 *    Serie) — Serie kommt aus dem Set-Sync. GraphQL liefert KEINE Preise und ist
 *    EN-only.
 *  - **DE-Name** via REST `/v2/de/cards` (Briefs: id/localId/name, KEIN Bild).
 *  - **DE-Bild** aus der EN-Bild-Basis per `/en/`→`/de/` abgeleitet (CardImage
 *    fällt bei 404 automatisch auf EN zurück).
 *  - **Preise** separat per-Card via REST (siehe lib/prices/tcgdex.ts), TTL-Cache.
 */

import type { CatalogCard } from '@/lib/firestore/catalog';
import type { CardVariant, CardAttack, CardAbility, CardWeakRes } from '@/types';

const GRAPHQL = 'https://api.tcgdex.net/v2/graphql';
const REST = 'https://api.tcgdex.net/v2';
export const PAGE_SIZE = 250;
/** Alle Karten sind genau einer dieser Kategorien zugeordnet → 3 Filter decken
 *  den gesamten Katalog ab (der GraphQL-`cards`-Query braucht zwingend ein
 *  Filter-Arg, siehe Modul-Kopf). */
export const CATEGORIES = ['Pokemon', 'Trainer', 'Energy'] as const;
export type TcgdexCategory = typeof CATEGORIES[number];

// ── Rohe TCGdex-Shapes ──────────────────────────────────────────────────────
export interface TcgdexCardFull {
  id: string;
  localId: string;
  name: string;
  category: string;                 // "Pokemon" | "Trainer" | "Energy"
  rarity: string | null;            // EN-Rarity-String (kanonisch für Klassifikation)
  stage: string | null;             // "Basic" | "Stage1" | "Stage2" | …
  suffix: string | null;            // "EX" | "GX" | "V" | "VMAX" | …
  hp: number | null;
  types: string[] | null;
  illustrator: string | null;
  image: string | null;             // EN-Basis-URL OHNE Endung (kann null sein)
  dexId: number[] | null;
  evolveFrom: string | null;
  regulationMark: string | null;
  variants: {
    normal?: boolean; holo?: boolean; reverse?: boolean;
    firstEdition?: boolean; wPromo?: boolean;
  } | null;
  set: { id: string; name: string } | null;
  legal: { standard: boolean | null; expanded: boolean | null } | null;
}

// ── GraphQL ─────────────────────────────────────────────────────────────────
async function graphql<T>(query: string): Promise<T> {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`TCGdex GraphQL HTTP ${res.status}`);
  const json = await res.json() as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`TCGdex GraphQL: ${json.errors[0].message}`);
  if (!json.data) throw new Error('TCGdex GraphQL: kein data-Feld');
  return json.data;
}

const CARD_FIELDS = `
  id localId name category rarity stage suffix hp types illustrator image
  dexId evolveFrom regulationMark
  legal { standard expanded }
  variants { normal holo reverse firstEdition wPromo }
  set { id name }
`;

/** Eine Seite voller EN-Karten einer Kategorie (für resumierbaren Sync). */
export async function fetchEnCardsPage(category: TcgdexCategory, page: number): Promise<TcgdexCardFull[]> {
  const q = `{ cards(filters:{category:"${category}"}, pagination:{page:${page}, itemsPerPage:${PAGE_SIZE}}) { ${CARD_FIELDS} } }`;
  const data = await graphql<{ cards: TcgdexCardFull[] }>(q);
  return data.cards ?? [];
}

/** Holt ALLE Karten (volle EN-Daten) — je `category` seitenweise. */
export async function fetchAllEnCards(
  onProgress?: (loaded: number) => void,
): Promise<TcgdexCardFull[]> {
  const all: TcgdexCardFull[] = [];
  for (const category of CATEGORIES) {
    for (let page = 1; ; page++) {
      const batch = await fetchEnCardsPage(category, page);
      all.push(...batch);
      onProgress?.(all.length);
      if (batch.length < PAGE_SIZE) break;
    }
  }
  return all;
}

/** DE-Info EINER Karte: deutscher Name + (falls vorhanden) echtes DE-Bild. Das
 *  `image`-Feld liefert der /de/sets-Endpunkt NUR, wenn TCGdex ein echtes deutsches
 *  Bild hat (alte Sets ohne DE-Bild → kein `image`). */
export interface DeCardInfo {
  name: string;
  image?: string;   // DE-Bild-Basis-URL (OHNE Endung), nur bei echtem DE-Bild
}

/** DE-Info der Karten EINES Sets (localId → {name, image?}) via REST /de/sets/{id}.
 *  Rückgabe:
 *   - `Map` (ggf. leer): Antwort war eindeutig (200 = DE-Set da; 404 = es gibt
 *     kein DE-Set → leere Map, verlässlich „keine DE-Daten"). Für die Bereinigung
 *     fabrizierter DE-Bilder auswertbar.
 *   - `null`: TRANSIENTER Fehler (Netz/5xx) → Aufrufer soll das Set überspringen
 *     und NICHT bereinigen (sonst würden gute Daten fälschlich gelöscht). */
export async function fetchDeCardsForSet(setId: string): Promise<Map<string, DeCardInfo> | null> {
  const map = new Map<string, DeCardInfo>();
  try {
    const res = await fetch(`${REST}/de/sets/${setId}`);
    if (res.status === 404) return map;           // eindeutig: kein DE-Set
    if (!res.ok) return null;                       // 5xx o.ä. → transient
    const data = await res.json() as { cards?: { localId: string; name?: string; image?: string }[] };
    for (const c of data.cards ?? []) {
      if (!c.localId || !c.name) continue;
      map.set(c.localId, c.image ? { name: c.name, image: c.image } : { name: c.name });
    }
  } catch { return null; }                          // Netzwerkfehler → transient
  return map;
}

// DE-/EN-Energienamen → kanonisch EN (für EnergyIcon). Der Bulk-GraphQL bricht
// bei Karten mit null-Attackennamen ("non-nullable field"), daher wird die
// gesamte Kartenmechanik pro Karte per REST geholt (null-tolerant) — bevorzugt
// aus /de/ (deutsche Texte), mit /en/ als Fallback. Energietypen normalisieren
// wir auf EN, damit die Icons unabhängig von der Quellsprache stimmen.
const ENERGY_TO_EN: Record<string, string> = {
  Colorless: 'Colorless', Fire: 'Fire', Water: 'Water', Grass: 'Grass', Lightning: 'Lightning',
  Psychic: 'Psychic', Fighting: 'Fighting', Darkness: 'Darkness', Metal: 'Metal', Dragon: 'Dragon', Fairy: 'Fairy',
  Farblos: 'Colorless', Feuer: 'Fire', Wasser: 'Water', Pflanze: 'Grass', Elektro: 'Lightning',
  Psycho: 'Psychic', Kampf: 'Fighting', Finsternis: 'Darkness', Metall: 'Metal', Stahl: 'Metal', Drache: 'Dragon', Fee: 'Fairy',
};
const toEnergyEn = (t: string) => ENERGY_TO_EN[t] ?? t;
const TRAINER_TO_EN: Record<string, string> = {
  Item: 'Item', Supporter: 'Supporter', Stadium: 'Stadium', Tool: 'Tool',
  Itemkarte: 'Item', Unterstützerkarte: 'Supporter', Unterstützer: 'Supporter',
  Stadionkarte: 'Stadium', 'Pokémon-Werkzeug': 'Tool', Werkzeug: 'Tool',
};

/** Volle TCG-Mechanik EINER Karte (Effekt/Trainer-Typ/Attacken/Fähigkeiten/
 *  Schwäche/Resistenz/Rückzug), Texte deutsch (REST /de/, Fallback /en/),
 *  Energietypen kanonisch EN. `{}` = Karte ohne Mechanik/nicht vorhanden. */
export interface CardMechanicsData {
  effect?: string; trainerType?: string;
  attacks?: CardAttack[]; abilities?: CardAbility[];
  weaknesses?: CardWeakRes[]; resistances?: CardWeakRes[]; retreat?: number;
}
interface RawRestCard {
  effect?: string | null; trainerType?: string | null; retreat?: number | null;
  abilities?: { type?: string | null; name?: string | null; effect?: string | null }[] | null;
  attacks?: { cost?: string[] | null; name?: string | null; effect?: string | null; damage?: string | number | null }[] | null;
  weaknesses?: { type?: string | null; value?: string | null }[] | null;
  resistances?: { type?: string | null; value?: string | null }[] | null;
}
function parseMechanics(d: RawRestCard): CardMechanicsData {
  const out: CardMechanicsData = {};
  if (d.effect) out.effect = d.effect;
  if (d.trainerType) out.trainerType = TRAINER_TO_EN[d.trainerType] ?? d.trainerType;
  if (d.retreat != null) out.retreat = d.retreat;
  if (d.abilities?.length) {
    out.abilities = d.abilities.map(a => ({
      name: a.name ?? '', ...(a.effect ? { effect: a.effect } : {}), ...(a.type ? { type: a.type } : {}),
    }));
  }
  if (d.attacks?.length) {
    out.attacks = d.attacks.map(a => ({
      name: a.name ?? '',
      ...(a.effect ? { effect: a.effect } : {}),
      ...(a.damage != null && a.damage !== '' ? { damage: String(a.damage) } : {}),
      ...(a.cost?.length ? { cost: a.cost.map(toEnergyEn) } : {}),
    }));
  }
  const wr = (arr: { type?: string | null; value?: string | null }[] | null | undefined) =>
    (arr ?? []).filter(x => x.type && x.value).map(x => ({ type: toEnergyEn(x.type as string), value: x.value as string }));
  const w = wr(d.weaknesses); if (w.length) out.weaknesses = w;
  const r = wr(d.resistances); if (r.length) out.resistances = r;
  return out;
}
export async function fetchCardMechanics(id: string): Promise<CardMechanicsData | null> {
  try {
    let res = await fetch(`${REST}/de/cards/${id}`);
    if (res.status === 404) res = await fetch(`${REST}/en/cards/${id}`);
    if (res.status === 404) return {};                // existiert nicht → nichts
    if (!res.ok) return null;                          // transient
    return parseMechanics(await res.json() as RawRestCard);
  } catch { return null; }
}

/** Alle Karten-IDs EINES Sets (leichtgewichtig, REST /en/sets/{id} → Briefs). */
export async function fetchSetCardIds(setId: string): Promise<string[]> {
  try {
    const res = await fetch(`${REST}/en/sets/${setId}`);
    if (!res.ok) return [];
    const data = await res.json() as { cards?: { id: string }[] };
    return (data.cards ?? []).map(c => c.id).filter(Boolean);
  } catch { return []; }
}

/** Volle EN-Daten für konkrete Karten-IDs — gebündelt (GraphQL-Aliasse, 50/Request).
 *  Für den Delta-Sync: nur die tatsächlich fehlenden Karten holen. */
export async function fetchEnCardsByIds(ids: string[]): Promise<TcgdexCardFull[]> {
  const out: TcgdexCardFull[] = [];
  const CHUNK = 50;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const body = chunk.map((id, j) => `c${j}: card(id:${JSON.stringify(id)}) { ${CARD_FIELDS} }`).join('\n');
    const data = await graphql<Record<string, TcgdexCardFull | null>>(`{ ${body} }`);
    for (const v of Object.values(data)) if (v) out.push(v);
  }
  return out;
}

/** DE-Name je Karten-ID (REST-Briefs, paginiert; Briefs haben KEIN Bild). */
export async function fetchDeNameMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; ; page++) {
    const res = await fetch(`${REST}/de/cards?pagination:page=${page}&pagination:itemsPerPage=${PAGE_SIZE}`);
    if (!res.ok) throw new Error(`TCGdex REST /de/cards HTTP ${res.status}`);
    const batch = await res.json() as { id: string; name: string }[];
    if (!Array.isArray(batch)) break;
    for (const b of batch) if (b.name) map.set(b.id, b.name);
    if (batch.length < PAGE_SIZE) break;
  }
  return map;
}

// ── Mapping-Helfer ───────────────────────────────────────────────────────────
/** TCGdex-Bild-Basis → konkrete URL. `size`: 'low' (klein) | 'high' (groß). */
export function tcgdexImage(base: string | null | undefined, size: 'low' | 'high'): string {
  return base ? `${base}/${size}.webp` : '';
}

/** EN-Bild-Basis → DE-Bild-Basis (nur Sprach-Segment im Pfad unterscheidet sich). */
export function deImageBase(enBase: string | null | undefined): string | null {
  return enBase ? enBase.replace('/en/', '/de/') : null;
}

/** TCGdex-`category` → unser `supertype` (mit Akzent wie im bestehenden Filter). */
export function mapSupertype(category: string): string {
  if (category === 'Pokemon') return 'Pokémon';
  return category; // "Trainer" | "Energy"
}

/** TCGdex `variants`-Flags → unsere CardVariant-Liste (immer mind. 'standard'). */
export function mapVariants(v: TcgdexCardFull['variants']): CardVariant[] {
  const out: CardVariant[] = [];
  if (v?.normal) out.push('standard');
  if (v?.holo) out.push('holo');
  if (v?.reverse) out.push('reverse');
  if (v?.firstEdition) out.push('1st-ed');
  if (v?.wPromo) out.push('promo');
  if (out.length === 0) out.push('standard');
  return Array.from(new Set(out));
}

const STAGE_LABELS: Record<string, string> = {
  Basic: 'Basic', Stage1: 'Stage 1', Stage2: 'Stage 2',
  VMAX: 'VMAX', VSTAR: 'VSTAR', MEGA: 'MEGA', BREAK: 'BREAK',
  'LEVEL-UP': 'LEVEL-UP', RESTORED: 'RESTORED',
};

/** stage + suffix → subtypes[] (für Stufen-/Sondermechanik-Filter). */
export function mapSubtypes(stage: string | null, suffix: string | null): string[] {
  const out: string[] = [];
  if (stage) out.push(STAGE_LABELS[stage] ?? stage);
  if (suffix) out.push(suffix);
  return out;
}

/**
 * Rohe TCGdex-Karte → `CatalogCard` (TCGdex-native ID). `series` und `setCode`
 * kommen aus dem Set-Sync (tcg_sets: serie bzw. abbreviation.official), da das
 * Karten-`set`-Objekt weder Serie noch Kürzel verlässlich liefert.
 */
export function toCatalogCard(
  en: TcgdexCardFull,
  de: DeCardInfo | undefined,
  opts?: { series?: string; setCode?: string },
): CatalogCard {
  return {
    id: en.id,
    name: en.name,
    nameLower: en.name.toLowerCase(),
    ...(de?.name ? { nameDe: de.name, nameDeLower: de.name.toLowerCase() } : {}),
    number: en.localId,
    setId: en.set?.id ?? '',
    setName: en.set?.name ?? '',
    series: opts?.series ?? '',
    ...(opts?.setCode ? { setCode: opts.setCode } : {}),
    rarity: en.rarity ?? '',
    supertype: mapSupertype(en.category),
    types: en.types ?? [],
    subtypes: mapSubtypes(en.stage, en.suffix),
    ...(en.hp != null ? { hp: en.hp } : {}),
    ...(en.dexId?.length ? { nationalDexNumber: en.dexId[0] } : {}),
    imgSmall: tcgdexImage(en.image, 'low'),
    imgLarge: tcgdexImage(en.image, 'high'),
    // DE-Bild wird bewusst NICHT gespeichert: die DE-URL wird beim LESEN aus der
    // EN-URL abgeleitet (`deImageUrl`, /en/→/de/), und selbst gehostete Backfill-
    // Bilder (pokewiki, Storage-URL in `imgLargeDe`) haben Vorrang und dürfen von
    // einem Re-Sync NIE überschrieben werden. Siehe Projekt-Memory tcgdex_golive.
    variants: mapVariants(en.variants),
    ...(en.illustrator ? { artist: en.illustrator, artistTokens: en.illustrator.toLowerCase().split(/\s+/) } : {}),
    ...(en.legal ? { legal: { standard: !!en.legal.standard, expanded: !!en.legal.expanded } } : {}),
  };
}
