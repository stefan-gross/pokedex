'use client';

import { useEffect, useState, useMemo, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronDown } from 'lucide-react';

import { getCards } from '@/lib/firestore/cards';
import { getCardsBySetId } from '@/lib/firestore/catalog';
import { getBinders } from '@/lib/firestore/binders';
import { ButtonGroup } from '@/components/ui/button-group';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { detectVariants } from '@/lib/card-constants';
import type { CatalogCard } from '@/lib/firestore/catalog';
import type { CardDoc, BinderDoc } from '@/types';

/* Wenn der Catalog dieses Set noch nicht hat → pokemontcg.io API als Fallback */
async function loadSetCards(setId: string): Promise<CatalogCard[]> {
  const catalogCards = await getCardsBySetId(setId);
  if (catalogCards.length > 0) return catalogCards;

  const res = await fetch(`/api/tcg?q=${encodeURIComponent(`set.id:${setId}`)}&pageSize=250`);
  const data = await res.json();
  return (data.data ?? []).map((c: {
    id: string; name: string; number: string;
    set: { id: string; name: string; series: string };
    rarity?: string; supertype?: string; types?: string[];
    images: { small: string; large: string };
  }): CatalogCard => ({
    id: c.id,
    name: c.name,
    nameLower: c.name.toLowerCase(),
    number: c.number,
    setId: c.set.id,
    setName: c.set.name,
    series: c.set.series,
    rarity: c.rarity ?? '',
    supertype: c.supertype ?? '',
    types: c.types ?? [],
    imgSmall: c.images.small,
    imgLarge: c.images.large,
    variants: detectVariants(c.rarity ?? ''),
  }));
}

/* ── Rarity helpers ──────────────────────────────────────────── */
const RARITY_GROUPS: { label: string; symbol: string; color: string; keys: string[] }[] = [
  { label: 'Common',       symbol: '◆',  color: '#9ca3af', keys: ['common'] },
  { label: 'Uncommon',     symbol: '◆◆', color: '#60a5fa', keys: ['uncommon'] },
  { label: 'Rare',         symbol: '★',  color: '#fbbf24', keys: ['rare'] },
  { label: 'Rare Holo',    symbol: '★✦', color: '#f59e0b', keys: ['rare holo'] },
  { label: 'Ultra Rare',   symbol: '★★', color: '#a78bfa', keys: ['double rare', 'ace spec rare', 'ultra rare', 'rare ultra', 'rare rainbow', 'hyper rare', 'rare secret'] },
  { label: 'ex / V',       symbol: '◈',  color: '#34d399', keys: ['rare holo ex', 'rare holo v', 'rare holo vmax', 'rare holo vstar', 'rare holo gx', 'rare holo lv.x'] },
  { label: 'Illustration', symbol: '🎨', color: '#f472b6', keys: ['illustration rare', 'special illustration rare'] },
  { label: 'Promo',        symbol: 'P',  color: '#fb923c', keys: ['promo', 'classic collection'] },
];

function getRarityGroup(rarity: string) {
  const lower = rarity.toLowerCase();
  return RARITY_GROUPS.find(g => g.keys.some(k => lower === k));
}

/* ── Types ───────────────────────────────────────────────────── */
type Filter  = 'all' | 'owned' | 'missing';
type SortKey = 'number-asc' | 'number-desc' | 'name-asc' | 'name-desc';

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: 'all',     label: 'Alle' },
  { value: 'owned',   label: 'Vorhanden' },
  { value: 'missing', label: 'Fehlen' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'number-asc',  label: 'Nummer ↑' },
  { value: 'number-desc', label: 'Nummer ↓' },
  { value: 'name-asc',    label: 'Name A–Z' },
  { value: 'name-desc',   label: 'Name Z–A' },
];

function pluralKarten(n: number) {
  return n === 1 ? '1 Karte' : `${n} Karten`;
}

