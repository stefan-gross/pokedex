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
import type { CardVariant } from '@/types';

const GRAPHQL = 'https://api.tcgdex.net/v2/graphql';
const REST = 'https://api.tcgdex.net/v2';
const PAGE_SIZE = 250;
const CATEGORIES = ['Pokemon', 'Trainer', 'Energy'] as const;

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
  variants { normal holo reverse firstEdition wPromo }
  set { id name }
`;

/** Holt ALLE Karten (volle EN-Daten) — je `category` seitenweise. */
export async function fetchAllEnCards(
  onProgress?: (loaded: number) => void,
): Promise<TcgdexCardFull[]> {
  const all: TcgdexCardFull[] = [];
  for (const category of CATEGORIES) {
    for (let page = 1; ; page++) {
      const q = `{ cards(filters:{category:"${category}"}, pagination:{page:${page}, itemsPerPage:${PAGE_SIZE}}) { ${CARD_FIELDS} } }`;
      const data = await graphql<{ cards: TcgdexCardFull[] }>(q);
      const batch = data.cards ?? [];
      all.push(...batch);
      onProgress?.(all.length);
      if (batch.length < PAGE_SIZE) break;
    }
  }
  return all;
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
  deName: string | undefined,
  opts?: { series?: string; setCode?: string },
): CatalogCard {
  const deBase = deImageBase(en.image);
  return {
    id: en.id,
    name: en.name,
    nameLower: en.name.toLowerCase(),
    ...(deName ? { nameDe: deName, nameDeLower: deName.toLowerCase() } : {}),
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
    ...(deBase ? { imgSmallDe: tcgdexImage(deBase, 'low'), imgLargeDe: tcgdexImage(deBase, 'high') } : {}),
    variants: mapVariants(en.variants),
    ...(en.illustrator ? { artist: en.illustrator, artistTokens: en.illustrator.toLowerCase().split(/\s+/) } : {}),
  };
}
