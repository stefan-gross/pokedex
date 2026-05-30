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

interface TcgdexSet {
  id: string;
  name: string;
}

/**
 * Holt alle deutschen Set-Namen von TCGdex.
 * Gibt eine Map zurück: tcgdexId → deutscher Name
 * (Next.js cached den fetch serverseitig für 6h)
 */
export async function fetchTcgdexNamesMap(): Promise<Map<string, string>> {
  try {
    const res = await fetch(`${TCGDEX_BASE}/sets`, {
      next: { revalidate: 21600 }, // 6h Cache
    });
    if (!res.ok) return new Map();
    const sets: TcgdexSet[] = await res.json();
    return new Map(sets.map(s => [s.id, s.name]));
  } catch {
    return new Map();
  }
}

/**
 * Gibt den deutschen Namen für eine pokemontcg.io-ID zurück.
 * Konvertiert die ID intern zu TCGdex-Format und schlägt nach.
 */
export function resolveNameDe(
  pokemonTcgId: string,
  namesMap: Map<string, string>,
  fallback: string,
): string {
  const tcgdexId = toTcgdexId(pokemonTcgId);
  return namesMap.get(tcgdexId) ?? fallback;
}
