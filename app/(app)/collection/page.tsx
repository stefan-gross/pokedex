'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, X, Database, ChevronDown } from 'lucide-react';
import { CardGrid } from '@/components/card/CardGrid';
import { RarityFilterBar } from '@/components/card/RarityFilterBar';
import { ButtonGroup } from '@/components/ui/button-group';
import { getCards } from '@/lib/firestore/cards';
import { searchCatalog, getCatalogCount, getCatalogFilterCounts, type FilterCounts } from '@/lib/firestore/catalog';
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

const EVOLUTION_OPTIONS: { value: string | null; label: string }[] = [
  { value: null,      label: 'Alle Stufen' },
  { value: 'Basic',   label: 'Basis'       },
  { value: 'Stage 1', label: 'Phase 1'     },
  { value: 'Stage 2', label: 'Phase 2'     },
];

function fmt(n: number) { return n.toLocaleString('de'); }

/* ── Kleine Chip-Komponente für den kompakten Filter-Strip ──── */
function FilterChip({ label, onRemove, color }: { label: string; onRemove: () => void; color?: string }) {
  return (
    <button
      onClick={onRemove}
      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border shrink-0 transition-colors"
      style={color
        ? { borderColor: color, background: `${color}22`, color }
        : { borderColor: 'var(--border)', background: 'var(--secondary)', color: 'var(--foreground)' }
      }
    >
      {label} <X size={10} />
    </button>
  );
}

function CollectionContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const initialQ     = searchParams.get('q') ?? '';

  // ── Geteilter Filter-State (Browse + Suche) ───────────────────
  const [activeType,      setActiveType]      = useState<TcgType | null>(null);
  const [activeSupertype, setActiveSupertype] = useState<Supertype | 'all'>('all');
  const [ownedFilter,     setOwnedFilter]     = useState<OwnedFilter>('all');
  const [activeRarity,    setActiveRarity]    = useState<string | null>(null);
  const [activeEvolution, setActiveEvolution] = useState<string | null>(null);

  // ── Browse-spezifisch ─────────────────────────────────────────
  const [browseSort, setBrowseSort] = useState<BrowseSortKey>('name');

  // ── Suche ─────────────────────────────────────────────────────
  const [inputValue,   setInputValue]   = useState(initialQ);
  const [results,      setResults]      = useState<CardInfo[]>([]);
  const [ownedCards,   setOwnedCards]   = useState<CardDoc[]>([]);
  const [searchLoading,setSearchLoading]= useState(false);
  const [searchSort,   setSearchSort]   = useState<SearchSortKey>('number');
  const [filterSet,    setFilterSet]    = useState('');
  const [sets,         setSets]         = useState<{ id: string; name: string }[]>([]);
  const [catalogCount, setCatalogCount] = useState(0);
  const [source,       setSource]       = useState<'catalog' | 'api' | null>(null);

  // ── UI-State ──────────────────────────────────────────────────
  const [filterCounts,     setFilterCounts]     = useState<FilterCounts | null>(null);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const lastScrollY = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => {
    getCards().then(setOwnedCards).catch(() => {});
    getCatalogCount().then(setCatalogCount).catch(() => {});
    getCatalogFilterCounts().then(setFilterCounts).catch(() => {});
  }, []);

  // ── Dynamische Counts (debounced, bei Filter-Änderung) ────────
  useEffect(() => {
    if (countTimerRef.current) clearTimeout(countTimerRef.current);
    countTimerRef.current = setTimeout(() => {
      getCatalogFilterCounts({
        type:      activeType ?? undefined,
        supertype: activeSupertype !== 'all' ? activeSupertype : undefined,
      }).then(setFilterCounts).catch(() => {});
    }, 300);
    return () => { if (countTimerRef.current) clearTimeout(countTimerRef.current); };
  }, [activeType, activeSupertype]);

  // ── Scroll-Collapse ───────────────────────────────────────────
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      if (y > lastScrollY.current + 8 && y > 60) setFiltersCollapsed(true);
      else if (y < lastScrollY.current - 8)       setFiltersCollapsed(false);
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
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
    supertype:      activeSupertype !== 'all' ? activeSupertype : undefined,
    type:           activeType      ?? undefined,
    evolutionStage: activeEvolution ?? undefined,
    rarity:         activeRarity    ?? undefined,
    ownedFilter,
    ownedIds,
  }), [activeSupertype, activeType, activeEvolution, activeRarity, ownedFilter, ownedIds]);

  const {
    cards: browseCards, loading: browseLoading,
    loadingMore, hasMore, loadMore, hasAnyFilter,
  } = useCardBrowser(browseSort, browserFilter);

  // ── Infinite Scroll ───────────────────────────────────────────
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !isBrowseMode) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasMore && !loadingMore && !browseLoading) loadMore();
    }, { rootMargin: '300px' });
    observer.observe(el);
    return () => observer.disconnect();
  // isBrowseMode depends on inputValue, but we keep it stable via deps below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, browseLoading, loadMore, inputValue]);

  // ── Suche ─────────────────────────────────────────────────────
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

  // Sucherg. durch geteilte Filter gefiltert
  const displayed = useMemo(() => {
    let r = [...results];
    if (ownedFilter === 'owned')     r = r.filter(c => ownedIds.has(c.id));
    if (ownedFilter === 'missing')   r = r.filter(c => !ownedIds.has(c.id));
    if (activeSupertype !== 'all')   r = r.filter(c => c.supertype?.toLowerCase() === activeSupertype.toLowerCase());
    const _type = activeType;
    if (_type)                       r = r.filter(c => c.types?.includes(_type));
    if (activeRarity) {
      r = r.filter(c => (getRarityGroup(c.rarity ?? '')?.label ?? 'Sonstige') === activeRarity);
    }
    r.sort((a, b) =>
      searchSort === 'name'
        ? a.name.localeCompare(b.name)
        : (parseInt(a.number) || 0) - (parseInt(b.number) || 0),
    );
    return r;
  }, [results, ownedFilter, activeSupertype, activeType, activeRarity, ownedIds, searchSort]);

  const isBrowseMode = !inputValue;

  const clearSearch = () => {
    setInputValue('');
    setResults([]);
    setSets([]);
    setSource(null);
    router.replace('/collection', { scroll: false });
  };

  // Aktive Filter als Chips
  const hasActiveFilter = !!(activeType || activeSupertype !== 'all' || ownedFilter !== 'all' || activeRarity || activeEvolution);

  const supertypeOptions = useMemo(() => [
    { value: 'all',     label: filterCounts ? `Alle ${fmt(Object.values(filterCounts.supertypes).reduce((a, b) => a + b, 0))}` : 'Alle' },
    { value: 'Pokémon', label: filterCounts?.supertypes['Pokémon'] ? `Pokémon ${fmt(filterCounts.supertypes['Pokémon'])}` : 'Pokémon' },
    { value: 'Trainer', label: filterCounts?.supertypes['Trainer'] ? `Trainer ${fmt(filterCounts.supertypes['Trainer'])}` : 'Trainer' },
    { value: 'Energy',  label: filterCounts?.supertypes['Energy']  ? `Energie ${fmt(filterCounts.supertypes['Energy'])}` : 'Energie' },
  ], [filterCounts]);

  const showTypePills = activeSupertype === 'all' || activeSupertype === 'Pokémon';
  const showEvolution = showTypePills;

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-screen">

      {/* ── Sticky Header ──────────────────────────────────────── */}
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

        {/* ── Filter-Block (Browse + Suche) ──────────────────── */}
        {filtersCollapsed ? (
          /* Kompakter Strip mit aktiven Filter-Chips */
          hasActiveFilter ? (
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
              {activeSupertype !== 'all' && (
                <FilterChip label={activeSupertype} onRemove={() => setActiveSupertype('all')} />
              )}
              {activeType && (
                <FilterChip
                  label={ENERGY_META[activeType].de}
                  onRemove={() => setActiveType(null)}
                  color={ENERGY_META[activeType].bg}
                />
              )}
              {activeEvolution && (
                <FilterChip
                  label={EVOLUTION_OPTIONS.find(o => o.value === activeEvolution)?.label ?? activeEvolution}
                  onRemove={() => setActiveEvolution(null)}
                />
              )}
              {ownedFilter !== 'all' && (
                <FilterChip
                  label={OWNED_OPTIONS.find(o => o.value === ownedFilter)?.label ?? ownedFilter}
                  onRemove={() => setOwnedFilter('all')}
                />
              )}
              {activeRarity && (
                <FilterChip label={activeRarity} onRemove={() => setActiveRarity(null)} />
              )}
            </div>
          ) : null
        ) : (
          /* Vollständige Filter-Zeilen */
          <>
            {/* Zeile 1: Vorhanden/Fehlen + Sort (Browse) / Set+Sort (Suche) */}
            <div className="flex items-center gap-2">
              <ButtonGroup options={OWNED_OPTIONS} value={ownedFilter} onChange={v => setOwnedFilter(v as OwnedFilter)} />
              {isBrowseMode && (
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
              )}
              {!isBrowseMode && sets.length > 1 && (
                <select value={filterSet} onChange={e => setFilterSet(e.target.value)}
                  className="h-8 px-2 rounded-lg bg-secondary border border-border text-xs max-w-[120px] ml-auto">
                  <option value="">Alle Sets</option>
                  {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {!isBrowseMode && (
                <select value={searchSort} onChange={e => setSearchSort(e.target.value as SearchSortKey)}
                  className="h-8 px-2 rounded-lg bg-secondary border border-border text-xs">
                  <option value="number">Nummer</option>
                  <option value="name">Name</option>
                </select>
              )}
            </div>

            {/* Zeile 2: Supertype mit Counts */}
            <ButtonGroup
              options={supertypeOptions}
              value={activeSupertype}
              onChange={v => { setActiveSupertype(v as Supertype | 'all'); setActiveType(null); setActiveEvolution(null); }}
            />

            {/* Zeile 3: Typ-Pills mit Counts (nur bei Pokémon/Alle) */}
            {showTypePills && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
                {TCG_TYPES.map(t => {
                  const active = activeType === t;
                  const meta   = ENERGY_META[t];
                  const count  = filterCounts?.types[t];
                  return (
                    <button
                      key={t}
                      onClick={() => { setActiveType(active ? null : t); setActiveEvolution(null); }}
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
                      {count != null && count > 0 && (
                        <span className="text-[10px] opacity-50 font-normal">{fmt(count)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Zeile 4: Entwicklungsstufe (Basis/Phase 1/Phase 2) */}
            {showEvolution && isBrowseMode && (
              <ButtonGroup
                options={EVOLUTION_OPTIONS.map(o => ({ value: o.value ?? 'all', label: o.label }))}
                value={activeEvolution ?? 'all'}
                onChange={v => setActiveEvolution(v === 'all' ? null : v)}
              />
            )}

            {/* Zeile 5: Rarity-Chips (wenn Karten geladen) */}
            {isBrowseMode && browseCards.length > 0 && (
              <RarityFilterBar
                cards={browseCards}
                ownedIds={ownedIds}
                activeRarities={activeRarity ? new Set([activeRarity]) : new Set()}
                onToggle={label => setActiveRarity(prev => prev === label ? null : label)}
              />
            )}
            {!isBrowseMode && displayed.length > 0 && (
              <RarityFilterBar
                cards={results}
                ownedIds={ownedIds}
                activeRarities={activeRarity ? new Set([activeRarity]) : new Set()}
                onToggle={label => setActiveRarity(prev => prev === label ? null : label)}
              />
            )}
          </>
        )}
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="flex-1 px-3 py-3">

        {/* Browse-Modus */}
        {isBrowseMode && (
          <>
            {!hasAnyFilter && (
              <div className="flex flex-col items-center justify-center pt-16 gap-3 text-center">
                <div className="text-4xl">🔍</div>
                <p className="text-sm font-medium text-foreground">Filter wählen</p>
                <p className="text-xs text-muted-foreground max-w-[220px]">
                  Wähle einen Typ, eine Kategorie oder „Vorhanden / Fehlen" um Karten zu laden.
                </p>
              </div>
            )}

            {hasAnyFilter && (
              browseLoading && browseCards.length === 0 ? (
                <div className="flex justify-center pt-12">
                  <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {browseCards.length === 0 && !browseLoading && (
                    <p className="text-center text-muted-foreground text-sm pt-12">
                      Keine Karten für diesen Filter.
                    </p>
                  )}
                  <CardGrid cards={browseCards} ownedMap={ownedMap} />

                  {/* Infinite-scroll Sentinel */}
                  <div ref={sentinelRef} className="h-1" />
                  {loadingMore && (
                    <div className="flex justify-center py-4">
                      <div className="w-6 h-6 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
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
