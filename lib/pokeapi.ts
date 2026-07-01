const BASE = 'https://pokeapi.co/api/v2';

export interface SpeciesDE {
  genus: string;      // "Maus-Pokémon"
  flavorText: string; // Beschreibungstext auf Deutsch
  height: number;     // in dm (4 = 0,4 m)
  weight: number;     // in hg (60 = 6,0 kg)
  region: string;     // "Kanto", "Johto", …
}

function extractSpeciesName(cardName: string): string {
  return cardName
    .replace(/\s+(ex|EX|V|VMAX|VSTAR|GX|TAG TEAM|LEGEND|BREAK|Prime|Radiant|◇|★|Tera|Iron|Ancient|Future)(\s|$).*/i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

const GENERATION_REGIONS: Record<string, string> = {
  '1': 'Kanto', '2': 'Johto',  '3': 'Hoenn',  '4': 'Sinnoh',
  '5': 'Einall','6': 'Kalos',  '7': 'Alola',  '8': 'Galar',  '9': 'Paldea',
};

/**
 * Lädt deutsche Pokémon-Artinfos (Genus, Beschreibung, Größe, Gewicht, Region)
 * von der PokéAPI. Gibt null zurück wenn kein Pokémon oder Fehler.
 */
export async function fetchPokemonSpeciesDE(
  cardName: string,
  supertype?: string,
): Promise<SpeciesDE | null> {
  if (supertype && !['pokémon', 'pokemon'].includes(supertype.toLowerCase())) return null;
  try {
    const slug = extractSpeciesName(cardName);
    if (!slug) return null;

    const [speciesRes, pokemonRes] = await Promise.all([
      fetch(`${BASE}/pokemon-species/${slug}`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${BASE}/pokemon/${slug}`,         { signal: AbortSignal.timeout(5000) }),
    ]);
    if (!speciesRes.ok) return null;

    const speciesData = await speciesRes.json();
    const genus = speciesData.genera
      ?.find((g: { language: { name: string }; genus: string }) => g.language.name === 'de')
      ?.genus ?? '';
    const flavorText = [...(speciesData.flavor_text_entries ?? [])]
      .filter((e: { language: { name: string }; flavor_text: string }) => e.language.name === 'de')
      .pop()
      ?.flavor_text?.replace(/[\f\n]/g, ' ') ?? '';
    const generationId = speciesData.generation?.url?.split('/').filter(Boolean).pop() ?? '';
    const region = GENERATION_REGIONS[generationId] ?? '';

    let height = 0, weight = 0;
    if (pokemonRes.ok) {
      const pd = await pokemonRes.json();
      height = pd.height ?? 0;
      weight = pd.weight ?? 0;
    }

    return { genus, flavorText, height, weight, region };
  } catch {
    return null;
  }
}

/**
 * Gibt alle Pokédex-Nummern der Evolutionslinie für eine gegebene Pokédex-Nummer zurück.
 * Beispiel: 4 (Charmander) → [4, 5, 6]
 */
export async function getEvolutionFamilyDexNumbers(dexNum: number): Promise<number[]> {
  try {
    const speciesRes = await fetch(`${BASE}/pokemon-species/${dexNum}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!speciesRes.ok) return [dexNum];
    const species = await speciesRes.json();

    const chainRes = await fetch(species.evolution_chain.url, {
      signal: AbortSignal.timeout(5000),
    });
    if (!chainRes.ok) return [dexNum];
    const chainData = await chainRes.json();

    const dexNums: number[] = [];
    function traverse(node: { species: { url: string }; evolves_to: typeof node[] }) {
      const id = parseInt(node.species.url.split('/').filter(Boolean).pop() ?? '0');
      if (id > 0) dexNums.push(id);
      node.evolves_to.forEach(traverse);
    }
    traverse(chainData.chain);
    return dexNums.length > 0 ? dexNums : [dexNum];
  } catch {
    return [dexNum];
  }
}
