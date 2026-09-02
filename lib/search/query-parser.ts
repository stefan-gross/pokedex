/**
 * Query-Parser für die Katalog-Suche: zerlegt die Eingabe in FREITEXT
 * (Name/Illustrator) + STRUKTURIERTE Filter (Typ, Sonderform-Subtyp, Kartenart).
 * So wird „Glurak ex" = Name „Glurak" + Subtyp „ex", „Feuer ex" = Typ Fire +
 * Subtyp ex, und „ex" allein = alle ex-Karten — statt an der reinen
 * Namenssuche zu scheitern.
 *
 * Nur GANZE Wörter werden als Schlüsselwort erkannt (kein Substring), damit ein
 * Pokémon-Name nicht versehentlich zerlegt wird.
 */
export type Supertype = 'Pokémon' | 'Trainer' | 'Energy';

// Typ-Aliasse (DE + EN, kleingeschrieben) → TCG-Typ.
const TYPE_ALIASES: Record<string, string> = {
  fire: 'Fire', feuer: 'Fire',
  water: 'Water', wasser: 'Water',
  grass: 'Grass', pflanze: 'Grass', pflanzen: 'Grass',
  lightning: 'Lightning', elektro: 'Lightning', blitz: 'Lightning',
  psychic: 'Psychic', psycho: 'Psychic',
  fighting: 'Fighting', kampf: 'Fighting',
  darkness: 'Darkness', finsternis: 'Darkness', dark: 'Darkness',
  metal: 'Metal', stahl: 'Metal',
  dragon: 'Dragon', drache: 'Dragon',
  colorless: 'Colorless', farblos: 'Colorless',
  fairy: 'Fairy', fee: 'Fairy',
};

// Sonderform-Subtypen (kleingeschriebener Schlüssel). Abgleich später
// case-insensitiv gegen `card.subtypes` (Katalog: modern „ex", alt „EX", „V" …).
const SUBTYPE_ALIASES: Record<string, string> = {
  ex: 'ex', gx: 'gx', v: 'v', vmax: 'vmax', vstar: 'vstar',
  'v-union': 'v-union', vunion: 'v-union',
  mega: 'mega', break: 'break', radiant: 'radiant', strahlend: 'radiant', tera: 'tera',
};

const SUPERTYPE_ALIASES: Record<string, Supertype> = {
  pokemon: 'Pokémon', 'pokémon': 'Pokémon',
  trainer: 'Trainer',
  energie: 'Energy', energy: 'Energy',
};

// Subtyp-Schlüssel → tatsächliche Katalog-Werte (für den Browse-Fallback via
// specialMechanics/array-contains). Modernes „ex" UND altes „EX" abdecken.
export const SUBTYPE_CATALOG_VALUES: Record<string, string[]> = {
  ex: ['ex', 'EX'], gx: ['GX'], v: ['V'], vmax: ['VMAX'], vstar: ['VSTAR'],
  'v-union': ['V-UNION'], mega: ['MEGA'], break: ['BREAK'], radiant: ['Radiant'], tera: ['Tera'],
};

export interface ParsedQuery {
  /** Verbleibender Name/Illustrator-Text (Schlüsselwörter entfernt). */
  freeText: string;
  types: string[];
  /** Subtyp-Schlüssel (klein), z.B. ['ex']. */
  subtypes: string[];
  supertype?: Supertype;
  hasStructured: boolean;
}

export function parseSearchQuery(q: string): ParsedQuery {
  const types = new Set<string>();
  const subtypes = new Set<string>();
  let supertype: Supertype | undefined;
  const free: string[] = [];

  for (const raw of q.trim().split(/\s+/).filter(Boolean)) {
    const w = raw.toLowerCase();
    if (TYPE_ALIASES[w]) { types.add(TYPE_ALIASES[w]); continue; }
    if (SUBTYPE_ALIASES[w]) { subtypes.add(SUBTYPE_ALIASES[w]); continue; }
    if (SUPERTYPE_ALIASES[w]) { supertype = SUPERTYPE_ALIASES[w]; continue; }
    free.push(raw);
  }

  return {
    freeText: free.join(' '),
    types: [...types],
    subtypes: [...subtypes],
    supertype,
    hasStructured: types.size > 0 || subtypes.size > 0 || !!supertype,
  };
}

/** Post-Filter: behält nur Karten, die ALLE strukturierten Kriterien erfüllen. */
export function matchesStructured(
  card: { types?: string[]; subtypes?: string[]; supertype?: string },
  p: ParsedQuery,
): boolean {
  if (p.types.length && !(card.types ?? []).some(t => p.types.includes(t))) return false;
  if (p.subtypes.length && !p.subtypes.every(st => (card.subtypes ?? []).some(s => s.toLowerCase() === st))) return false;
  if (p.supertype && card.supertype !== p.supertype) return false;
  return true;
}
