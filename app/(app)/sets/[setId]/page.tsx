'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { getCards } from '@/lib/firestore/cards';
import { getSetNameDe } from '@/lib/set-names-de';
import type { TcgApiCard } from '@/lib/pokemon-tcg';
import type { CardDoc } from '@/types';

/* ── Rarity helpers ──────────────────────────────────────────── */
const RARITY_GROUPS: { label: string; symbol: string; color: string; keys: string[] }[] = [
  { label: 'Common',          symbol: '◆',   color: '#9ca3af', keys: ['common'] },
  { label: 'Uncommon',        symbol: '◆◆',  color: '#60a5fa', keys: ['uncommon'] },
  { label: 'Rare',            symbol: '★',   color: '#fbbf24', keys: ['rare'] },
  { label: 'Rare Holo',       symbol: '★✦',  color: '#f59e0b', keys: ['rare holo'] },
  { label: 'Ultra Rare',      symbol: '★★',  color: '#a78bfa', keys: ['double rare', 'ace spec rare', 'ultra rare', 'rare ultra', 'rare rainbow', 'hyper rare', 'rare secret'] },
  { label: 'ex / V',          symbol: '◈',   color: '#34d399', keys: ['rare holo ex', 'rare holo v', 'rare holo vmax', 'rare holo vstar', 'rare holo gx', 'rare holo lv.x'] },
  { label: 'Illustration',    symbol: '🎨',  color: '#f472b6', keys: ['illustration rare', 'special illustration rare'] },
  { label: 'Promo',           symbol: 'P',   color: '#fb923c', keys: ['promo', 'classic collection'] },
];

function getRarityGroup(rarity: string) {
  const lower = rarity.toLowerCase();
  return RARITY_GROUPS.find(g => g.keys.some(k => lower === k));
}

/* ── Sort / Filter types ─────────────────────────────────────── */
type Filter = 'all' | 'owned' | 'missing';
type SortKey = 'number' | 'name' | 'price';
type SortDir = 'asc' | 'desc';

interface TcgSet {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  ptcgoCode?: string;
  releaseDate?: string;
  images: { symbol: string; logo: string };
}

