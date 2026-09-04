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
import { browseCatalog, getBrowseCount, getCatalogCardsByIds, type BrowseSortKey, type BrowseFilter, type CatalogCard } from '@/lib/firestore/catalog';
import {
  browseCatalogRest, browseUnpricedRest, getBrowseCountRest, getCatalogCardsByIdsRest,
} from '@/lib/firestore/catalog-rest';
import { trendFromCached } from '@/lib/prices/trend-from-cached';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { rarityLabelOf, rarityMatchValues } from '@/lib/card-constants';

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
// Bei aktivem Filter mit überschaubarer Treffermenge: alle Treffer laden und
// komplett clientseitig sortieren (globale Sortierung statt nur der Seite).
// Größere gefilterte Mengen (breite Typ-/Rarity-Filter) bleiben paginiert
// (seiten-lokale Sortierung) — ein globaler Server-Sort bräuchte dort je einen
// Composite-Index (Index-Explosion). Cap deckt Sets + selektive Filter ab.
const LOAD_ALL_CAP = 800;

function sortCatalogCards(cards: CatalogCard[], sort: BrowseSortKey, desc: boolean): CatalogCard[] {
  const d = desc ? -1 : 1;
  return [...cards].sort((a, b) => {
    if (sort === 'hp')      return d * ((a.hp ?? 0) - (b.hp ?? 0));
    if (sort === 'pokedex') return d * ((a.nationalDexNumber ?? 9999) - (b.nationalDexNumber ?? 9999));
    if (sort === 'price') {
      // Preis aus dem inline gecachten `prices`-Feld; Karten OHNE Preis immer ans
      // Ende (unabhängig von der Richtung).
      const pa = trendFromCached(a.prices), pb = trendFromCached(b.prices);
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return d * (pa - pb);
    }
    // Sortier-Name (deutsch, engl. Fallback) — passt zur Anzeige; Fallbacks für
    // Alt-Bestände ohne das Feld.
    const an = a.nameSortLower ?? a.nameDeLower ?? a.nameLower ?? a.name.toLowerCase();
    const bn = b.nameSortLower ?? b.nameDeLower ?? b.nameLower ?? b.name.toLowerCase();
    return d * an.localeCompare(bn, 'de');
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

/** Erstseite eines Browse-Reads: REST (schnell, kein WebChannel-Cold-Start);
 *  scheitert REST, greift der SDK-Weg als Sicherheitsnetz. */
async function browseFirstPage(filter: BrowseFilter, size: number, sort: BrowseSortKey, desc: boolean) {
  try {
    return await browseCatalogRest(filter, null, size, sort, desc);
  } catch (e) {
    console.warn('[browse] REST fehlgeschlagen → SDK-Fallback', e);
    const p = await browseCatalog(filter, null, size, sort, desc);
    return { cards: p.cards, hasMore: p.hasMore };
  }
}

export function useCardBrowser(sort: BrowseSortKey, filter: CardBrowserFilter, desc = false) {
  const [cards,       setCards]       = useState<CardInfo[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(false);

  // Cursor = zuletzt geladene Karte (REST-startAfter). Früher ein SDK-
  // QueryDocumentSnapshot; die Browse-Reads laufen jetzt über REST (kein
  // WebChannel-Cold-Start), siehe catalog-rest.ts.
  const cursorRef = useRef<CatalogCard | null>(null);
  // Ladephase für den ungefilterten Preis-Sort: erst Karten MIT Preis
  // (serverseitig sortiert), dann als Schluss-Block die Karten OHNE Preis.
  const phaseRef = useRef<'main' | 'tail' | 'done'>('main');

  // Ungefilterter Preis-Sort → zweiphasiges Laden (Karten ohne Preis ans Ende),
  // damit ALLE Karten sichtbar bleiben statt bei orderBy('priceEur') zu fehlen.
  const noServerWhere = Object.keys(makeBrowseFilter(filter)).length === 0;
  const unfilteredPriceSort = sort === 'price' && noServerWhere && filter.ownedFilter !== 'owned';

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
    phaseRef.current = 'main';
    setCards([]);
    setLoading(true);

    const run = async () => {
      try {
        // "Vorhanden": die Besitz-IDs sind bekannt → gezielt per ID laden statt
        // den ganzen Katalog seitenweise durchzupaginieren (85 Treffer in ~21k
        // wären sonst extrem langsam). Alles auf einmal, kein hasMore.
        if (filter.ownedFilter === 'owned') {
          const ids = [...(filter.ownedIds ?? [])];
          let owned: CatalogCard[] = [];
          if (ids.length) {
            try { owned = await getCatalogCardsByIdsRest(ids); }
            catch { owned = await getCatalogCardsByIds(ids); } // SDK-Fallback
          }
          if (cancelled) return;
          const sorted = sortCatalogCards(applyClientFilters(owned, filter), sort, desc);
          setCards(sorted.map(catalogCardToInfo));
          setHasMore(false);
          return;
        }
        const serverFilter = makeBrowseFilter(filter);

        // Aktiver (server-seitiger) Filter mit überschaubarer Treffermenge →
        // ALLE Treffer laden + global clientseitig sortieren (statt nur die
        // geladene Seite). Bounded via Count; darüber bleibt es paginiert.
        if (Object.keys(serverFilter).length > 0) {
          let total = await getBrowseCountRest(serverFilter);
          if (total < 0) total = await getBrowseCount(serverFilter); // SDK-Fallback
          if (cancelled) return;
          if (total >= 0 && total <= LOAD_ALL_CAP) {
            // Ganze (kleine) Treffermenge in EINEM REST-Read; global sortieren.
            let all: CatalogCard[];
            try { all = (await browseCatalogRest(serverFilter, null, LOAD_ALL_CAP, sort, desc)).cards; }
            catch { all = (await browseCatalog(serverFilter, null, LOAD_ALL_CAP, sort, desc)).cards; }
            if (cancelled) return;
            const sortedAll = sortCatalogCards(applyClientFilters(all, filter), sort, desc);
            setCards(sortedAll.map(catalogCardToInfo));
            setHasMore(false);
            return;
          }
        }

        const page = await browseFirstPage(serverFilter, PAGE_SIZE, sort, desc);
        if (cancelled) return;
        const sorted = sortCatalogCards(applyClientFilters(page.cards, filter), sort, desc);
        cursorRef.current = page.cards[page.cards.length - 1] ?? null;
        setCards(sorted.map(catalogCardToInfo));
        // Preis-Sort: nach den Karten MIT Preis noch die ohne Preis anhängen →
        // hasMore bleibt true, nächster loadMore lädt den „tail".
        if (page.hasMore) setHasMore(true);
        else if (unfilteredPriceSort) { phaseRef.current = 'tail'; cursorRef.current = null; setHasMore(true); }
        else setHasMore(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.setId, typesKey, filter.supertype, evolutionStagesKey, specialMechanicsKey, filter.rarity, filter.ownedFilter, ownedKey, sort, desc]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    // In der Haupt-Phase braucht es einen Cursor; in der Tail-Phase startet der
    // erste Aufruf bewusst ohne Cursor (cursorRef wurde auf null gesetzt).
    if (phaseRef.current === 'main' && !cursorRef.current) return;
    setLoadingMore(true);
    try {
      if (phaseRef.current === 'tail') {
        const page = await browseUnpricedRest(cursorRef.current, PAGE_SIZE);
        cursorRef.current = page.cards[page.cards.length - 1] ?? cursorRef.current;
        // Karten ohne Preis: Client-Filter (z.B. „Fehlen") respektieren, aber
        // nicht nach Preis sortieren (keiner vorhanden) → Doc-ID-Reihenfolge.
        setCards(prev => [...prev, ...applyClientFilters(page.cards, filter).map(catalogCardToInfo)]);
        if (page.hasMore) setHasMore(true);
        else { phaseRef.current = 'done'; setHasMore(false); }
        return;
      }
      const page = await browseCatalogRest(makeBrowseFilter(filter), cursorRef.current, PAGE_SIZE, sort, desc);
      const sorted = sortCatalogCards(applyClientFilters(page.cards, filter), sort, desc);
      cursorRef.current = page.cards[page.cards.length - 1] ?? cursorRef.current;
      setCards(prev => [...prev, ...sorted.map(catalogCardToInfo)]);
      if (page.hasMore) setHasMore(true);
      else if (unfilteredPriceSort) { phaseRef.current = 'tail'; cursorRef.current = null; setHasMore(true); }
      else setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMore, hasMore, filter, sort, desc, unfilteredPriceSort]);

  return { cards, loading, loadMore, loadingMore, hasMore, hasAnyFilter };
}

export { ENERGY_META } from '@/components/ui/EnergyIcon';
export type { EnergyType as TcgType } from '@/components/ui/EnergyIcon';

export const TCG_TYPES = [
  'Fire', 'Water', 'Grass', 'Lightning', 'Psychic',
  'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless',
] as const;