/* ── Inner page (needs useSearchParams) ─────────────────────── */
function SetDetailContent() {
  const { setId }    = useParams<{ setId: string }>();
  const searchParams = useSearchParams();
  const from         = searchParams.get('from');

  const backHref  = from === 'dashboard' ? '/' : '/sets';
  const backLabel = from === 'dashboard' ? 'Dashboard' : 'Alle Sets';

  const [cards, setCards]           = useState<CatalogCard[]>([]);
  const [owned, setOwned]           = useState<CardDoc[]>([]);
  const [binders, setBinders]       = useState<BinderDoc[]>([]);
  const [loading, setLoading]       = useState(true);
  const [selectedCard, setSelectedCard] = useState<CatalogCard | null>(null);

  const [filter, setFilter]           = useState<Filter>('all');
  const [sort, setSort]               = useState<SortKey>('number-asc');
  const [rarityFilter, setRarityFilter] = useState<Set<string>>(new Set());

  /* Set meta */
  const [nameDe, setNameDe]         = useState('');
  const [logoDe, setLogoDe]         = useState<string | undefined>(undefined);
  const [releaseYear, setReleaseYear] = useState<string | undefined>(undefined);
  const [ptcgoCode, setPtcgoCode]   = useState<string | undefined>(undefined);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [catalogCards, ownedCards, setsData, bindersData] = await Promise.all([
          loadSetCards(setId),
          getCards(),
          fetch('/api/sets').then(r => r.json()),
          getBinders(),
        ]);
        setCards(catalogCards);
        setOwned(ownedCards);
        setBinders(bindersData);

        const set = (setsData.data ?? []).find((s: {
          id: string; name: string; nameDe?: string; logoDe?: string;
          releaseDate?: string; ptcgoCode?: string;
        }) => s.id === setId);
        if (set) {
          setNameDe(set.nameDe ?? set.name);
          if (set.logoDe)      setLogoDe(set.logoDe);
          if (set.releaseDate) setReleaseYear(set.releaseDate.slice(0, 4));
          if (set.ptcgoCode)   setPtcgoCode(set.ptcgoCode);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [setId]);

  const logoUrl = logoDe ?? `https://images.pokemontcg.io/${setId}/logo.png`;

  const ownedTcgIds = useMemo(() => new Set(owned.map(c => c.tcgId).filter(Boolean)), [owned]);

  /* Rarity breakdown — only groups that exist in this set */
  const rarityBreakdown = useMemo(() => {
    const map = new Map<string, { group: typeof RARITY_GROUPS[number]; count: number; ownedCount: number }>();
    for (const card of cards) {
      const g   = card.rarity ? getRarityGroup(card.rarity) : null;
      const key = g?.label ?? 'Sonstige';
      const entry = map.get(key) ?? { group: g ?? { label: key, symbol: '?', color: '#6b7280', keys: [] }, count: 0, ownedCount: 0 };
      entry.count++;
      if (ownedTcgIds.has(card.id)) entry.ownedCount++;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [cards, ownedTcgIds]);

  /* Toggle rarity filter */
  function toggleRarity(label: string) {
    setRarityFilter(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  /* Filtered + sorted cards */
  const displayed = useMemo(() => {
    let result = [...cards];
    if (filter === 'owned')   result = result.filter(c => ownedTcgIds.has(c.id));
    if (filter === 'missing') result = result.filter(c => !ownedTcgIds.has(c.id));

    if (rarityFilter.size > 0) {
      result = result.filter(c => {
        const g = c.rarity ? getRarityGroup(c.rarity) : null;
        const label = g?.label ?? 'Sonstige';
        return rarityFilter.has(label);
      });
    }

    result.sort((a, b) => {
      let cmp = 0;
      const key = sort.replace(/-asc|-desc/, '') as 'number' | 'name';
      if (key === 'number') {
        const na = parseInt(a.number) || 0;
        const nb = parseInt(b.number) || 0;
        cmp = na !== nb ? na - nb : a.number.localeCompare(b.number);
      }
      if (key === 'name') cmp = a.name.localeCompare(b.name);
      return sort.endsWith('-desc') ? -cmp : cmp;
    });
    return result;
  }, [cards, filter, sort, rarityFilter, ownedTcgIds]);

  const ownedCount = useMemo(() => cards.filter(c => ownedTcgIds.has(c.id)).length, [cards, ownedTcgIds]);
  const totalCount = cards.length;
  const pct        = totalCount ? Math.round((ownedCount / totalCount) * 100) : 0;

  return (
    <div className="min-h-screen">

      {/* ── Sticky top bar ── */}
      <div className="sticky top-safe z-20 bg-background border-b border-border px-4 pt-4 pb-3">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ChevronLeft size={18} strokeWidth={2} />
          {backLabel}
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center pt-16">
          <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* ── Set info header (scrolls away) ── */}
          <div className="px-4 pt-5 pb-4 border-b border-border space-y-4">
            {/* Logo + Meta */}
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt={nameDe}
                className="h-12 max-w-[120px] object-contain shrink-0"
                onError={e => {
                  const img = e.currentTarget as HTMLImageElement;
                  if (logoDe && img.src === logoDe) {
                    img.src = `https://images.pokemontcg.io/${setId}/logo.png`;
                  } else {
                    img.style.display = 'none';
                  }
                }}
              />
              <div className="min-w-0">
                <h1 className="text-lg font-bold leading-tight truncate">
                  {nameDe || <span className="text-muted-foreground">…</span>}
                </h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {releaseYear && (
                    <span className="text-xs text-muted-foreground">{releaseYear}</span>
                  )}
                  {releaseYear && ptcgoCode && <span className="text-muted-foreground/40 text-xs">·</span>}
                  {ptcgoCode && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md border"
                          style={{ color: 'var(--foreground)', borderColor: 'var(--foreground)' }}>
                      {ptcgoCode}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-semibold">{ownedCount} / {totalCount} Karten</span>
                <span className="text-xs text-muted-foreground">{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full transition-all"
                     style={{ width: `${pct}%`, background: pct === 100 ? '#48bb78' : 'var(--pokedex-red)' }} />
              </div>
            </div>

            {/* Rarity breakdown — klickbar als Filter */}
            {rarityBreakdown.length > 0 && (
              <div className="flex flex-wrap gap-x-2 gap-y-1.5">
                {rarityBreakdown.map(({ group, count, ownedCount: oc }) => {
                  const active = rarityFilter.has(group.label);
                  return (
                    <button
                      key={group.label}
                      onClick={() => toggleRarity(group.label)}
                      className="flex items-center gap-1 rounded-full transition-all px-2 py-0.5 border"
                      style={active ? {
                        background: `${group.color}22`,
                        borderColor: group.color,
                      } : {
                        borderColor: 'transparent',
                      }}
                    >
                      <span className="text-xs font-bold" style={{ color: group.color }}>{group.symbol}</span>
                      <span className="text-xs" style={{ color: active ? group.color : 'var(--muted-foreground)' }}>
                        {oc}/{count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Sticky filter + sort bar ── */}
          <div className="sticky z-10 bg-background border-b border-border px-4 py-2.5"
               style={{ top: 'calc(env(safe-area-inset-top, 0px) + 49px)' }}>

            {/* Row 1: filter + sort + count */}
            <div className="flex items-center gap-2">
              <ButtonGroup
                options={FILTER_OPTIONS}
                value={filter}
                onChange={setFilter}
              />

              <div className="relative flex items-center">
                <select
                  value={sort}
                  onChange={e => setSort(e.target.value as SortKey)}
                  className="text-xs rounded-lg pl-2.5 pr-6 py-1.5 border border-border bg-secondary text-foreground appearance-none cursor-pointer"
                >
                  {SORT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-1.5 pointer-events-none text-muted-foreground" />
              </div>

              <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-auto">
                {pluralKarten(displayed.length)}
              </span>
            </div>

          </div>

          {/* ── Card grid ── */}
          <div className="px-3 py-3 grid grid-cols-3 gap-2">
            {displayed.map(card => {
              const isOwned     = ownedTcgIds.has(card.id);
              const rarityColor = card.rarity ? (getRarityGroup(card.rarity)?.color ?? null) : null;
              return (
                <button
                  key={card.id}
                  onClick={() => setSelectedCard(card)}
                  className="flex flex-col items-center gap-1 active:opacity-70 transition-opacity"
                >
                  <div
                    className="w-full aspect-[2/3] rounded-lg overflow-hidden border-2 relative"
                    style={{ borderColor: rarityColor ?? 'var(--border)' }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={card.imgSmall}
                      alt={card.name}
                      className="w-full h-full object-cover transition-all"
                      style={!isOwned ? { filter: 'brightness(0.55) saturate(0.3)' } : undefined}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground tabular-nums">{card.number}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {/* ── Card Detail Sheet ── */}
      <CardDetailSheet
        card={selectedCard}
        ownedCopies={owned.filter(c => c.tcgId === selectedCard?.id)}
        binders={binders}
        setMeta={{ nameDe: (nameDe || cards[0]?.setName) ?? '', logoUrl, total: totalCount }}
        onClose={() => setSelectedCard(null)}
        onSaved={() => { setSelectedCard(null); }}
      />
    </div>
  );
}

/* ── Page wrapper (Suspense für useSearchParams) ─────────────── */
export default function SetDetailPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center pt-16">
        <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <SetDetailContent />
    </Suspense>
  );
}
