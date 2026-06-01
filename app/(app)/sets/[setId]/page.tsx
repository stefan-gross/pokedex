'use client';

import { useEffect, useState, useMemo, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronDown } from 'lucide-react';

import { getCards } from '@/lib/firestore/cards';
import { getCardsBySetId } from '@/lib/firestore/catalog';
import { getBinders } from '@/lib/firestore/binders';
import { ButtonGroup } from '@/components/ui/button-group';
import { CardGrid } from '@/components/card/CardGrid';
import { RarityFilterBar } from '@/components/card/RarityFilterBar';
import { detectVariants, getRarityGroup } from '@/lib/card-constants';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
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

  const [rawCards, setRawCards]     = useState<CatalogCard[]>([]);
  const [owned, setOwned]           = useState<CardDoc[]>([]);
  const [binders, setBinders]       = useState<BinderDoc[]>([]);
  const [loading, setLoading]       = useState(true);

  // CatalogCard → CardInfo normalisieren
  const cards = useMemo(() => rawCards.map(catalogCardToInfo), [rawCards]);

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
        setRawCards(catalogCards);
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

  const ownedMap = useMemo(() => {
    const map = new Map<string, CardDoc[]>();
    owned.forEach(c => {
      if (c.tcgId) {
        const arr = map.get(c.tcgId) ?? [];
        arr.push(c);
        map.set(c.tcgId, arr);
      }
    });
    return map;
  }, [owned]);

  const ownedTcgIds = useMemo(() => new Set(ownedMap.keys()), [ownedMap]);

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
        return rarityFilter.has(g?.label ?? 'Sonstige');
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
  }, [cards, filter, sort, rarityFilter, ownedTcgIds, getRarityGroup]);

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
            <RarityFilterBar
              cards={cards}
              ownedIds={ownedTcgIds}
              activeRarities={rarityFilter}
              onToggle={toggleRarity}
            />
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

          {/* ── Card grid + Detail Sheet ── */}
          <div className="px-3 py-3">
            <CardGrid
              cards={displayed}
              ownedMap={ownedMap}
              binders={binders}
              setMeta={{ nameDe: (nameDe || cards[0]?.setName) ?? '', logoUrl, total: totalCount }}
            />
          </div>
        </>
      )}
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
