'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, X, Database, ChevronDown } from 'lucide-react';
import { CardGrid } from '@/components/card/CardGrid';
import { RarityFilterBar } from '@/components/card/RarityFilterBar';
import { ButtonGroup } from '@/components/ui/button-group';
import { getCards } from '@/lib/firestore/cards';
import { searchCatalog, getCatalogCount } from '@/lib/firestore/catalog';
import { catalogCardToInfo, tcgApiCardToInfo, type CardInfo } from '@/lib/card-info';
import { getRarityGroup } from '@/lib/card-constants';
import { useCardBrowser, TCG_TYPES, type TcgType, type CardBrowserFilter } from '@/lib/hooks/useCardBrowser';
import { EnergyIcon, ENERGY_META } from '@/components/ui/EnergyIcon';
import type { TcgApiCard } from '@/lib/pokemon-tcg';
import type { CardDoc } from '@/types';
import type { BrowseSortKey } from '@/lib/firestore/catalog';

type OwnedFilter = 'all' | 'owned' | 'missing';
type SearchSortKey = 'number' | 'name';
type Supertype = 'Pokémon' | 'Trainer' | 'Energy';

const OWNED_OPTIONS: { value: OwnedFilter; label: string }[] = [
  { value: 'all',     label: 'Alle'      },
  { value: 'owned',   label: 'Vorhanden' },
  { value: 'missing', label: 'Fehlen'    },
];

const SUPERTYPE_OPTIONS: { value: Supertype | 'all'; label: string }[] = [
  { value: 'all',      label: 'Alle'     },
  { value: 'Pokémon',  label: 'Pokémon'  },
  { value: 'Trainer',  label: 'Trainer'  },
  { value: 'Energy',   label: 'Energie'  },
];

const BROWSE_SORT_OPTIONS: { value: BrowseSortKey; label: string }[] = [
  { value: 'name',    label: 'A–Z'          },
  { value: 'hp',      label: 'KP (höchste)' },
  { value: 'pokedex', label: 'Pokédex-Nr.'  },
];

