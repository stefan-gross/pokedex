'use client';

/**
 * useCardBrowser — server-seitig gefilterter, paginierter Browse-Hook.
 *
 * Architektur:
 * - type / supertype → Firestore where-Clause (server-seitig, schnell)
 * - rarity / owned   → client-seitig auf den 50 zurückgegebenen Karten
 * - Sortierung       → client-seitig (vermeidet Composite-Indexes)
 * - Pagination       → Cursor-basiert (startAfter), 50 Karten pro Seite
 * - Kein Laden bis mindestens ein Filter aktiv ist
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { browseCatalog, type BrowseSortKey, type BrowseFilter, type CatalogCard } from '@/lib/firestore/catalog';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { getRarityGroup } from '@/lib/card-constants';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

export type CardBrowserFilter = {
  supertype?: string;              // 'Pokémon' | 'Trainer' | 'Energy'
  type?: string;                   // 'Fire' | 'Darkness' | … (englisch)
  rarity?: string;                 // Rarity-Label aus RARITY_GROUPS
  ownedFilter?: 'all' | 'owned' | 'missing';
  ownedIds?: Set<string>;
};

const PAGE_SIZE = 50;

/** Sortiert CatalogCards client-seitig (innerhalb einer Page) */
function sortCatalogCards(cards: CatalogCard[], sort: BrowseSortKey): CatalogCard[] {
  return [...cards].sort((a, b) => {
    if (sort === 'hp')     return (b.hp ?? 0) - (a.hp ?? 0);
    if (sort === 'pokedex') return (a.nationalDexNumber ?? 9999) - (b.nationalDexNumber ?? 9999);
    return (a.nameLower ?? a.name.toLowerCase()).localeCompare(b.nameLower ?? b.name.toLowerCase());
  });
}

/** Client-seitige Filter: rarity + owned (supertype wenn type auch gesetzt) */
function applyClientFilters(cards: CatalogCard[], filter: CardBrowserFilter): CatalogCard[] {
  let r = cards;
  // supertype client-seitig wenn type server-seitig gefiltert wird (kein Composite-Index)
  if (filter.type && filter.supertype) {
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

  /** Mindestens ein Filter muss aktiv sein */
  const hasAnyFilter = !!(
    filter.type ||
    filter.supertype ||
    (filter.ownedFilter && filter.ownedFilter !== 'all') ||
    filter.rarity
  );

  // Initial-Fetch: reset bei Filter- oder Sort-Änderung
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
        const browseFilter: BrowseFilter = {
          type:      filter.type,
          supertype: filter.type ? undefined : filter.supertype, // type hat Vorrang
        };
        const page = await browseCatalog(browseFilter, null, PAGE_SIZE);
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
  }, [filter.type, filter.supertype, filter.rarity, filter.ownedFilter, sort]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !cursorRef.current) return;
    setLoadingMore(true);

    try {
      const browseFilter: BrowseFilter = {
        type:      filter.type,
        supertype: filter.type ? undefined : filter.supertype,
      };
      const page = await browseCatalog(browseFilter, cursorRef.current, PAGE_SIZE);

      const sorted = sortCatalogCards(applyClientFilters(page.cards, filter), sort);
      cursorRef.current = page.cursor;
      setCards(prev => [...prev, ...sorted.map(catalogCardToInfo)]);
      setHasMore(page.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, filter, sort]);

  return { cards, loading, loadMore, loadingMore, hasMore, hasAnyFilter };
}

export { ENERGY_META } from '@/components/ui/EnergyIcon';
export type { EnergyType as TcgType } from '@/components/ui/EnergyIcon';

/** Alle Pokémon-Typen aus dem TCG (englische API-Strings) */
export const TCG_TYPES = [
  'Fire', 'Water', 'Grass', 'Lightning', 'Psychic',
  'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless',
] as const;
