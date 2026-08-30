/**
 * Archetyp-Clustering für Turnier-Decklisten (reine Logik, kein I/O). Aus vielen
 * Einzel-Decklisten werden Archetypen: gleiche „Featured"-Angreifer → ein Cluster,
 * mit Häufigkeit (Popularität) und dem best­platzierten Vertreter als Repräsentant.
 * Typen werden ohne Katalog aus den Basis-Energien der Liste abgeleitet.
 */
import type { LtDecklist, LtCard } from './limitless';

export interface ArchetypeSource {
  tournamentId: string;
  tournamentName: string;
  date?: string;
  player: string;
  placing: number;
}

export interface ArchetypeDeck {
  /** Slug (Doc-ID). */
  id: string;
  /** Menschlicher Name, z.B. „Dragapult ex". */
  name: string;
  /** Deck-Typen (aus Basis-Energien abgeleitet), primärer zuerst. */
  types: string[];
  format: string;
  /** Rohe Deckliste des Repräsentanten (Auflösung gegen Katalog beim Verwenden). */
  decklist: LtDecklist;
  totalCards: number;
  /** Wie viele Spieler diesen Archetyp im Sync-Fenster fuhren. */
  popularity: number;
  /** Beste Platzierung im Sample (1 = Sieg). */
  bestPlacing: number;
  source: ArchetypeSource;
  updatedAt: number;
}

/** Eingabe fürs Clustering: eine Deckliste + Kontext. */
export interface DecklistEntry {
  decklist: LtDecklist;
  placing: number;
  player: string;
  tournament: { id: string; name: string; date?: string; format: string };
}

// Basis-Energie-Name (englisch) → TCG-Typ. Nur echte Typ-Energien; spezielle
// Energien (Luminous/Jet/Reversal …) tragen keinen Typ und werden ignoriert.
const ENERGY_TYPE_KEYWORDS: [string, string][] = [
  ['grass', 'Grass'], ['fire', 'Fire'], ['water', 'Water'], ['lightning', 'Lightning'],
  ['psychic', 'Psychic'], ['fighting', 'Fighting'], ['darkness', 'Darkness'], ['metal', 'Metal'],
  ['dragon', 'Dragon'], ['fairy', 'Fairy'],
];

/** Deck-Typen aus den Basis-Energien (nach Menge gewichtet, primärer zuerst). */
export function deriveTypes(dl: LtDecklist): string[] {
  const weight = new Map<string, number>();
  for (const e of dl.energy ?? []) {
    const lower = e.name.toLowerCase();
    for (const [kw, type] of ENERGY_TYPE_KEYWORDS) {
      if (lower.includes(kw)) { weight.set(type, (weight.get(type) ?? 0) + e.count); break; }
    }
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

// „… ex" / „… V" / „… VMAX/VSTAR/GX/BREAK" bzw. „…-GX"/„…-EX" (alte Schreibweise).
const SPECIAL_FORM = /(\s(ex|v|vmax|vstar|gx|break))$|(-(gx|ex))$/i;
export function isSpecialForm(name: string): boolean {
  return SPECIAL_FORM.test(name.trim());
}

/** „Featured" Pokémon = Namensgeber des Archetyps: bevorzugt eine Sonderform mit
 *  der höchsten Anzahl, sonst das häufigste Pokémon überhaupt. */
export function featuredPokemon(dl: LtDecklist): LtCard | null {
  const pk = dl.pokemon ?? [];
  if (pk.length === 0) return null;
  const specials = pk.filter(c => isSpecialForm(c.name));
  const pool = specials.length ? specials : pk;
  return [...pool].sort((a, b) => (b.count - a.count) || b.name.length - a.name.length)[0];
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

/** Clustert Decklisten nach „Featured"-Angreifer zu Archetypen. */
export function clusterArchetypes(entries: DecklistEntry[]): ArchetypeDeck[] {
  const byId = new Map<string, ArchetypeDeck>();
  const now = Date.now();

  for (const e of entries) {
    const feat = featuredPokemon(e.decklist);
    if (!feat) continue;                           // Liste ohne Pokémon → überspringen
    const name = feat.name;
    const id = slugify(`${name}-${e.tournament.format}`);

    const total = [...(e.decklist.pokemon ?? []), ...(e.decklist.trainer ?? []), ...(e.decklist.energy ?? [])].reduce((s, c) => s + c.count, 0);
    const existing = byId.get(id);

    if (!existing) {
      byId.set(id, {
        id, name, types: deriveTypes(e.decklist), format: e.tournament.format,
        decklist: e.decklist, totalCards: total, popularity: 1, bestPlacing: e.placing,
        source: { tournamentId: e.tournament.id, tournamentName: e.tournament.name, date: e.tournament.date, player: e.player, placing: e.placing },
        updatedAt: now,
      });
      continue;
    }
    existing.popularity += 1;
    // Best­platzierte Liste wird Repräsentant.
    if (e.placing < existing.bestPlacing) {
      existing.bestPlacing = e.placing;
      existing.decklist = e.decklist;
      existing.totalCards = total;
      existing.types = deriveTypes(e.decklist);
      existing.source = { tournamentId: e.tournament.id, tournamentName: e.tournament.name, date: e.tournament.date, player: e.player, placing: e.placing };
    }
  }

  return [...byId.values()].sort((a, b) => b.popularity - a.popularity);
}
