'use client';

/**
 * useCardBrowser — server-seitig gefilterter, paginierter Browse-Hook.
 *
 * Server-seitig: types[0] > evolutionStage > supertype (Priorität, Composite-Indexes vermieden)
 * Client-seitig: OR-Logik für types, restliche Dimensionen (supertype wenn types aktiv, rarity, owned)
 * Pagination: Cursor-basiert (startAfter), PAGE_SIZE Karten pro Request
 * Kein Laden bis mindestens ein Filter aktiv ist
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { browseCatalog, type BrowseSortKey, type BrowseFilter, type CatalogCard } from '@/lib/firestore/catalog';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { getRarityGroup } from '@/lib/card-constants';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

export type CardBrowserFilter = {
  supertype?:       string;         // 'Pokémon' | 'Trainer' | 'Energy'
  types?:           string[];       // Mehrfachauswahl, OR-Verknüpfung (englisch: 'Fire', 'Water', …)
  evolutionStages?: string[];       // ['Basic'] | ['Stage 1', 'Stage 2'] etc. — leer = alle
  rarity?:          string;         // Rarity-Label aus RARITY_GROUPS
  ownedFilter?:     'all' | 'owned' | 'missing';
  ownedIds?:        Set<string>;
};

const PAGE_SIZE = 50;

function sortCatalogCards(cards: CatalogCard[], sort: BrowseSortKey, desc: boolean): CatalogCard[] {
  const d = desc ? -1 : 1;
  return [...cards].sort((a, b) => {
    if (sort === 'hp')      return d * ((a.hp ?? 0) - (b.hp ?? 0));
    if (sort === 'pokedex') return d * ((a.nationalDexNumber ?? 9999) - (b.nationalDexNumber ?? 9999));
    return d * (a.nameLower ?? a.name.toLowerCase()).localeCompare(b.nameLower ?? b.name.toLowerCase());
  });
}

function applyClientFilters(cards: CatalogCard[], f: CardBrowserFilter): CatalogCard[] {
  let r = cards;

  // Typ-Filter: OR-Verknüpfung — Karte muss mindestens einen der gewählten Typen haben
  if (f.types && f.types.length > 0) {
    r = r.filter(c => c.types?.some(t => f.types!.includes(t)));
  }
  // Supertype client-seitig wenn types server-seitig (kein Composite-Index)
  if (f.types?.length && f.supertype) {
    r = r.filter(c => c.supertype?.toLowerCase() === f.supertype!.toLowerCase());
  }
  // EvolutionStage server-seitig aber supertype trotzdem client-seitig
  if (!f.types?.length && f.evolutionStages?.length && f.supertype) {
    r = r.filter(c => c.supertype?.toLowerCase() === f.supertype!.toLowerCase());
  }
  if (f.evolutionStages && f.evolutionStages.length > 0) {
    r = r.filter(c => f.evolutionStages!.some(s => c.subtypes?.includes(s)));
  }
  if (f.rarity) {
    r = r.filter(c => (getRarityGroup(c.rarity ?? '')?.label ?? 'Sonstige') === f.rarity);
  }
  if (f.ownedFilter === 'owned')   r = r.filter(c => f.ownedIds?.has(c.id));
  if (f.ownedFilter === 'missing') r = r.filter(c => !f.ownedIds?.has(c.id));
  return r;
}

/** Server-Filter-Priorität: types[0] > evolutionStages[0] > supertype */
function makeBrowseFilter(f: CardBrowserFilter): BrowseFilter {
  if (f.types?.length) {
    return { type: f.types[0] };
  }
  if (f.evolutionStages?.length === 1) {
    // Einzelne Stufe server-seitig; mehrere = client-seitig OR
    return { evolutionStage: f.evolutionStages[0] };
  }
  if (f.supertype) {
    return { supertype: f.supertype };
  }
  return {};
}

export function useCardBrowser(sort: BrowseSortKey, filter: CardBrowserFilter, desc = false) {
  const [cards,       setCards]       = useState<CardInfo[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(false);

  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);

  const hasAnyFilter = !!(
    filter.types?.length ||
    filter.supertype ||
    filter.evolutionStages?.length ||
    (filter.ownedFilter && filter.ownedFilter !== 'all') ||
    filter.rarity
  );

  // Stabile Dep-Keys für array-ähnliche Filter
  const typesKey          = [...(filter.types ?? [])].sort().join(',');
  const evolutionStagesKey = [...(filter.evolutionStages ?? [])].sort().join(',');

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
        const sorted = sortCatalogCards(applyClientFilters(page.cards, filter), sort, desc);
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
  }, [typesKey, filter.supertype, evolutionStagesKey, filter.rarity, filter.ownedFilter, sort, desc]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !cursorRef.current) return;
    setLoadingMore(true);
    try {
      const page = await browseCatalog(makeBrowseFilter(filter), cursorRef.current, PAGE_SIZE);
      const sorted = sortCatalogCards(applyClientFilters(page.cards, filter), sort, desc);
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