/* ── Browse-Modus (kein Suchbegriff) ───────────────────────── */
function BrowseMode({ ownedMap, ownedIds }: {
  ownedMap: Map<string, CardDoc[]>;
  ownedIds: Set<string>;
}) {
  const [browseSort,     setBrowseSort]     = useState<BrowseSortKey>('name');
  const [ownedFilter,    setOwnedFilter]    = useState<OwnedFilter>('all');
  const [activeSupertype,setActiveSupertype]= useState<Supertype | 'all'>('all');
  const [activeType,     setActiveType]     = useState<TcgType | null>(null);
  const [activeRarity,   setActiveRarity]   = useState<string | null>(null);

  const browserFilter = useMemo<CardBrowserFilter>(() => ({
    supertype:   activeSupertype !== 'all' ? activeSupertype : undefined,
    type:        activeType      ?? undefined,
    rarity:      activeRarity    ?? undefined,
    ownedFilter,
    ownedIds,
  }), [activeSupertype, activeType, activeRarity, ownedFilter, ownedIds]);

  const { cards, loading, loadingMore, hasMore, loadMore } = useCardBrowser(browseSort, browserFilter);

  return (
    <div className="space-y-3">

      {/* Zeile 1: Alle/Vorhanden/Fehlen + Sort */}
      <div className="flex items-center gap-2 flex-wrap">
        <ButtonGroup
          options={OWNED_OPTIONS}
          value={ownedFilter}
          onChange={v => setOwnedFilter(v as OwnedFilter)}
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

      {/* Zeile 2: Supertype als ButtonGroup (Alle / Pokémon / Trainer / Energie) */}
      <ButtonGroup
        options={SUPERTYPE_OPTIONS}
        value={activeSupertype}
        onChange={v => {
          setActiveSupertype(v as Supertype | 'all');
          setActiveType(null); // Typ-Filter zurücksetzen bei Supertype-Wechsel
        }}
      />

      {/* Zeile 3: Energie-Typ-Pills (nur bei Pokémon oder Alle) */}
      {(activeSupertype === 'all' || activeSupertype === 'Pokémon') && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4">
          {TCG_TYPES.map(t => {
            const active = activeType === t;
            const meta   = ENERGY_META[t];
            return (
              <button
                key={t}
                onClick={() => setActiveType(active ? null : t)}
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
              </button>
            );
          })}
        </div>
      )}

      {/* Zeile 4: Rarity-Chips */}
      {cards.length > 0 && (
        <RarityFilterBar
          cards={cards}
          ownedIds={ownedIds}
          activeRarities={activeRarity ? new Set([activeRarity]) : new Set()}
          onToggle={label => setActiveRarity(prev => prev === label ? null : label)}
        />
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center pt-12">
          <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <CardGrid cards={cards} ownedMap={ownedMap} />

          {hasMore && (
            <div className="flex justify-center pt-4 pb-8">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-5 py-2 rounded-xl text-sm font-medium bg-secondary border border-border transition-opacity"
                style={{ opacity: loadingMore ? 0.5 : 1 }}
              >
                {loadingMore ? 'Lädt…' : 'Weitere Karten laden'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Such-Modus (mit Suchbegriff) ──────────────────────────── */
function CollectionContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const initialQ     = searchParams.get('q') ?? '';

  const [inputValue,     setInputValue]     = useState(initialQ);
  const [results,        setResults]        = useState<CardInfo[]>([]);
  const [ownedCards,     setOwnedCards]     = useState<CardDoc[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [sort,           setSort]           = useState<SearchSortKey>('number');
  const [filterSet,      setFilterSet]      = useState('');
  const [sets,           setSets]           = useState<{ id: string; name: string }[]>([]);
  const [catalogCount,   setCatalogCount]   = useState(0);
  const [source,         setSource]         = useState<'catalog' | 'api' | null>(null);
  const [ownedFilter,    setOwnedFilter]    = useState<OwnedFilter>('all');
  const [activeRarities, setActiveRarities] = useState<Set<string>>(new Set());
  const [activeSupertype,setActiveSupertype]= useState<Supertype | 'all'>('all');
  const [activeType,     setActiveType]     = useState<TcgType | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getCards().then(setOwnedCards).catch(() => {});
    getCatalogCount().then(setCatalogCount).catch(() => {});
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setSets([]); setSource(null); return; }
    setLoading(true);
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
      setLoading(false);
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

  const displayed = useMemo(() => {
    let r = [...results];
    if (ownedFilter === 'owned')   r = r.filter(c => ownedIds.has(c.id));
    if (ownedFilter === 'missing') r = r.filter(c => !ownedIds.has(c.id));
    if (activeSupertype !== 'all') r = r.filter(c => c.supertype?.toLowerCase() === activeSupertype.toLowerCase());
    if (activeType)      r = r.filter(c => c.types?.includes(activeType));
    if (activeRarities.size > 0) {
      r = r.filter(c => {
        const g = c.rarity ? getRarityGroup(c.rarity) : null;
        return activeRarities.has(g?.label ?? 'Sonstige');
      });
    }
    r.sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : (parseInt(a.number) || 0) - (parseInt(b.number) || 0),
    );
    return r;
  }, [results, ownedFilter, activeSupertype, activeType, activeRarities, ownedIds, sort]);

  const clearSearch = () => {
    setInputValue('');
    setResults([]);
    setSets([]);
    setSource(null);
    router.replace('/collection', { scroll: false });
  };

  const toggleRarity = (label: string) => {
    setActiveRarities(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  const isBrowseMode = !inputValue;

  return (
    <div className="flex flex-col min-h-screen">

      {/* ── Sticky Header ─────────────────────────────────────── */}
      <div className="sticky top-safe z-20 bg-background px-4 pt-4 pb-3 border-b border-border space-y-1">

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

        {/* Such-Filter (nur im Such-Modus mit Ergebnissen) */}
        {!isBrowseMode && results.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2 flex-wrap">
              <ButtonGroup options={OWNED_OPTIONS} value={ownedFilter} onChange={v => setOwnedFilter(v as OwnedFilter)} />
              {sets.length > 1 && (
                <select value={filterSet} onChange={e => setFilterSet(e.target.value)}
                  className="h-8 px-2 rounded-lg bg-secondary border border-border text-xs max-w-[150px]">
                  <option value="">Alle Sets ({sets.length})</option>
                  {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              <select value={sort} onChange={e => setSort(e.target.value as SearchSortKey)}
                className="h-8 px-2 rounded-lg bg-secondary border border-border text-xs">
                <option value="number">Nummer</option>
                <option value="name">Name</option>
              </select>
            </div>
            <ButtonGroup
              options={SUPERTYPE_OPTIONS}
              value={activeSupertype}
              onChange={v => { setActiveSupertype(v as Supertype | 'all'); setActiveType(null); }}
            />
            {(activeSupertype === 'all' || activeSupertype === 'Pokémon') && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4">
                {TCG_TYPES.map(t => {
                  const active = activeType === t;
                  const meta   = ENERGY_META[t];
                  return (
                    <button key={t} onClick={() => setActiveType(active ? null : t)}
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
            <RarityFilterBar cards={results} ownedIds={ownedIds} activeRarities={activeRarities} onToggle={toggleRarity} />
          </div>
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="flex-1 px-3 py-3">

        {/* Browse-Modus */}
        {isBrowseMode && (
          catalogCount > 0 ? (
            <BrowseMode ownedMap={ownedMap} ownedIds={ownedIds} />
          ) : (
            <div className="text-center pt-16 space-y-2">
              <Search size={36} className="mx-auto text-muted-foreground/30" />
              <p className="text-muted-foreground text-sm">Tippe einen Pokémon-Namen</p>
              <p className="text-muted-foreground/50 text-xs">Catalog wird befüllt…</p>
            </div>
          )
        )}

        {/* Such-Modus */}
        {!isBrowseMode && (
          <>
            {loading && (
              <div className="flex justify-center pt-12">
                <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!loading && results.length === 0 && (
              <p className="text-center text-muted-foreground text-sm pt-12">
                Keine Karten für „{inputValue}"
              </p>
            )}
            {!loading && displayed.length > 0 && (
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
