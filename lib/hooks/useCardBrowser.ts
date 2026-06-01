'use client';

/**
 * useCardBrowser — paginierter Browse-Hook für den Catalog.
 *
 * Wiederverwendbar für: Suchseite (Browse-Modus), Mappen, zukünftige Listen.
 *
 * Architektur-Prinzip: keine Logik in Pages duplizieren.
 * Filter (type, supertype, rarity, owned) laufen client-seitig,
 * damit keine Firestore Composite-Indexes gebraucht werden.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { browseCatalog, type BrowseSortKey, type CatalogCard } from '@/lib/firestore/catalog';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { getRarityGroup } from '@/lib/card-constants';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

export type CardBrowserFilter = {
  supertype?: string;    // 'Pokémon' | 'Trainer' | 'Energy' | undefined = alle
  type?: string;         // 'Fire' | 'Water' | … | undefined = alle
  rarity?: string;       // Rarity-Label aus RARITY_GROUPS | undefined = alle
  ownedFilter?: 'all' | 'owned' | 'missing';
  ownedIds?: Set<string>;
};

const PAGE_TARGET   = 50;   // Wie viele Karten wir anzeigen wollen pro "Seite"
const FETCH_SIZE    = 100;  // Wie viele wir pro Firestore-Request laden

function matchesFilter(card: CatalogCard, f: CardBrowserFilter): boolean {
  if (f.supertype && card.supertype?.toLowerCase() !== f.supertype.toLowerCase()) return false;
  if (f.type      && !card.types?.includes(f.type))                               return false;
  if (f.rarity) {
    const g = card.rarity ? getRarityGroup(card.rarity) : null;
    if ((g?.label ?? 'Sonstige') !== f.rarity) return false;
  }
  if (f.ownedFilter === 'owned'   && !f.ownedIds?.has(card.id)) return false;
  if (f.ownedFilter === 'missing' &&  f.ownedIds?.has(card.id)) return false;
  return true;
}

interface State {
  cards: CardInfo[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
}

export function useCardBrowser(sort: BrowseSortKey, filter: CardBrowserFilter) {
  const [state, setState] = useState<State>({
    cards: [], loading: false, loadingMore: false, hasMore: true,
  });

  // Cursor und Buffer bleiben zwischen fetchMore-Aufrufen erhalten
  const cursorRef  = useRef<QueryDocumentSnapshot | null>(null);
  const bufferRef  = useRef<CatalogCard[]>([]);   // bereits gefetcht, noch nicht gefiltert angezeigt
  const exhausted  = useRef(false);               // keine weiteren Firestore-Docs mehr

  // Holt so viele Batches bis wir `needed` passende Karten haben
  const loadUntilFull = useCallback(async (
    already: CardInfo[],
    needed: number,
    isInitial: boolean,
  ) => {
    const collected: CardInfo[] = [...already];

    while (collected.length < needed && !exhausted.current) {
      // Zuerst aus dem Buffer bedienen
      if (bufferRef.current.length > 0) {
        const matching = bufferRef.current.filter(c => matchesFilter(c, filter));
        bufferRef.current = bufferRef.current.filter(c => !matchesFilter(c, filter));
        collected.push(...matching.map(catalogCardToInfo));
        continue;
      }
      // Buffer leer → neuen Batch von Firestore holen
      const page = await browseCatalog(sort, cursorRef.current, FETCH_SIZE);
      cursorRef.current = page.cursor;
      if (!page.hasMore) exhausted.current = true;

      const matching    = page.cards.filter(c => matchesFilter(c, filter));
      const notMatching = page.cards.filter(c => !matchesFilter(c, filter));
      bufferRef.current = notMatching; // rest in Buffer für nächstes loadMore
      collected.push(...matching.map(catalogCardToInfo));
    }

    setState({
      cards:       collected.slice(0, needed),
      loading:     false,
      loadingMore: false,
      hasMore:     collected.length >= needed || !exhausted.current,
    });
  }, [sort, filter]);

  // Reset + neu laden wenn sort oder filter sich ändern
  useEffect(() => {
    cursorRef.current  = null;
    bufferRef.current  = [];
    exhausted.current  = false;
    setState({ cards: [], loading: true, loadingMore: false, hasMore: true });
    loadUntilFull([], PAGE_TARGET, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, JSON.stringify(filter)]);

  const loadMore = useCallback(() => {
    if (state.loadingMore || !state.hasMore) return;
    setState(s => ({ ...s, loadingMore: true }));
    loadUntilFull(state.cards, state.cards.length + PAGE_TARGET, false);
  }, [state, loadUntilFull]);

  return { ...state, loadMore };
}

export { ENERGY_META } from '@/components/ui/EnergyIcon';
export type { EnergyType as TcgType } from '@/components/ui/EnergyIcon';

/** Alle Pokémon-Typen aus dem TCG (englische API-Strings) */
export const TCG_TYPES = [
  'Fire', 'Water', 'Grass', 'Lightning', 'Psychic',
  'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless',
] as const;
