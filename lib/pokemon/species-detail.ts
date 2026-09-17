/**
 * Fakten einer Pokémon-Art für die Detailseite `/pokemon/[dex]` — direkt aus der
 * PokéAPI (deutsche Beschreibung, Kategorie, Typen, Größe/Gewicht, Region,
 * Fähigkeiten, Evolution). Wird als Quelle bzw. Fallback genutzt; die überlappenden
 * Textfakten (Kategorie/Beschreibung/Größe/Gewicht/Region) liest die Seite bevorzugt
 * aus dem Katalog (Firestore-First, s. `getCardsByDexNumberRest`).
 *
 * Client-sicher: nur `fetch`, kein firebase-admin. PokéAPI erlaubt CORS.
 */

const BASE = 'https://pokeapi.co/api/v2';

/** Englische PokéAPI-Typnamen → deutsch (18 Typen). */
const TYPE_DE: Record<string, string> = {
  normal: 'Normal', fire: 'Feuer', water: 'Wasser', electric: 'Elektro', grass: 'Pflanze',
  ice: 'Eis', fighting: 'Kampf', poison: 'Gift', ground: 'Boden', flying: 'Flug',
  psychic: 'Psycho', bug: 'Käfer', rock: 'Gestein', ghost: 'Geist', dragon: 'Drache',
  dark: 'Unlicht', steel: 'Stahl', fairy: 'Fee',
};

/** Generation-ID (PokéAPI) → deutsche Regionsbezeichnung. */
const GENERATION_REGIONS: Record<string, string> = {
  '1': 'Kanto', '2': 'Johto', '3': 'Hoenn', '4': 'Sinnoh', '5': 'Einall',
  '6': 'Kalos', '7': 'Alola', '8': 'Galar', '9': 'Paldea',
};

export interface BaseStats {
  hp: number; attack: number; defense: number; spAttack: number; spDefense: number; speed: number;
}

export interface EvoStep {
  dex: number;
  stage: number;          // 0 = Basis, 1 = Phase 1, 2 = Phase 2, …
}

export interface SpeciesDetail {
  dex: number;
  genus: string;          // z.B. "Maus-Pokémon"
  flavorText: string;     // deutsche Beschreibung
  height: number;         // Dezimeter (4 = 0,4 m)
  weight: number;         // Hektogramm (60 = 6,0 kg)
  region: string;
  typesDe: string[];      // deutsche Typen (Reihenfolge = Slot)
  abilities: { name: string; hidden: boolean }[];
  isLegendary: boolean;
  isMythical: boolean;
  stats: BaseStats | null;   // Basiswerte
  catchRate: number | null;  // Fangrate (0–255)
  genderRate: number | null; // -1 = geschlechtslos, sonst Weibchen-Anteil in Achteln (0–8)
  evolution: EvoStep[];      // Evolutionslinie mit Entwicklungsstufe
}

const STAT_KEY: Record<string, keyof BaseStats> = {
  hp: 'hp', attack: 'attack', defense: 'defense',
  'special-attack': 'spAttack', 'special-defense': 'spDefense', speed: 'speed',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
async function abilityNameDE(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d.names?.find((n: any) => n.language?.name === 'de')?.name ?? null;
  } catch { return null; }
}

/** Fakten einer Art per National-Dex-Nummer. `null` bei Netzfehler/unbekannter Nr. */
export async function fetchSpeciesDetail(dex: number): Promise<SpeciesDetail | null> {
  try {
    const [sr, pr] = await Promise.all([
      fetch(`${BASE}/pokemon-species/${dex}`, { signal: AbortSignal.timeout(6000) }),
      fetch(`${BASE}/pokemon/${dex}`,         { signal: AbortSignal.timeout(6000) }),
    ]);
    if (!sr.ok) return null;
    const sd: any = await sr.json();

    const genus = sd.genera?.find((g: any) => g.language?.name === 'de')?.genus ?? '';
    const flavorText = [...(sd.flavor_text_entries ?? [])]
      .filter((e: any) => e.language?.name === 'de')
      .pop()?.flavor_text?.replace(/[\f\n\r­]/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
    const genId = sd.generation?.url?.split('/').filter(Boolean).pop() ?? '';
    const region = GENERATION_REGIONS[genId] ?? '';
    const isLegendary = !!sd.is_legendary;
    const isMythical = !!sd.is_mythical;
    const catchRate = typeof sd.capture_rate === 'number' ? sd.capture_rate : null;
    const genderRate = typeof sd.gender_rate === 'number' ? sd.gender_rate : null;

    let height = 0, weight = 0, typesDe: string[] = [], abilities: { name: string; hidden: boolean }[] = [];
    let stats: BaseStats | null = null;
    if (pr.ok) {
      const pd: any = await pr.json();
      height = pd.height ?? 0;
      weight = pd.weight ?? 0;
      typesDe = ((pd.types ?? []) as any[])
        .sort((a, b) => a.slot - b.slot)
        .map(t => TYPE_DE[t.type?.name] ?? t.type?.name ?? '')
        .filter(Boolean);
      const raw = (pd.abilities ?? []) as any[];
      const names = await Promise.all(raw.map(a => abilityNameDE(a.ability?.url)));
      abilities = raw.map((a, i) => ({ name: names[i] ?? a.ability?.name ?? '', hidden: !!a.is_hidden })).filter(a => a.name);
      const rawStats = (pd.stats ?? []) as { base_stat: number; stat: { name: string } }[];
      const entries = rawStats.map(s => [STAT_KEY[s.stat?.name], s.base_stat] as const).filter(([k]) => k);
      if (entries.length === 6) stats = Object.fromEntries(entries) as unknown as BaseStats;
    }

    // Evolutionslinie mit Entwicklungsstufe (Tiefe im Evolutionsbaum)
    let evolution: EvoStep[] = [{ dex, stage: 0 }];
    try {
      const ecUrl = sd.evolution_chain?.url;
      if (ecUrl) {
        const cr = await fetch(ecUrl, { signal: AbortSignal.timeout(6000) });
        if (cr.ok) {
          const cd: any = await cr.json();
          const out: EvoStep[] = [];
          const walk = (n: any, stage: number) => {
            const id = parseInt(n.species?.url?.split('/').filter(Boolean).pop() ?? '0', 10);
            if (id > 0) out.push({ dex: id, stage });
            (n.evolves_to ?? []).forEach((c: any) => walk(c, stage + 1));
          };
          walk(cd.chain, 0);
          if (out.length) evolution = out;
        }
      }
    } catch { /* Evolution optional */ }

    return { dex, genus, flavorText, height, weight, region, typesDe, abilities, isLegendary, isMythical, stats, catchRate, genderRate, evolution };
  } catch { return null; }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
