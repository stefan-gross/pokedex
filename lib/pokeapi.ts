const BASE = 'https://pokeapi.co/api/v2';

export interface PokemonStats {
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
}

export interface PokemonAbility {
  name: string;    // deutscher Name, Fallback Englisch
  hidden: boolean;
}

export interface SpeciesDE {
  genus: string;      // "Maus-Pokémon"
  flavorText: string; // Beschreibungstext auf Deutsch
  height: number;     // in dm (4 = 0,4 m)
  weight: number;     // in hg (60 = 6,0 kg)
  region: string;     // "Kanto", "Johto", …
  stats?: PokemonStats;
  abilities?: PokemonAbility[];
  isLegendary?: boolean;
  isMythical?: boolean;
}

const STAT_KEY_MAP: Record<string, keyof PokemonStats> = {
  'hp': 'hp',
  'attack': 'attack',
  'defense': 'defense',
  'special-attack': 'spAttack',
  'special-defense': 'spDefense',
  'speed': 'speed',
};

/** Deutsche Fähigkeiten-Namen — ein Zusatz-Call pro Fähigkeit (PokéAPI liefert
 *  Namen nur pro Fähigkeit einzeln, nicht im Pokémon-Objekt selbst). */
async function fetchAbilityNameDE(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.names?.find((n: { language: { name: string }; name: string }) => n.language.name === 'de')?.name ?? null;
  } catch {
    return null;
  }
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
    let stats: PokemonStats | undefined;
    let abilities: PokemonAbility[] | undefined;
    if (pokemonRes.ok) {
      const pd = await pokemonRes.json();
      height = pd.height ?? 0;
      weight = pd.weight ?? 0;

      const rawStats = (pd.stats ?? []) as { base_stat: number; stat: { name: string } }[];
      const statEntries = rawStats
        .map(s => [STAT_KEY_MAP[s.stat.name], s.base_stat] as const)
        .filter(([key]) => key);
      if (statEntries.length === 6) {
        stats = Object.fromEntries(statEntries) as unknown as PokemonStats;
      }

      const rawAbilities = (pd.abilities ?? []) as { ability: { name: string; url: string }; is_hidden: boolean }[];
      if (rawAbilities.length > 0) {
        const names = await Promise.all(rawAbilities.map(a => fetchAbilityNameDE(a.ability.url)));
        abilities = rawAbilities.map((a, i) => ({
          name: names[i] ?? a.ability.name,
          hidden: a.is_hidden,
        }));
      }
    }
    const isLegendary = !!speciesData.is_legendary;
    const isMythical  = !!speciesData.is_mythical;

    return { genus, flavorText, height, weight, region, stats, abilities, isLegendary, isMythical };
  } catch {
    return null;
  }
}

interface EvolutionChainNode {
  species: { url: string };
  evolves_to: EvolutionChainNode[];
}

async function fetchEvolutionChainRoot(dexNum: number): Promise<EvolutionChainNode | null> {
  try {
    const speciesRes = await fetch(`${BASE}/pokemon-species/${dexNum}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!speciesRes.ok) return null;
    const species = await speciesRes.json();

    const chainRes = await fetch(species.evolution_chain.url, {
      signal: AbortSignal.timeout(5000),
    });
    if (!chainRes.ok) return null;
    const chainData = await chainRes.json();
    return chainData.chain;
  } catch {
    return null;
  }
}

/**
 * Gibt alle Pokédex-Nummern der Evolutionslinie für eine gegebene Pokédex-Nummer zurück.
 * Beispiel: 4 (Charmander) → [4, 5, 6]
 */
export async function getEvolutionFamilyDexNumbers(dexNum: number): Promise<number[]> {
  const chain = await fetchEvolutionChainRoot(dexNum);
  if (!chain) return [dexNum];

  const dexNums: number[] = [];
  function traverse(node: EvolutionChainNode) {
    const id = parseInt(node.species.url.split('/').filter(Boolean).pop() ?? '0');
    if (id > 0) dexNums.push(id);
    node.evolves_to.forEach(traverse);
  }
  traverse(chain);
  return dexNums.length > 0 ? dexNums : [dexNum];
}

/** Verzweigte Evolutionsstruktur — im Gegensatz zu {@link getEvolutionFamilyDexNumbers}
 *  bleibt hier die Baumform (mehrere `children` pro Knoten) erhalten. */
export interface EvolutionTreeNode {
  dexNum: number;
  children: EvolutionTreeNode[];
}

export async function getEvolutionTree(dexNum: number): Promise<EvolutionTreeNode> {
  const chain = await fetchEvolutionChainRoot(dexNum);
  if (!chain) return { dexNum, children: [] };

  function build(node: EvolutionChainNode): EvolutionTreeNode {
    const id = parseInt(node.species.url.split('/').filter(Boolean).pop() ?? '0');
    return { dexNum: id, children: node.evolves_to.map(build) };
  }
  return build(chain);
}
