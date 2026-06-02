const BASE = 'https://pokeapi.co/api/v2';

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
