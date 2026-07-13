import {
  getCardsBySetId, getCardsByDexNumber, searchCatalogByArtist,
  type CatalogCard,
} from '@/lib/firestore/catalog';
import type { BinderTemplate } from '@/types';
import { NATIONAL_DEX_TOTAL } from './constants';

/** Ein theoretischer Platz im Vorlagen-Binder. `key` ist der Identitäts-
 *  Schlüssel für die Slot-Gewinner-Logik (exakte tcgId bei Illustrator/
 *  Master-Set, Dex-Nummer bei Pokédex/Evolutionslinie). `catalog` enthält
 *  alle Katalog-Einträge, die auf diesen Slot passen (mehrere bei
 *  Pokédex/Master-Set — z.B. alle Drucke einer Kartennummer). */
export interface TemplateSlot {
  key: string;
  order: number;
  catalog: CatalogCard[];
}

function sortByCardNumber(a: CatalogCard, b: CatalogCard): number {
  const na = parseInt(a.number) || 0;
  const nb = parseInt(b.number) || 0;
  return na !== nb ? na - nb : a.number.localeCompare(b.number);
}

/** Alle Karten eines Illustrators — ein Slot pro exakter Karte (kein
 *  Gruppieren), sortiert nach Set + Nummer. `searchCatalogByArtist` matcht
 *  wortweise (array-contains-any), daher zusätzlich auf exakten
 *  `artist`-String filtern, damit z.B. zwei verschiedene "Yuka ..."-
 *  Illustratoren nicht vermischt werden. */
export async function resolveArtistTemplate(artist: string): Promise<TemplateSlot[]> {
  const hits = await searchCatalogByArtist(artist, 500);
  const exact = hits.filter(c => c.artist === artist);
  exact.sort((a, b) => (a.setId === b.setId ? sortByCardNumber(a, b) : a.setId.localeCompare(b.setId)));
  return exact.map((c, i) => ({ key: c.id, order: i, catalog: [c] }));
}

/** Kompletter nationaler Pokédex — ein Slot pro Dex-Nummer 1..1025. In
 *  Chunks parallelisiert, da 1025 Einzel-Queries sonst zu lange dauern.
 *  Dex-Nummern ohne synchronisierte Katalogkarte werden übersprungen (kein
 *  Platzhalterbild verfügbar). */
export async function resolvePokedexTemplate(): Promise<TemplateSlot[]> {
  const CHUNK = 50;
  const slots: TemplateSlot[] = [];
  for (let start = 1; start <= NATIONAL_DEX_TOTAL; start += CHUNK) {
    const nums = Array.from(
      { length: Math.min(CHUNK, NATIONAL_DEX_TOTAL - start + 1) },
      (_, i) => start + i,
    );
    const results = await Promise.all(nums.map(n => getCardsByDexNumber(n, 100)));
    nums.forEach((n, i) => {
      if (results[i].length > 0) slots.push({ key: String(n), order: n, catalog: results[i] });
    });
  }
  return slots;
}

/** Ein oder mehrere Pokémon (eine Dex-Nummer, oder inkl. Entwicklungslinie
 *  mehrere) — wie bei Illustrator EIN Slot pro exakter Karte (kein
 *  Gruppieren nach Dex-Nummer wie bei "pokedex"): jede existierende
 *  Variante/Promo/VMAX/ex/GX/… bekommt ihre eigene Kachel, nichts wird
 *  über die Slot-Gewinner-Regel versteckt. */
export async function resolvePokemonTemplate(dexNumbers: number[]): Promise<TemplateSlot[]> {
  const results = await Promise.all(dexNumbers.map(n => getCardsByDexNumber(n, 200)));
  const all = results.flat();
  all.sort((a, b) => {
    if (a.nationalDexNumber !== b.nationalDexNumber) return (a.nationalDexNumber ?? 0) - (b.nationalDexNumber ?? 0);
    return a.setId === b.setId ? sortByCardNumber(a, b) : a.setId.localeCompare(b.setId);
  });
  return all.map((c, i) => ({ key: c.id, order: i, catalog: [c] }));
}

/** Master-Set einer Erweiterung — ein Slot pro Kartennummer (nicht pro
 *  Variante), `catalog` enthält alle Drucke dieser Nummer (normal, Reverse
 *  Holo, Secret Rare, …) — genau hier greift später die Slot-Gewinner-Regel. */
export async function resolveMasterSetTemplate(setId: string): Promise<TemplateSlot[]> {
  const cards = await getCardsBySetId(setId); // bereits nach Nummer sortiert
  const groups = new Map<string, CatalogCard[]>();
  for (const c of cards) {
    const arr = groups.get(c.number);
    if (arr) arr.push(c); else groups.set(c.number, [c]);
  }
  return Array.from(groups.values()).map((catalog, i) => ({
    key: `${setId}#${catalog[0].number}`,
    order: i,
    catalog,
  }));
}

export async function resolveTemplateSlots(template: BinderTemplate): Promise<TemplateSlot[]> {
  switch (template.type) {
    case 'artist':    return resolveArtistTemplate(template.artist);
    case 'pokedex':   return resolvePokedexTemplate();
    case 'pokemon':   return resolvePokemonTemplate(template.dexNumbers);
    case 'masterSet': return resolveMasterSetTemplate(template.setId);
  }
}
