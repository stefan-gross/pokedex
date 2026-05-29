'use client';

import { useState, useEffect, useCallback, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { CardTile } from '@/components/card/CardTile';
import type { TcgApiCard } from '@/lib/pokemon-tcg';
import type { CardDoc } from '@/types';
import { getCards } from '@/lib/firestore/cards';

type SortKey = 'number' | 'name';

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getCards().then(setOwnedCards).catch(() => {});
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSets([]);
      return;
    }
    setLoading(true);
    try {
      // Wildcard search: name:pikachu* finds all cards containing "pikachu"
      const qStr = `name:${q}*${filterSet ? ` set.id:${filterSet}` : ''}`;
      const res = await fetch(`/api/tcg?q=${encodeURIComponent(qStr)}&pageSize=60`);
      const data = await res.json();
      const cards: TcgApiCard[] = data.data ?? [];
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

  // Debounced live search — fires 400ms after user stops typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(inputValue);
      if (inputValue) {
        router.replace(`/collection?q=${encodeURIComponent(inputValue)}`, { scroll: false });
      } else {
        router.replace('/collection', { scroll: false });
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, doSearch, router]);

  const clearSearch = () => {
    setInputValue('');
    setResults([]);
    setSets([]);
    router.replace('/collection', { scroll: false });
  };

  const sorted = [...results].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    const na = parseInt(a.number) || 0;
    const nb = parseInt(b.number) || 0;
    return na - nb;
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
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background px-4 pt-12 pb-3 space-y-3 border-b border-border">
        <div className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder="Name suchen, z.B. Pikachu…"
              autoFocus
              className="w-full h-10 pl-9 pr-8 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {inputValue && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        {sets.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            <select
              value={sort}
              onChange={e => setSort(e.target.value as SortKey)}
              className="h-8 px-2 rounded-lg bg-secondary border border-border text-xs shrink-0"
            >
              <option value="number">Nummer</option>
              <option value="name">Name</option>
            </select>
            <select
              value={filterSet}
              onChange={e => setFilterSet(e.target.value)}
              className="h-8 px-2 rounded-lg bg-secondary border border-border text-xs shrink-0 max-w-[180px]"
            >
              <option value="">Alle Sets ({sets.length})</option>
              {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 px-3 py-3">
        {loading && (
          <div className="flex justify-center pt-12">
            <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && !inputValue && (
          <div className="text-center pt-16 space-y-2">
            <Search size={36} className="mx-auto text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">Tippe einen Pokémon-Namen ein</p>
            <p className="text-muted-foreground/50 text-xs">z.B. „Pikachu", „Charizard" oder „Mewtwo"</p>
          </div>
        )}

        {!loading && inputValue && results.length === 0 && (
          <p className="text-center text-muted-foreground text-sm pt-12">
            Keine Karten gefunden für „{inputValue}"
          </p>
        )}

        {sorted.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground mb-2">{sorted.length} Karten gefunden</p>
            <div className="grid grid-cols-3 gap-2">
              {sorted.map(card => (
                <CardTile
                  key={card.id}
                  card={card}
                  ownedCards={ownedByTcgId.get(card.id)}
                />
              ))}
            </div>
          </>
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
