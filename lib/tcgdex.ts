/**
 * TCGdex API — liefert offizielle deutsche Set-Namen
 * https://api.tcgdex.net/v2/de/sets
 *
 * Die IDs unterscheiden sich von pokemontcg.io:
 *   pokemontcg: sv1, sv3pt5, swsh12pt5, sm35, me1
 *   tcgdex:     sv01, sv03.5, swsh12.5, sm3.5, me01
 */

const TCGDEX_BASE = 'https://api.tcgdex.net/v2/de';

// Spezielle ID-Übersetzungen die keiner Regel folgen
const ID_OVERRIDES: Record<string, string> = {
  'rsv10pt5': 'sv10.5w',
  'zsv10pt5': 'sv10.5b',
  'pgo':      'swsh10.5',
};

/** Konvertiert pokemontcg.io Set-ID → TCGdex Set-ID */
export function toTcgdexId(pokemonTcgId: string): string {
  if (ID_OVERRIDES[pokemonTcgId]) return ID_OVERRIDES[pokemonTcgId];

  let id = pokemonTcgId;

  // "pt5" am Ende → ".5"  (sv3pt5 → sv3.5, swsh12pt5 → swsh12.5)
  id = id.replace(/pt(\d)$/, '.$1');

  // SV / ME mit einstelliger Zahl → führende Null  (sv1 → sv01, me2 → me02)
  id = id.replace(/^(sv|me)(\d)(\.|$)/, (_m, p, d, r) => `${p}0${d}${r}`);

  // SM: sm35 → sm3.5, sm75 → sm7.5  (aber NICHT sm115 → bleibt sm115)
  id = id.replace(/^(sm)(\d)(5)$/, (_m, p, d) => `${p}${d}.5`);

  // SWSH: swsh35 → swsh3.5, swsh45 → swsh4.5
  id = id.replace(/^(swsh)(\d)(5)$/, (_m, p, d) => `${p}${d}.5`);

  return id;
}

/** TCGdex Set-ID → pokemontcg.io Set-ID (Umkehrung von toTcgdexId) */
export function fromTcgdexId(tcgdexId: string): string {
  const reverseOverrides: Record<string, string> = Object.fromEntries(
    Object.entries(ID_OVERRIDES).map(([k, v]) => [v, k])
  );
  if (reverseOverrides[tcgdexId]) return reverseOverrides[tcgdexId];

  let id = tcgdexId;
  // ".X" → "ptX"  (sv3.5 → sv3pt5)
  id = id.replace(/\.(\d)$/, 'pt$1');
  // sv/me führende Null entfernen  (sv01 → sv1, me02 → me2)
  id = id.replace(/^(sv|me)0(\d)(\b|$)/, '$1$2$3');
  return id;
}

/** Sucht deutsche Karten auf TCGdex und gibt pokemontcg.io-kompatible IDs zurück */
export async function searchTcgdexDe(q: string): Promise<string[]> {
  try {
    const res = await fetch(
      `${TCGDEX_BASE}/cards?name=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return [];
    const cards: Array<{ id: string }> = await res.json();
    return cards.map(c => {
      const dash = c.id.lastIndexOf('-');
      if (dash < 0) return c.id;
      const tcgdexSetId = c.id.slice(0, dash);
      const localId     = c.id.slice(dash + 1).replace(/^0+/, '') || '0';
      return `${fromTcgdexId(tcgdexSetId)}-${localId}`;
    });
  } catch {
    return [];
  }
}

export interface TcgdexSetData {
  name: string;
  logo?: string;   // Deutsches Logo-URL (mit .png Extension)
  total?: number;  // Offizielle Kartenanzahl des Sets
}

interface TcgdexApiSet {
  id: string;
  name: string;
  logo?: string;
  cardCount?: { total: number; official: number };
}

/**
 * Holt alle deutschen Set-Daten (Name + Logo) von TCGdex.
 * Gibt eine Map zurück: tcgdexId → { name, logo }
 * (Next.js cached den fetch serverseitig für 6h)
 */
export async function fetchTcgdexDataMap(): Promise<Map<string, TcgdexSetData>> {
  try {
    const res = await fetch(`${TCGDEX_BASE}/sets`, {
      next: { revalidate: 21600 }, // 6h Cache
    });
    if (!res.ok) return new Map();
    const sets: TcgdexApiSet[] = await res.json();
    return new Map(sets.map(s => [
      s.id,
      {
        name:  s.name,
        logo:  s.logo ? `${s.logo}.png` : undefined,
        total: s.cardCount?.official,
      },
    ]));
  } catch {
    return new Map();
  }
}

/**
 * Gibt deutschen Namen + Logo für eine pokemontcg.io-ID zurück.
 */
export function resolveSetDe(
  pokemonTcgId: string,
  dataMap: Map<string, TcgdexSetData>,
  fallbackName: string,
): { nameDe: string; logoDe?: string; total?: number } {
  const tcgdexId = toTcgdexId(pokemonTcgId);
  const data = dataMap.get(tcgdexId);
  return {
    nameDe: data?.name ?? fallbackName,
    logoDe: data?.logo,
    total:  data?.total,
  };
}
