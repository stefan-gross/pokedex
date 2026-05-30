'use client';

import { useState, useEffect, useCallback, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, X, Database } from 'lucide-react';
import { CardTile } from '@/components/card/CardTile';
import type { TcgApiCard } from '@/lib/pokemon-tcg';
import type { CardDoc } from '@/types';
import { getCards } from '@/lib/firestore/cards';
import { searchCatalog, getCatalogCount } from '@/lib/firestore/catalog';

type SortKey = 'number' | 'name';

function catalogToTcg(c: Awaited<ReturnType<typeof searchCatalog>>[number]): TcgApiCard {
  return {
    id: c.id,
    name: c.name,
    number: c.number,
    rarity: c.rarity,
    supertype: c.supertype,
    types: c.types,
    set: { id: c.setId, name: c.setName, series: c.series, total: 0, printedTotal: 0 },
    images: { small: c.imgSmall, large: c.imgLarge },
  };
}

function CollectionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQ = searchParams.get('q') ?? '';

  const [inputValue, setInputValue] = useState(initialQ);
  const [results, setResults] = useState<TcgApiCard[]>([]);
  const [ownedCards, setOwnedCards] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortKey>('number');
  const [filterSet, setFilterSet] = useState('');
  const [sets, setSets] = useState<{ id: string; name: string }[]>([]);
  const [catalogCount, setCatalogCount] = useState(0);
  const [source, setSource] = useState<'catalog' | 'api' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getCards().then(setOwnedCards).catch(() => {});
    getCatalogCount().then(setCatalogCount).catch(() => {});
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSets([]);
      setSource(null);
      return;
    }
    setLoading(true);
    try {
      // Versuche zuerst den lokalen Firestore-Catalog
      if (catalogCount > 0) {
        const catalogResults = await searchCatalog(q, filterSet, 80);
        if (catalogResults.length > 0) {
          const cards = catalogResults.map(catalogToTcg);
          const setMap = new Map<string, string>();
          cards.forEach(c => setMap.set(c.set.id, c.set.name));
          setSets(Array.from(setMap.entries()).map(([id, name]) => ({ id, name })));
          setResults(cards);
          setSource('catalog');
          return;
        }
      }

      // Fallback: pokemontcg.io API (live)
      const qStr = `name:${q}*${filterSet ? ` set.id:${filterSet}` : ''}`;
      const res = await fetch(`/api/tcg?q=${encodeURIComponent(qStr)}&pageSize=80`);
      const data = await res.json();
      const cards: TcgApiCard[] = data.data ?? [];
      const setMap = new Map<string, string>();
      cards.forEach(c => setMap.set(c.set.id, c.set.name));
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
        { scroll: false }
      );
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputValue, doSearch, router]);

  const clearSearch = () => {
    setInputValue('');
    setResults([]);
    setSets([]);
    setSource(null);
    router.replace('/collection', { scroll: false });
  };

  const sorted = [...results].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    return (parseInt(a.number) || 0) - (parseInt(b.number) || 0);
  });

  const ownedByTcgId = new Map<string, CardDoc[]>();
  ownedCards.forEach(c => {
    if (c.tcgId) {
      const arr = ownedByTcgId.get(c.tcgId) ?? [];
      arr.push(c);
      ownedByTcgId.set(c.tcgId, arr);
    }
  });

  return (
    <div className="flex flex-col min-h-screen">
      <div className="sticky top-safe z-20 bg-background px-4 pt-4 pb-3 space-y-2 border-b border-border">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="Pokémon suchen…"
            autoFocus
            className="w-full h-10 pl-9 pr-8 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {inputValue && (
            <button type="button" onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <X size={14} />
            </button>
          )}
        </div>

        {sets.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
              className="h-8 px-2 rounded-lg bg-secondary border border-border text-xs shrink-0">
              <option value="number">Nummer</option>
              <option value="name">Name</option>
            </select>
            <select value={filterSet} onChange={e => setFilterSet(e.target.value)}
              className="h-8 px-2 rounded-lg bg-secondary border border-border text-xs shrink-0 max-w-[200px]">
              <option value="">Alle Sets ({sets.length})</option>
              {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="flex-1 px-3 py-3">
        {loading && (
          <div className="flex justify-center pt-12">
            <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && !inputValue && (
          <div className="text-center pt-16 space-y-2">
            <Search size={36} className="mx-auto text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">Tippe einen Pokémon-Namen</p>
            {catalogCount > 0 ? (
              <p className="text-xs flex items-center justify-center gap-1" style={{ color: '#48bb78' }}>
                <Database size={11} /> {catalogCount.toLocaleString()} Karten lokal gecacht
              </p>
            ) : (
              <p className="text-muted-foreground/50 text-xs">Catalog wird befüllt…</p>
            )}
          </div>
        )}

        {!loading && inputValue && results.length === 0 && (
          <p className="text-center text-muted-foreground text-sm pt-12">
            Keine Karten für „{inputValue}"
          </p>
        )}

        {sorted.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">{sorted.length} Karten</p>
              {source && (
                <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                  {source === 'catalog' ? <><Database size={9} /> lokal</> : '↗ API'}
                </p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {sorted.map(card => (
                <CardTile key={card.id} card={card} ownedCards={ownedByTcgId.get(card.id)} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CollectionPage() {
  return <Suspense><CollectionContent /></Suspense>;
}
