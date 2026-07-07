'use client';

import { useEffect, useState, useMemo, useCallback, useRef, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { getCards } from '@/lib/firestore/cards';
import { getCardsBySetId } from '@/lib/firestore/catalog';
import { getBinders } from '@/lib/firestore/binders';
import { fetchPricesBatch } from '@/lib/prices/fetch-batch';
import { pickTrendPrice } from '@/lib/prices/value-tier';
import { ButtonGroup } from '@/components/ui/button-group';
import { CardGrid } from '@/components/card/CardGrid';
import { CardSortBar } from '@/components/card/CardSortBar';
import { RarityFilterBar } from '@/components/card/RarityFilterBar';
import { detectVariants, getRarityGroup, SYMBOL_ONLY_SERIES } from '@/lib/card-constants';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { useWishlist } from '@/lib/hooks/use-wishlist';
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
type Filter    = 'all' | 'owned' | 'missing';
type SortField = 'number' | 'name' | 'pokedex' | 'hp' | 'price';
type SortDir   = 'asc' | 'desc';

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: 'all',     label: 'Alle' },
  { value: 'owned',   label: 'Vorhanden' },
  { value: 'missing', label: 'Fehlen' },
];

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'number',  label: 'Nummer' },
  { value: 'name',    label: 'Name' },
  { value: 'pokedex', label: 'Pokédex-Nr.' },
  { value: 'hp',      label: 'KP' },
  { value: 'price',   label: 'Preis' },
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

  // CatalogCard → CardInfo normalisieren — printedTotal/total fehlt am einzelnen
  // Katalog-Dokument, wird hier aus der Set-Kartenzahl ergänzt (für führende
  // Nullen beim Nummer-Sublabel, z.B. "053" bei einem 172er-Set)
  const cards = useMemo(
    () => rawCards.map(c => ({ ...catalogCardToInfo(c), printedTotal: rawCards.length, total: rawCards.length })),
    [rawCards],
  );

  const [filter, setFilter]           = useState<Filter>('all');
  const [sortField, setSortField]     = useState<SortField>('number');
  const [sortDir, setSortDir]         = useState<SortDir>('asc');
  const [rarityFilter, setRarityFilter] = useState<Set<string>>(new Set());
  const [priceMap, setPriceMap]       = useState<Map<string, number>>(new Map());
  const priceLoadedRef = useRef(false);
  const { wishlistIds, toggle: toggleWishlist } = useWishlist();

  /* Set meta */
  const [nameDe, setNameDe]         = useState('');
  const [logoDe, setLogoDe]         = useState<string | undefined>(undefined);
  const [releaseYear, setReleaseYear] = useState<string | undefined>(undefined);
  const [ptcgoCode, setPtcgoCode]   = useState<string | undefined>(undefined);
  const [symbolUrl, setSymbolUrl]   = useState<string | undefined>(undefined);

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
          id: string; name: string; nameDe?: string; logoUrl?: string;
          releaseDate?: string; ptcgoCode?: string; symbolUrl?: string;
        }) => s.id === setId);
        if (set) {
          setNameDe(set.nameDe ?? set.name);
          if (set.logoUrl)     setLogoDe(set.logoUrl);
          if (set.releaseDate) setReleaseYear(set.releaseDate.slice(0, 4));
          if (set.ptcgoCode)   setPtcgoCode(set.ptcgoCode);
          if (set.symbolUrl)   setSymbolUrl(set.symbolUrl);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [setId]);

  // Preise nur laden, wenn tatsächlich nach Preis sortiert wird — spart
  // Firestore-Reads für den (häufigeren) Fall, dass niemand danach sortiert.
  useEffect(() => {
    if (sortField !== 'price' || rawCards.length === 0 || priceLoadedRef.current) return;
    priceLoadedRef.current = true;
    fetchPricesBatch(rawCards.map(c => c.id)).then(prices => {
      const map = new Map<string, number>();
      prices.forEach((data, id) => {
        const price = pickTrendPrice(data);
        if (price != null) map.set(id, price);
      });
      setPriceMap(map);
    }).catch(() => { priceLoadedRef.current = false; });
  }, [sortField, rawCards]);

  // Trifft die Batch-Route (`app/api/prices/batch`) ein Live-Refresh-Limit,
  // bekommt eine gerade im Detail-Sheet geöffnete Karte trotzdem sofort ihren
  // aktuellen Preis (Einzelkarten-Route hat kein Limit) — beim Schließen des
  // Sheets gezielt genau diese eine Karte nachziehen.
  const refreshCardPrice = useCallback((card: CardInfo) => {
    if (!priceLoadedRef.current) return; // Preis-Sortierung war noch nie aktiv
    fetchPricesBatch([card.id]).then(prices => {
      const data = prices.get(card.id);
      const price = data ? pickTrendPrice(data) : null;
      if (price != null) setPriceMap(prev => new Map(prev).set(card.id, price));
    }).catch(() => {});
  }, []);

  const logoUrl = logoDe ?? `https://images.pokemontcg.io/${setId}/logo.png`;
  // Sets vor Scarlet & Violet tragen keinen echten Kürzel-Aufdruck — nur ein
  // grafisches Symbol. ptcgoCode ist dort nur ein internes pokemontcg.io-Kürzel.
  const isSymbolOnlySet = !!rawCards[0]?.series && SYMBOL_ONLY_SERIES.includes(rawCards[0].series);

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
      // Preis: Karten ohne Preisdaten immer ans Ende, unabhängig von der Richtung.
      if (sortField === 'price') {
        const pa = priceMap.get(a.id);
        const pb = priceMap.get(b.id);
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1;
        if (pb == null) return -1;
        return sortDir === 'desc' ? pb - pa : pa - pb;
      }

      let cmp = 0;
      if (sortField === 'number') {
        const na = parseInt(a.number) || 0;
        const nb = parseInt(b.number) || 0;
        cmp = na !== nb ? na - nb : a.number.localeCompare(b.number);
      } else if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === 'pokedex') {
        cmp = (a.nationalDexNumber ?? 0) - (b.nationalDexNumber ?? 0);
      } else if (sortField === 'hp') {
        cmp = (a.hp ?? 0) - (b.hp ?? 0);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return result;
  }, [cards, filter, sortField, sortDir, priceMap, rarityFilter, ownedTcgIds, getRarityGroup]);

  const ownedCount = useMemo(() => cards.filter(c => ownedTcgIds.has(c.id)).length, [cards, ownedTcgIds]);
  const totalCount = cards.length;
  const pct        = totalCount ? Math.round((ownedCount / totalCount) * 100) : 0;

  return (
    <div className="min-h-screen">

      {/* ── Sticky top bar ── */}
      <div className="sticky top-safe z-20 px-4 pt-4 pb-3">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-glass-muted">
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
          <div className="glass rounded-[20px] mx-4 mt-1 mb-4 p-4 space-y-4">
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
                <h1 className="text-lg font-bold leading-tight truncate text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.2)]">
                  {nameDe || <span className="text-glass-muted">…</span>}
                </h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {releaseYear && (
                    <span className="text-xs text-glass-muted">{releaseYear}</span>
                  )}
                  {releaseYear && (ptcgoCode || symbolUrl) && <span className="text-glass-muted opacity-40 text-xs">·</span>}
                  {isSymbolOnlySet && symbolUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={symbolUrl} alt={ptcgoCode ?? ''} className="w-[21px] h-[21px] object-contain" />
                  ) : ptcgoCode && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md border text-glass"
                          style={{ borderColor: 'currentcolor' }}>
                      {ptcgoCode}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-semibold text-glass">{ownedCount} / {totalCount} Karten</span>
                <span className="text-xs text-glass-muted">{pct}%</span>
              </div>
              <div className="h-2 rounded-full glass-inner overflow-hidden">
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
          <div className="sticky z-10 glass rounded-[20px] mx-4 mb-3 px-4 py-2.5 space-y-2"
               style={{ top: 'calc(env(safe-area-inset-top, 0px) + 49px)' }}>

            {/* Row 1: Vorhanden/Fehlen-Filter */}
            <ButtonGroup
              options={FILTER_OPTIONS}
              value={filter}
              onChange={setFilter}
            />

            {/* Row 2: Sortierfeld + Richtung + Anzahl */}
            <CardSortBar
              options={SORT_OPTIONS}
              sortField={sortField}
              onSortFieldChange={setSortField}
              sortDir={sortDir}
              onSortDirChange={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              resultLabel={pluralKarten(displayed.length)}
            />

          </div>

          {/* ── Card grid + Detail Sheet ── */}
          <div className="px-3 py-3">
            <CardGrid
              cards={displayed}
              ownedMap={ownedMap}
              binders={binders}
              setMeta={{ nameDe: (nameDe || cards[0]?.setName) ?? '', logoUrl, printedTotal: totalCount, total: totalCount }}
              sortKey={sortField}
              priceMap={priceMap}
              onDetailClose={refreshCardPrice}
              wishlistIds={wishlistIds}
              onToggleWishlist={toggleWishlist}
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
