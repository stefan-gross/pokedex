import type { CardInfo } from '@/lib/card-info';

export type CardSortField = 'number' | 'name' | 'pokedex' | 'hp' | 'price';

export interface CardSortOpts {
  field: CardSortField;
  dir: 'asc' | 'desc';
  priceMap?: Map<string, number>;
  /** Während Preise chunkweise laden: stabil nach Nummer sortieren (kein
   *  Springen); die Preis-Sortierung greift einmal, wenn alles geladen ist. */
  pricesLoading?: boolean;
}

/**
 * Gemeinsamer Karten-Comparator für Set-Detail + Wunschlisten-Detail (B2).
 * Preis: fehlende Preise ans Ende (richtungsunabhängig); während des Ladens
 * stabil nach Nummer. Sammlung/Suche nutzt einen abweichenden Comparator
 * (Dex-Fallback 9999, keine Preis-Sortierung) und bleibt separat.
 */
export function compareCardInfo(a: CardInfo, b: CardInfo, o: CardSortOpts): number {
  if (o.field === 'price') {
    if (o.pricesLoading) {
      const na = parseInt(a.number) || 0, nb = parseInt(b.number) || 0;
      return na !== nb ? na - nb : a.number.localeCompare(b.number);
    }
    const pa = o.priceMap?.get(a.id), pb = o.priceMap?.get(b.id);
    if (pa == null && pb == null) return 0;
    if (pa == null) return 1;
    if (pb == null) return -1;
    return o.dir === 'desc' ? pb - pa : pa - pb;
  }
  let cmp = 0;
  if (o.field === 'number') {
    const na = parseInt(a.number) || 0, nb = parseInt(b.number) || 0;
    cmp = na !== nb ? na - nb : a.number.localeCompare(b.number);
  } else if (o.field === 'name') {
    cmp = a.name.localeCompare(b.name);
  } else if (o.field === 'pokedex') {
    cmp = (a.nationalDexNumber ?? 0) - (b.nationalDexNumber ?? 0);
  } else if (o.field === 'hp') {
    cmp = (a.hp ?? 0) - (b.hp ?? 0);
  }
  return o.dir === 'desc' ? -cmp : cmp;
}
