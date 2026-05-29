'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { CardTile } from '@/components/card/CardTile';
import type { TcgApiCard } from '@/lib/pokemon-tcg';
import type { CardDoc } from '@/types';
import { getCards } from '@/lib/firestore/cards';

type SortKey = 'number' | 'name' | 'rarity';

function CollectionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQ = searchParams.get('q') ?? '';

  const [query, setQuery] = useState(initialQ);
  const [inputValue, setInputValue] = useState(initialQ);
  const [results, setResults] = useState<TcgApiCard[]>([]);
  const [ownedCards, setOwnedCards] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortKey>('number');
  const [filterSet, setFilterSet] = useState('');
  const [sets, setSets] = useState<{ id: string; name: string }[]>([]);

  // Load own collection from Firestore
  useEffect(() => {
    getCards().then(setOwnedCards).catch(() => {});
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      // No query: show own collection cards via API
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const qStr = `name:"${q}"${filterSet ? ` set.id:${filterSet}` : ''}`;
      const res = await fetch(`/api/tcg?q=${encodeURIComponent(qStr)}&pageSize=40`);
      const data = await res.json();
      const cards: TcgApiCard[] = data.data ?? [];
      // Extract sets for filter
      const setMap = new Map<string, string>();
      cards.forEach(c => setMap.set(c.set.id, c.set.name));
      setSets(Array.from(setMap.entries()).map(([id, name]) => ({ id, name })));
      setResults(cards);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [filterSet]);

  useEffect(() => {
    doSearch(query);
  }, [query, doSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(inputValue);
    router.replace(`/collection?q=${encodeURIComponent(inputValue)}`, { scroll: false });
  };

  const clearSearch = () => {
    setInputValue('');
    setQuery('');
    router.replace('/collection', { scroll: false });
  };

  // Sort results
  const sorted = [...results].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'number') {
      const na = parseInt(a.number) || 0;
      const nb = parseInt(b.number) || 0;
      return na - nb;
    }
    return 0;
  });

  // Map tcgId → owned cards
  const ownedByTcgId = new Map<string, CardDoc[]>();
  ownedCards.forEach(c => {
    if (c.tcgId) {
      const arr = ownedByTcgId.get(c.tcgId) ?? [];
      arr.push(c);
      ownedByTcgId.set(c.tcgId, arr);
    }
  });

  const isEmpty = !loading && results.length === 0 && query.trim();

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background px-4 pt-12 pb-3 space-y-3 border-b border-border">
        {/* Search input */}
        <form onSubmit={handleSubmit}>
          <div className="relative flex items-center">
            <Search size={16} className="absolute left-3 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder="Name oder Nummer…"
              className="w-full h-10 pl-9 pr-9 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {inputValue && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-3 text-muted-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </form>

        {/* Filters row */}
        <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-0.5 px-0.5">
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="h-8 px-2 rounded-lg bg-secondary border border-border text-xs shrink-0"
          >
            <option value="number">Nummer</option>
            <option value="name">Name</option>
            <option value="rarity">Seltenheit</option>
          </select>

          {sets.length > 0 && (
            <select
              value={filterSet}
              onChange={e => setFilterSet(e.target.value)}
              className="h-8 px-2 rounded-lg bg-secondary border border-border text-xs shrink-0 max-w-[160px]"
            >
              <option value="">Alle Sets</option>
              {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-3 py-3">
        {loading && (
          <div className="flex justify-center pt-12">
            <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {isEmpty && (
          <p className="text-center text-muted-foreground text-sm pt-12">
            Keine Karten gefunden für „{query}"
          </p>
        )}

        {!query && !loading && (
          <div className="text-center pt-12 space-y-2">
            <Search size={32} className="mx-auto text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">Suche nach einer Karte</p>
            <p className="text-muted-foreground/60 text-xs">z.B. „Pikachu" oder „025/198"</p>
          </div>
        )}

        {sorted.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {sorted.map(card => (
              <CardTile
                key={card.id}
                card={card}
                ownedCards={ownedByTcgId.get(card.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CollectionPage() {
  return (
    <Suspense>
      <CollectionContent />
    </Suspense>
  );
}
