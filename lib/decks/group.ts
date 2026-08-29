/**
 * Anzeige-Gruppierung der Deckkarten: dieselbe Karte über mehrere Drucke UND
 * Sprachen (EN/DE) wird zu EINER Zeile zusammengefasst (Count summiert,
 * deutscher Name bevorzugt). Schlüssel = cardIdentityKey (englischer
 * Katalogname). Genutzt vom Editor und der KI-Entwurfsansicht.
 */
import { cardIdentityKey } from './rules';
import type { CatalogCard } from '../firestore/catalog';
import type { DeckCardRef } from '@/types';

export interface DeckGroup {
  key: string;
  displayName: string;
  /** Haupt-Druck (meiste Kopien; bevorzugt mit deutschem Namen) — Bild + „+". */
  primary: DeckCardRef;
  prints: DeckCardRef[];
  total: number;
}

export function groupDeckRows(refs: DeckCardRef[], byId: Map<string, CatalogCard>): DeckGroup[] {
  const groups = new Map<string, DeckCardRef[]>();
  for (const ref of refs) {
    const key = cardIdentityKey(ref.catalogId, byId, ref.name);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(ref);
  }
  return [...groups.entries()].map(([key, prints]) => {
    const primary = [...prints].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;                       // meiste Kopien
      const ade = byId.get(a.catalogId)?.nameDe ? 1 : 0, bde = byId.get(b.catalogId)?.nameDe ? 1 : 0;
      return bde - ade;                                                        // dann dt. Name
    })[0];
    const displayName = byId.get(primary.catalogId)?.nameDe
      ?? prints.map(p => byId.get(p.catalogId)?.nameDe).find(Boolean)
      ?? primary.name;
    return { key, displayName, primary, prints, total: prints.reduce((s, p) => s + p.count, 0) };
  });
}
