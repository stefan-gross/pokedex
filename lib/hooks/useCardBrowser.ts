'use client';

/**
 * useCardBrowser — server-seitig gefilterter, paginierter Browse-Hook.
 *
 * Server-seitig: types[0] > evolutionStage > supertype (Priorität, Composite-Indexes vermieden)
 * Client-seitig: OR-Logik für types, restliche Dimensionen (supertype wenn types aktiv, rarity, owned)
 * Pagination: Cursor-basiert (startAfter), PAGE_SIZE Karten pro Request
 * Lädt immer — ohne aktiven Filter wird der gesamte Katalog seitenweise nachgeladen
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { browseCatalog, getCatalogCardsByIds, type BrowseSortKey, type BrowseFilter, type CatalogCard } from '@/lib/firestore/catalog';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { rarityLabelOf, rarityMatchValues } from '@/lib/card-constants';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

export type CardBrowserFilter = {
  setId?:           string;         // Set-ID (z.B. 'sv04') — equality, server-seitig
  supertype?:       string;         // 'Pokémon' | 'Trainer' | 'Energy'
  types?:           string[];       // Mehrfachauswahl, OR-Verknüpfung (englisch: 'Fire', 'Water', …)
  evolutionStages?: string[];       // ['Basic'] | ['Stage 1', 'Stage 2'] etc. — leer = alle
  specialMechanics?: string[];      // ['VMAX'] | ['EX', 'V'] etc. — leer = alle, rein clientseitig
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

  // Set-Filter (client-seitig als Sicherheitsnetz, z.B. wenn ein anderer Filter
  // server-seitig primär ist oder im "Vorhanden"-Pfad per ID geladen wurde).
  if (f.setId) {
    r = r.filter(c => c.setId === f.setId);
  }
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
  if (f.specialMechanics && f.specialMechanics.length > 0) {
    r = r.filter(c => f.specialMechanics!.some(s => c.subtypes?.includes(s)));
  }
  if (f.rarity) {
    r = r.filter(c => rarityLabelOf(c.rarity) === f.rarity);
  }
  if (f.ownedFilter === 'owned')   r = r.filter(c => f.ownedIds?.has(c.id));
  if (f.ownedFilter === 'missing') r = r.filter(c => !f.ownedIds?.has(c.id));
  return r;
}

/** Server-Filter-Priorität: setId > types > rarity > specialMechanics > evolutionStages[0] > supertype */
function makeBrowseFilter(f: CardBrowserFilter): BrowseFilter {
  // Set zuerst: hoch selektiv (~100-300 Karten) → macht alle weiteren Filter
  // (client-seitig über die kleine Set-Menge) ohnehin billig.
  if (f.setId) {
    return { setId: f.setId };
  }
  if (f.types?.length) {
    // ALLE gewählten Typen (OR) server-seitig — vorher nur types[0], wodurch
    // Karten, die nur den zweiten Typ hatten, fehlten.
    return { types: f.types };
  }
  // Rarity server-seitig (als `in`-Werte) — sonst müsste eine seltene Rarity
  // client-seitig durch den ganzen Katalog gepaginiert werden.
  if (f.rarity) {
    const rarityKeys = rarityMatchValues(f.rarity);
    if (rarityKeys.length) return { rarityKeys };
  }
  if (f.specialMechanics?.length) {
    // Sonderformen server-seitig (OR über subtypes) — sonst müsste der ~9%-Filter
    // seitenweise nachladen.
    return { specialMechanics: f.specialMechanics };
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
    filter.specialMechanics?.length ||
    (filter.ownedFilter && filter.ownedFilter !== 'all') ||
    filter.rarity
  );

  // Stabile Dep-Keys für array-ähnliche Filter
  const typesKey           = [...(filter.types ?? [])].sort().join(',');
  const evolutionStagesKey = [...(filter.evolutionStages ?? [])].sort().join(',');
  const specialMechanicsKey = [...(filter.specialMechanics ?? [])].sort().join(',');
  // Nur für den "Vorhanden"-Pfad relevant: ändert sich die Besitzmenge, neu laden.
  const ownedKey = filter.ownedFilter === 'owned'
    ? [...(filter.ownedIds ?? [])].sort().join(',')
    : '';

  useEffect(() => {
    let cancelled = false;
    cursorRef.current = null;
    setCards([]);
    setLoading(true);

    const run = async () => {
      try {
        // "Vorhanden": die Besitz-IDs sind bekannt → gezielt per ID laden statt
        // den ganzen Katalog seitenweise durchzupaginieren (85 Treffer in ~21k
        // wären sonst extrem langsam). Alles auf einmal, kein hasMore.
        if (filter.ownedFilter === 'owned') {
          const ids = [...(filter.ownedIds ?? [])];
          const owned = ids.length ? await getCatalogCardsByIds(ids) : [];
          if (cancelled) return;
          const sorted = sortCatalogCards(applyClientFilters(owned, filter), sort, desc);
          setCards(sorted.map(catalogCardToInfo));
          setHasMore(false);
          return;
        }
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
  }, [filter.setId, typesKey, filter.supertype, evolutionStagesKey, specialMechanicsKey, filter.rarity, filter.ownedFilter, ownedKey, sort, desc]);

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