/* ── Page ────────────────────────────────────────────────────── */
export default function SetDetailPage() {
  const { setId } = useParams<{ setId: string }>();

  const [set, setSet]           = useState<TcgSet | null>(null);
  const [cards, setCards]       = useState<TcgApiCard[]>([]);
  const [owned, setOwned]       = useState<CardDoc[]>([]);
  const [loading, setLoading]   = useState(true);

  const [filter, setFilter]     = useState<Filter>('all');
  const [sortKey, setSortKey]   = useState<SortKey>('number');
  const [sortDir, setSortDir]   = useState<SortDir>('asc');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [setRes, cardsRes, ownedCards] = await Promise.all([
          fetch(`/api/sets?id=${setId}`).then(r => r.json()),
          fetch(`/api/tcg?q=${encodeURIComponent(`set.id:${setId}`)}&pageSize=250`).then(r => r.json()),
          getCards(),
        ]);
        setSet(setRes.data ?? null);
        setCards(cardsRes.data ?? []);
        setOwned(ownedCards);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [setId]);

  const ownedTcgIds = useMemo(() => new Set(owned.map(c => c.tcgId).filter(Boolean)), [owned]);

  /* Rarity breakdown */
  const rarityBreakdown = useMemo(() => {
    const map = new Map<string, { group: typeof RARITY_GROUPS[number]; count: number; ownedCount: number }>();
    for (const card of cards) {
      const g = card.rarity ? getRarityGroup(card.rarity) : null;
      const key = g?.label ?? 'Sonstige';
      const entry = map.get(key) ?? { group: g ?? { label: key, symbol: '?', color: '#6b7280', keys: [] }, count: 0, ownedCount: 0 };
      entry.count++;
      if (ownedTcgIds.has(card.id)) entry.ownedCount++;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [cards, ownedTcgIds]);

  /* Filtered + sorted cards */
  const displayed = useMemo(() => {
    let result = [...cards];
    if (filter === 'owned')   result = result.filter(c => ownedTcgIds.has(c.id));
    if (filter === 'missing') result = result.filter(c => !ownedTcgIds.has(c.id));

    result.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'number') cmp = (parseInt(a.number) || 0) - (parseInt(b.number) || 0);
      if (sortKey === 'name')   cmp = a.name.localeCompare(b.name);
      // price sort: fall back to number if no price data yet
      if (sortKey === 'price')  cmp = (parseInt(a.number) || 0) - (parseInt(b.number) || 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [cards, filter, sortKey, sortDir, ownedTcgIds]);

  const ownedCount = cards.filter(c => ownedTcgIds.has(c.id)).length;
  const totalCount = cards.length || set?.total || 0;
  const pct        = totalCount ? Math.round((ownedCount / totalCount) * 100) : 0;

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown size={11} />;
    return sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />;
  };

  return (
    <div className="min-h-screen">
      {/* Sticky header */}
      <div className="sticky top-safe z-20 bg-background border-b border-border px-4 pt-4 pb-3 flex items-center gap-3">
        <Link href="/" className="text-muted-foreground shrink-0">
          <ChevronLeft size={22} />
        </Link>
        {set ? (
          <div className="flex items-center gap-2 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={set.images.logo} alt={set.name} className="h-6 max-w-[80px] object-contain shrink-0" />
            <span className="font-semibold text-sm truncate">{getSetNameDe(setId, set.name)}</span>
            {set.ptcgoCode && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md border shrink-0"
                style={{ color: 'var(--foreground)', borderColor: 'var(--foreground)' }}>
                {set.ptcgoCode}
              </span>
            )}
          </div>
        ) : (
          <span className="font-semibold text-sm text-muted-foreground">Set wird geladen…</span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center pt-16">
          <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
        </div>
      ) : set && (
        <>
          {/* Set info */}
          <div className="px-4 pt-4 pb-3 space-y-3 border-b border-border">
            {/* Stats */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-semibold">{ownedCount} / {totalCount} Karten</span>
                <span className="text-xs text-muted-foreground">{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--pokedex-red)' }} />
              </div>
            </div>

            {/* Rarity breakdown */}
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {rarityBreakdown.map(({ group, count, ownedCount: oc }) => (
                <div key={group.label} className="flex items-center gap-1">
                  <span className="text-xs font-bold" style={{ color: group.color }}>{group.symbol}</span>
                  <span className="text-xs text-muted-foreground">{oc}/{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Filter + Sort bar */}
          <div className="sticky z-10 bg-background border-b border-border px-4 py-2 space-y-2"
               style={{ top: 'calc(env(safe-area-inset-top, 0px) + 53px)' }}>
            {/* Filter pills */}
            <div className="flex gap-2">
              {(['all', 'owned', 'missing'] as Filter[]).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
                  style={{
                    background: filter === f ? 'var(--pokedex-red)' : 'var(--secondary)',
                    color: filter === f ? '#fff' : 'var(--muted-foreground)',
                  }}>
                  {f === 'all' ? 'Alle' : f === 'owned' ? 'Im Besitz' : 'Fehlt'}
                </button>
              ))}
              <span className="ml-auto text-xs text-muted-foreground self-center">{displayed.length}</span>
            </div>

            {/* Sort buttons */}
            <div className="flex gap-2">
              {([['number', 'Nummer'], ['name', 'Name'], ['price', 'Preis']] as [SortKey, string][]).map(([k, label]) => (
                <button key={k} onClick={() => toggleSort(k)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    background: sortKey === k ? 'color-mix(in srgb, var(--pokedex-red) 12%, transparent)' : 'var(--secondary)',
                    color: sortKey === k ? 'var(--pokedex-red)' : 'var(--muted-foreground)',
                  }}>
                  {label}
                  <SortIcon k={k} />
                </button>
              ))}
            </div>
          </div>

          {/* Card grid */}
          <div className="px-3 py-3 grid grid-cols-3 gap-2">
            {displayed.map(card => {
              const isOwned = ownedTcgIds.has(card.id);
              return (
                <Link key={card.id} href={`/collection?q=${encodeURIComponent(card.name)}`}
                  className="flex flex-col items-center gap-1">
                  <div className="w-full aspect-[2/3] rounded-lg overflow-hidden border border-border relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={card.images.small}
                      alt={card.name}
                      className="w-full h-full object-cover transition-all"
                      style={!isOwned ? { filter: 'brightness(0.55) saturate(0.3)' } : undefined}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground tabular-nums">{card.number}</span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
