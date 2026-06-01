'use client';

/**
 * useCardBrowser — server-seitig gefilterter, paginierter Browse-Hook.
 *
 * Server-seitig (Firestore where): type > evolutionStage > supertype (Priorität)
 * Client-seitig: alle übrigen Dimensionen (supertype wenn type aktiv,
 *                evolutionStage wenn type aktiv, rarity, owned)
 * Sortierung: client-seitig innerhalb jeder Page (vermeidet Composite-Indexes)
 * Pagination: Cursor-basiert (startAfter), PAGE_SIZE Karten pro Request
 * Kein Laden bis mindestens ein Filter aktiv ist
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { browseCatalog, type BrowseSortKey, type BrowseFilter, type CatalogCard } from '@/lib/firestore/catalog';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { getRarityGroup } from '@/lib/card-constants';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

export type CardBrowserFilter = {
  supertype?:      string;              // 'Pokémon' | 'Trainer' | 'Energy'
  type?:           string;              // 'Fire' | 'Darkness' | … (englisch)
  evolutionStage?: string;             // 'Basic' | 'Stage 1' | 'Stage 2'
  rarity?:         string;             // Rarity-Label aus RARITY_GROUPS
  ownedFilter?:    'all' | 'owned' | 'missing';
  ownedIds?:       Set<string>;
};

const PAGE_SIZE = 50;

function sortCatalogCards(cards: CatalogCard[], sort: BrowseSortKey): CatalogCard[] {
  return [...cards].sort((a, b) => {
    if (sort === 'hp')      return (b.hp ?? 0) - (a.hp ?? 0);
    if (sort === 'pokedex') return (a.nationalDexNumber ?? 9999) - (b.nationalDexNumber ?? 9999);
    return (a.nameLower ?? a.name.toLowerCase()).localeCompare(b.nameLower ?? b.name.toLowerCase());
  });
}

function applyClientFilters(cards: CatalogCard[], filter: CardBrowserFilter): CatalogCard[] {
  let r = cards;
  // Supertype client-seitig wenn type server-seitig (kein Composite-Index)
  if (filter.type && filter.supertype) {
    r = r.filter(c => c.supertype?.toLowerCase() === filter.supertype!.toLowerCase());
  }
  // EvolutionStage client-seitig wenn type server-seitig
  if (filter.type && filter.evolutionStage) {
    r = r.filter(c => c.subtypes?.includes(filter.evolutionStage!));
  }
  // EvolutionStage server-seitig wenn kein type → supertype trotzdem client-seitig
  if (!filter.type && filter.evolutionStage && filter.supertype) {
    r = r.filter(c => c.supertype?.toLowerCase() === filter.supertype!.toLowerCase());
  }
  if (filter.rarity) {
    r = r.filter(c => (getRarityGroup(c.rarity)?.label ?? 'Sonstige') === filter.rarity);
  }
  if (filter.ownedFilter === 'owned')   r = r.filter(c => filter.ownedIds?.has(c.id));
  if (filter.ownedFilter === 'missing') r = r.filter(c => !filter.ownedIds?.has(c.id));
  return r;
}

export function useCardBrowser(sort: BrowseSortKey, filter: CardBrowserFilter) {
  const [cards,       setCards]       = useState<CardInfo[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(false);

  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);

  const hasAnyFilter = !!(
    filter.type ||
    filter.supertype ||
    filter.evolutionStage ||
    (filter.ownedFilter && filter.ownedFilter !== 'all') ||
    filter.rarity
  );

  const makeBrowseFilter = (f: CardBrowserFilter): BrowseFilter => ({
    type:           f.type,
    evolutionStage: f.type ? undefined : f.evolutionStage, // type hat Vorrang server-seitig
    supertype:      (f.type || f.evolutionStage) ? undefined : f.supertype,
  });

  useEffect(() => {
    if (!hasAnyFilter) {
      setCards([]);
      setHasMore(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    cursorRef.current = null;
    setCards([]);
    setLoading(true);

    const run = async () => {
      try {
        const page = await browseCatalog(makeBrowseFilter(filter), null, PAGE_SIZE);
        if (cancelled) return;
        const sorted = sortCatalogCards(applyClientFilters(page.cards, filter), sort);
        cursorRef.current = page.cursor;
        setCards(sorted.map(catalogCardToInfo));
        setHasMore(page.hasMore);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.type, filter.supertype, filter.evolutionStage, filter.rarity, filter.ownedFilter, sort]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !cursorRef.current) return;
    setLoadingMore(true);
    try {
      const page = await browseCatalog(makeBrowseFilter(filter), cursorRef.current, PAGE_SIZE);
      const sorted = sortCatalogCards(applyClientFilters(page.cards, filter), sort);
      cursorRef.current = page.cursor;
      setCards(prev => [...prev, ...sorted.map(catalogCardToInfo)]);
      setHasMore(page.hasMore);
    } finally {
      setLoadingMore(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMore, hasMore, filter, sort]);

  return { cards, loading, loadMore, loadingMore, hasMore, hasAnyFilter };
}

export { ENERGY_META } from '@/components/ui/EnergyIcon';
export type { EnergyType as TcgType } from '@/components/ui/EnergyIcon';

export const TCG_TYPES = [
  'Fire', 'Water', 'Grass', 'Lightning', 'Psychic',
  'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless',
] as const;
