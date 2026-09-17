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
  evolution: number[];    // Dex-Nummern der Evolutionslinie (Reihenfolge)
}

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

    let height = 0, weight = 0, typesDe: string[] = [], abilities: { name: string; hidden: boolean }[] = [];
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
    }

    // Evolutionslinie (flach, Reihenfolge der Kette)
    let evolution: number[] = [dex];
    try {
      const ecUrl = sd.evolution_chain?.url;
      if (ecUrl) {
        const cr = await fetch(ecUrl, { signal: AbortSignal.timeout(6000) });
        if (cr.ok) {
          const cd: any = await cr.json();
          const out: number[] = [];
          const walk = (n: any) => {
            const id = parseInt(n.species?.url?.split('/').filter(Boolean).pop() ?? '0', 10);
            if (id > 0) out.push(id);
            (n.evolves_to ?? []).forEach(walk);
          };
          walk(cd.chain);
          if (out.length) evolution = out;
        }
      }
    } catch { /* Evolution optional */ }

    return { dex, genus, flavorText, height, weight, region, typesDe, abilities, isLegendary, isMythical, evolution };
  } catch { return null; }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
