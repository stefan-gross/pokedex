'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, X, Database, ChevronDown } from 'lucide-react';
import { CardGrid } from '@/components/card/CardGrid';
import { RarityFilterBar } from '@/components/card/RarityFilterBar';
import { ButtonGroup } from '@/components/ui/button-group';
import { getCards } from '@/lib/firestore/cards';
import { searchCatalog, getCatalogCount, getCatalogFilterCounts } from '@/lib/firestore/catalog';
import { catalogCardToInfo, tcgApiCardToInfo, type CardInfo } from '@/lib/card-info';
import { getRarityGroup } from '@/lib/card-constants';
import { useCardBrowser, TCG_TYPES, type TcgType, type CardBrowserFilter } from '@/lib/hooks/useCardBrowser';
import { EnergyIcon, ENERGY_META } from '@/components/ui/EnergyIcon';
import type { TcgApiCard } from '@/lib/pokemon-tcg';
import type { CardDoc } from '@/types';
import type { BrowseSortKey } from '@/lib/firestore/catalog';

type OwnedFilter  = 'all' | 'owned' | 'missing';
type SearchSortKey = 'number' | 'name';
type Supertype    = 'Pokémon' | 'Trainer' | 'Energy';
type FilterCounts = { types: Record<string, number>; supertypes: Record<string, number> };

const OWNED_OPTIONS: { value: OwnedFilter; label: string }[] = [
  { value: 'all',     label: 'Alle'      },
  { value: 'owned',   label: 'Vorhanden' },
  { value: 'missing', label: 'Fehlen'    },
];

const BROWSE_SORT_OPTIONS: { value: BrowseSortKey; label: string }[] = [
  { value: 'name',    label: 'A–Z'          },
  { value: 'hp',      label: 'KP (höchste)' },
  { value: 'pokedex', label: 'Pokédex-Nr.'  },
];

function fmt(n: number) {
  return n.toLocaleString('de');
}

function CollectionContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const initialQ     = searchParams.get('q') ?? '';

  // ── Suche ─────────────────────────────────────────────────────
  const [inputValue,       setInputValue]       = useState(initialQ);
  const [results,          setResults]          = useState<CardInfo[]>([]);
  const [ownedCards,       setOwnedCards]       = useState<CardDoc[]>([]);
  const [searchLoading,    setSearchLoading]    = useState(false);
  const [searchSort,       setSearchSort]       = useState<SearchSortKey>('number');
  const [filterSet,        setFilterSet]        = useState('');
  const [sets,             setSets]             = useState<{ id: string; name: string }[]>([]);
  const [catalogCount,     setCatalogCount]     = useState(0);
  const [source,           setSource]           = useState<'catalog' | 'api' | null>(null);
  const [searchOwned,      setSearchOwned]      = useState<OwnedFilter>('all');
  const [activeRarities,   setActiveRarities]   = useState<Set<string>>(new Set());
  const [searchSupertype,  setSearchSupertype]  = useState<Supertype | 'all'>('all');
  const [searchType,       setSearchType]       = useState<TcgType | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Browse (State jetzt hier, damit Filter sticky im Header) ──
  const [browseSort,       setBrowseSort]       = useState<BrowseSortKey>('name');
  const [browseOwned,      setBrowseOwned]      = useState<OwnedFilter>('all');
  const [browseSupertype,  setBrowseSupertype]  = useState<Supertype | 'all'>('all');
  const [browseType,       setBrowseType]       = useState<TcgType | null>(null);
  const [browseRarity,     setBrowseRarity]     = useState<string | null>(null);
  const [filterCounts,     setFilterCounts]     = useState<FilterCounts | null>(null);

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => {
    getCards().then(setOwnedCards).catch(() => {});
    getCatalogCount().then(setCatalogCount).catch(() => {});
    getCatalogFilterCounts().then(setFilterCounts).catch(() => {});
  }, []);

  // ── Derived ───────────────────────────────────────────────────
  const ownedMap = useMemo(() => {
    const map = new Map<string, CardDoc[]>();
    ownedCards.forEach(c => {
      if (c.tcgId) {
        const arr = map.get(c.tcgId) ?? [];
        arr.push(c);
        map.set(c.tcgId, arr);
      }
    });
    return map;
  }, [ownedCards]);

  const ownedIds = useMemo(() => new Set(ownedMap.keys()), [ownedMap]);

  const browserFilter = useMemo<CardBrowserFilter>(() => ({
    supertype:   browseSupertype !== 'all' ? browseSupertype : undefined,
    type:        browseType      ?? undefined,
    rarity:      browseRarity    ?? undefined,
    ownedFilter: browseOwned,
    ownedIds,
  }), [browseSupertype, browseType, browseRarity, browseOwned, ownedIds]);

  const { cards: browseCards, loading: browseLoading, loadingMore, hasMore, loadMore, hasAnyFilter } =
    useCardBrowser(browseSort, browserFilter);

  // ── Suche Logik ───────────────────────────────────────────────
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setSets([]); setSource(null); return; }
    setSearchLoading(true);
    try {
      if (catalogCount > 0) {
        const hits = await searchCatalog(q, filterSet, 80);
        if (hits.length > 0) {
          const cards = hits.map(catalogCardToInfo);
          const setMap = new Map<string, string>();
          cards.forEach(c => setMap.set(c.setId, c.setName));
          setSets(Array.from(setMap.entries()).map(([id, name]) => ({ id, name })));
          setResults(cards);
          setSource('catalog');
          return;
        }
      }
      const qStr = `name:${q}*${filterSet ? ` set.id:${filterSet}` : ''}`;
      const res  = await fetch(`/api/tcg?q=${encodeURIComponent(qStr)}&pageSize=80`);
      const data = await res.json();
      const cards: CardInfo[] = (data.data as TcgApiCard[] ?? []).map(tcgApiCardToInfo);
      const setMap = new Map<string, string>();
      cards.forEach(c => setMap.set(c.setId, c.setName));
      setSets(Array.from(setMap.entries()).map(([id, name]) => ({ id, name })));
      setResults(cards);
      setSource('api');
    } catch {
      setResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [filterSet, catalogCount]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(inputValue);
      router.replace(
        inputValue ? `/collection?q=${encodeURIComponent(inputValue)}` : '/collection',
        { scroll: false },
      );
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputValue, doSearch, router]);

  const displayed = useMemo(() => {
    let r = [...results];
    if (searchOwned === 'owned')   r = r.filter(c => ownedIds.has(c.id));
    if (searchOwned === 'missing') r = r.filter(c => !ownedIds.has(c.id));
    if (searchSupertype !== 'all') r = r.filter(c => c.supertype?.toLowerCase() === searchSupertype.toLowerCase());
    if (searchType)                r = r.filter(c => c.types?.includes(searchType));
    if (activeRarities.size > 0) {
      r = r.filter(c => {
        const g = c.rarity ? getRarityGroup(c.rarity) : null;
        return activeRarities.has(g?.label ?? 'Sonstige');
      });
    }
    r.sort((a, b) =>
      searchSort === 'name'
        ? a.name.localeCompare(b.name)
        : (parseInt(a.number) || 0) - (parseInt(b.number) || 0),
    );
    return r;
  }, [results, searchOwned, searchSupertype, searchType, activeRarities, ownedIds, searchSort]);

  const clearSearch = () => {
    setInputValue('');
    setResults([]);
    setSets([]);
    setSource(null);
    router.replace('/collection', { scroll: false });
  };

  const isBrowseMode = !inputValue;

  // Supertype-Optionen mit Counts
  const supertypeOptions = useMemo(() => [
    { value: 'all',     label: filterCounts ? `Alle ${fmt(Object.values(filterCounts.supertypes).reduce((a, b) => a + b, 0))}` : 'Alle' },
    { value: 'Pokémon', label: filterCounts ? `Pokémon ${fmt(filterCounts.supertypes['Pokémon'] ?? 0)}` : 'Pokémon' },
    { value: 'Trainer', label: filterCounts ? `Trainer ${fmt(filterCounts.supertypes['Trainer'] ?? 0)}` : 'Trainer' },
    { value: 'Energy',  label: filterCounts ? `Energie ${fmt(filterCounts.supertypes['Energy'] ?? 0)}` : 'Energie' },
  ], [filterCounts]);

  return (
    <div className="flex flex-col min-h-screen">

      {/* ── Sticky Header ─────────────────────────────────────── */}
      <div className="sticky top-safe z-20 bg-background px-4 pt-4 pb-3 border-b border-border space-y-2">

        {/* Suchfeld */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="Pokémon suchen… oder stöbern"
            className="w-full h-10 pl-9 pr-8 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {inputValue && (
            <button type="button" onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <X size={14} />
            </button>
          )}
        </div>

        {/* ── Browse-Filter (sticky, immer sichtbar) ────────── */}
        {isBrowseMode && (
          <div className="space-y-2">

            {/* Zeile 1: Vorhanden/Fehlen + Sort */}
            <div className="flex items-center gap-2">
              <ButtonGroup
                options={OWNED_OPTIONS}
                value={browseOwned}
                onChange={v => setBrowseOwned(v as OwnedFilter)}
              />
              <div className="relative flex items-center ml-auto">
                <select
                  value={browseSort}
                  onChange={e => setBrowseSort(e.target.value as BrowseSortKey)}
                  className="h-8 pl-2.5 pr-6 rounded-lg bg-secondary border border-border text-xs appearance-none cursor-pointer"
                >
                  {BROWSE_SORT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-1.5 pointer-events-none text-muted-foreground" />
              </div>
            </div>

            {/* Zeile 2: Supertype mit Counts */}
            <ButtonGroup
              options={supertypeOptions}
              value={browseSupertype}
              onChange={v => {
                setBrowseSupertype(v as Supertype | 'all');
                setBrowseType(null);
              }}
            />

            {/* Zeile 3: Energie-Typ-Pills mit Counts */}
            {(browseSupertype === 'all' || browseSupertype === 'Pokémon') && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
                {TCG_TYPES.map(t => {
                  const active = browseType === t;
                  const meta   = ENERGY_META[t];
                  const count  = filterCounts?.types[t];
                  return (
                    <button
                      key={t}
                      onClick={() => setBrowseType(active ? null : t)}
                      className="flex items-center gap-1.5 text-xs pl-1 pr-2.5 py-1 rounded-full border-2 whitespace-nowrap transition-all shrink-0"
                      style={{
                        borderColor: active ? meta.bg : 'transparent',
                        background:  active ? `${meta.bg}22` : 'var(--secondary)',
                        color:       active ? meta.bg : 'var(--muted-foreground)',
                        fontWeight:  active ? 600 : 400,
                      }}
                    >
                      <EnergyIcon type={t} size={18} />
                      {meta.de}
                      {count != null && (
                        <span className="text-[10px] opacity-50 font-normal">{fmt(count)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Such-Filter ───────────────────────────────────── */}
        {!isBrowseMode && results.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2 flex-wrap">
              <ButtonGroup
                options={OWNED_OPTIONS}
                value={searchOwned}
                onChange={v => setSearchOwned(v as OwnedFilter)}
              />
              {sets.length > 1 && (
                <select value={filterSet} onChange={e => setFilterSet(e.target.value)}
                  className="h-8 px-2 rounded-lg bg-secondary border border-border text-xs max-w-[150px]">
                  <option value="">Alle Sets ({sets.length})</option>
                  {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              <select value={searchSort} onChange={e => setSearchSort(e.target.value as SearchSortKey)}
                className="h-8 px-2 rounded-lg bg-secondary border border-border text-xs">
                <option value="number">Nummer</option>
                <option value="name">Name</option>
              </select>
            </div>
            <ButtonGroup
              options={[
                { value: 'all',     label: 'Alle'    },
                { value: 'Pokémon', label: 'Pokémon' },
                { value: 'Trainer', label: 'Trainer' },
                { value: 'Energy',  label: 'Energie' },
              ]}
              value={searchSupertype}
              onChange={v => { setSearchSupertype(v as Supertype | 'all'); setSearchType(null); }}
            />
            {(searchSupertype === 'all' || searchSupertype === 'Pokémon') && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
                {TCG_TYPES.map(t => {
                  const active = searchType === t;
                  const meta   = ENERGY_META[t];
                  return (
                    <button key={t} onClick={() => setSearchType(active ? null : t)}
                      className="flex items-center gap-1.5 text-xs pl-1 pr-2.5 py-1 rounded-full border-2 whitespace-nowrap transition-all shrink-0"
                      style={{
                        borderColor: active ? meta.bg : 'transparent',
                        background:  active ? `${meta.bg}22` : 'var(--secondary)',
                        color:       active ? meta.bg : 'var(--muted-foreground)',
                        fontWeight:  active ? 600 : 400,
                      }}>
                      <EnergyIcon type={t} size={18} />
                      {meta.de}
                    </button>
                  );
                })}
              </div>
            )}
            <RarityFilterBar
              cards={results}
              ownedIds={ownedIds}
              activeRarities={activeRarities}
              onToggle={label => setActiveRarities(prev => {
                const next = new Set(prev);
                if (next.has(label)) next.delete(label); else next.add(label);
                return next;
              })}
            />
          </div>
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="flex-1 px-3 py-3">

        {/* Browse-Modus */}
        {isBrowseMode && (
          <>
            {/* Kein Filter → Hinweis */}
            {!hasAnyFilter && (
              <div className="flex flex-col items-center justify-center pt-16 gap-3 text-center">
                <div className="text-4xl">🔍</div>
                <p className="text-sm font-medium text-foreground">Filter wählen</p>
                <p className="text-xs text-muted-foreground max-w-[220px]">
                  Wähle einen Typ, eine Kategorie oder „Vorhanden / Fehlen" um Karten zu laden.
                </p>
              </div>
            )}

            {/* Rarity-Chips */}
            {hasAnyFilter && browseCards.length > 0 && (
              <RarityFilterBar
                cards={browseCards}
                ownedIds={ownedIds}
                activeRarities={browseRarity ? new Set([browseRarity]) : new Set()}
                onToggle={label => setBrowseRarity(prev => prev === label ? null : label)}
              />
            )}

            {/* Grid */}
            {hasAnyFilter && (
              browseLoading ? (
                <div className="flex justify-center pt-12">
                  <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {browseCards.length === 0 && (
                    <p className="text-center text-muted-foreground text-sm pt-12">
                      Keine Karten für diesen Filter.
                    </p>
                  )}
                  <CardGrid cards={browseCards} ownedMap={ownedMap} />

                  {hasMore && (
                    <div className="flex justify-center pt-4 pb-8">
                      <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="px-5 py-2 rounded-xl text-sm font-medium bg-secondary border border-border transition-opacity"
                        style={{ opacity: loadingMore ? 0.5 : 1 }}
                      >
                        {loadingMore ? 'Lädt…' : 'Weitere 50 Karten laden'}
                      </button>
                    </div>
                  )}
                </>
              )
            )}
          </>
        )}

        {/* Such-Modus */}
        {!isBrowseMode && (
          <>
            {searchLoading && (
              <div className="flex justify-center pt-12">
                <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!searchLoading && results.length === 0 && inputValue && (
              <p className="text-center text-muted-foreground text-sm pt-12">
                Keine Karten für „{inputValue}"
              </p>
            )}
            {!searchLoading && displayed.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">{displayed.length} Karten</p>
                  {source && (
                    <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                      {source === 'catalog' ? <><Database size={9} /> lokal</> : '↗ API'}
                    </p>
                  )}
                </div>
                <CardGrid cards={displayed} ownedMap={ownedMap} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function CollectionPage() {
  return <Suspense><CollectionContent /></Suspense>;
}
