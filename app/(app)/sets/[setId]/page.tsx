'use client';

import { useEffect, useState, useMemo, useCallback, useRef, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ChevronLeft, BookOpen, Plus } from 'lucide-react';

import { getCards } from '@/lib/firestore/cards';
import { getCardsBySetId } from '@/lib/firestore/catalog';
import { getBinders } from '@/lib/firestore/binders';
import { fetchPricesBatch } from '@/lib/prices/fetch-batch';
import { pickTrendPrice } from '@/lib/prices/value-tier';
import { ButtonGroup } from '@/components/ui/button-group';
import { Button } from '@/components/ui/button';
import { ScrollToTopButton } from '@/components/ui/ScrollToTopButton';
import { Grabber } from '@/components/ui/Grabber';
import { useGrabberCollapse } from '@/lib/hooks/use-grabber-collapse';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { CreateTemplateBinderModal } from '@/components/binder/CreateTemplateBinderModal';
import { CardGrid } from '@/components/card/CardGrid';
import { CardSortBar } from '@/components/card/CardSortBar';
import { RarityFilterBar } from '@/components/card/RarityFilterBar';
import { getRarityGroup, SYMBOL_ONLY_SERIES } from '@/lib/card-constants';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { filterCardsByQuery } from '@/lib/search/card-query';
import { useWishlist } from '@/lib/hooks/use-wishlist';
import type { CatalogCard } from '@/lib/firestore/catalog';
import type { CardDoc, BinderDoc } from '@/types';

/* Karten des Sets aus dem (vollständigen) TCGdex-Katalog. */
async function loadSetCards(setId: string): Promise<CatalogCard[]> {
  return getCardsBySetId(setId);
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
  const [pricesLoading, setPricesLoading] = useState(false);
  const priceLoadedRef = useRef(false);
  // Grabber-/Scroll-Kollaps über den geteilten Hook — 2 Regionen:
  // Region 0 = Filter-Body (klappt zuerst), Region 1 = Status-Block (Fortschritt+Wert).
  const panelRef = useRef<HTMLDivElement>(null);
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const { stage, registerRegion, regionStyle, grabberProps } = useGrabberCollapse({
    regionCount: 2,
    panelRef,
    gridWrapRef,
    ready: !loading,
    measureDeps: [cards.length, pricesLoading],
  });
  const [search, setSearch]   = useState('');
  const { wishlistIds, toggle: toggleWishlist } = useWishlist();
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);

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

  // Preise beim Öffnen des Sets laden — die Wert-Kennzahlen („Wert (besessen)"
  // + „bis komplett") und die Preis-Sortierung brauchen sie ohnehin. Aufwand
  // begrenzt: `fetchPricesBatch` liest cache-first (7-Tage-TTL) über den
  // gebündelten Set-Pfad (`setId`), nur fehlende/veraltete Preise werden live
  // nachgeholt (keine 60er-Kappung bei gesetztem setId).
  useEffect(() => {
    if (rawCards.length === 0) return;
    priceLoadedRef.current = true;
    // Nur Karten anfragen, die noch keinen Preis in der Map haben — ein
    // erneuter Lauf holt die beim ersten Mal (Zeitbudget der Batch-Route) noch
    // nicht gelieferten Preise nach, statt es bei einem Einmal-Abruf zu belassen.
    const ids = rawCards.map(c => c.id).filter(id => !priceMap.has(id));
    if (ids.length === 0) return;
    setPricesLoading(true);
    fetchPricesBatch(ids, setId).then(prices => {
      setPriceMap(prev => {
        const map = new Map(prev);
        prices.forEach((data, id) => {
          const price = pickTrendPrice(data);
          if (price != null) map.set(id, price);
        });
        return map;
      });
    }).catch(() => {}).finally(() => setPricesLoading(false));
    // priceMap bewusst NICHT in den Deps (sonst Endlosschleife).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawCards, setId]);

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

  // Besitz-Daten neu laden — nötig, wenn im Kartendetail eine Karte hinzugefügt/
  // gelöscht wurde, damit die Set-Ansicht sofort Vorhanden/Fehlen aktualisiert
  // (sonst bleibt eine gerade hinzugefügte Karte als „fehlend" stehen).
  const reloadOwned = useCallback(() => {
    getCards().then(setOwned).catch(() => {});
  }, []);
  const handleDetailClose = useCallback((card: CardInfo) => {
    refreshCardPrice(card);
    reloadOwned();
  }, [refreshCardPrice, reloadOwned]);

  const logoUrl = logoDe ?? "";
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

    // In-Set-Suche über die geteilte Such-Logik (`lib/search/card-query`):
    // Name (DE), englischer Name, **Illustrator**, Nummer (mit/ohne führende
    // Nullen) und Dex-Nr, inkl. Mehrwort-Schnitt — identische Semantik wie die
    // Suche-Seite. Alle Set-Karten liegen bereits client-seitig vor.
    result = filterCardsByQuery(result, search);

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
  }, [cards, filter, search, sortField, sortDir, priceMap, rarityFilter, ownedTcgIds, getRarityGroup]);

  const ownedCount = useMemo(() => cards.filter(c => ownedTcgIds.has(c.id)).length, [cards, ownedTcgIds]);
  const totalCount = cards.length;
  const pct        = totalCount ? Math.round((ownedCount / totalCount) * 100) : 0;

  // Wert-Kennzahlen aus derselben `priceMap` (Trend-Preis pro Karte): Wert der
  // besessenen Karten dieses Sets + Kosten bis komplett (Summe der fehlenden).
  const ownedValue = useMemo(() => {
    let sum = 0;
    cards.forEach(c => { if (ownedTcgIds.has(c.id)) { const p = priceMap.get(c.id); if (p != null) sum += p; } });
    return sum;
  }, [cards, ownedTcgIds, priceMap]);
  const missingValue = useMemo(() => {
    let sum = 0;
    cards.forEach(c => { if (!ownedTcgIds.has(c.id)) { const p = priceMap.get(c.id); if (p != null) sum += p; } });
    return sum;
  }, [cards, ownedTcgIds, priceMap]);
  // Gesamtwert des kompletten Sets = besessen + fehlend.
  const fullValue = ownedValue + missingValue;
  const eur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

  // Gibt es für dieses Set bereits eine automatische (Master-Set-)Sammlung?
  // Dann keinen „Sammlung erstellen"-Button anbieten.
  const hasAutoCollection = useMemo(
    () => binders.some(b => b.template?.type === 'masterSet' && b.template.setId === setId),
    [binders, setId],
  );

  const reloadBinders = useCallback(() => {
    getBinders().then(setBinders).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen">

      {/* ── Sticky Header-Bereich (bleibt oben, scrollt NICHT weg) ──
          Info-Panel als Header mit Ghost-Zurück-Button (auf der Glasfläche
          lesbar), darunter das kollabierende Filter-Panel. Alles in EINEM
          sticky Container → kein manueller Offset zwischen zwei Stickys. */}
      <div className="sticky top-safe z-20 px-3 pt-3 pb-1">

        {/* Ein Glas-Panel: Header (Zurück + Sammlung erstellen) + Logo/Meta +
            kollabierender Fortschritt/Wert + Filter, unten der Griff. */}
        <div ref={panelRef} className="glass rounded-[20px] px-4 pt-2 pb-4">
          {/* Zurück (links) + Sammlung erstellen (rechts: Sammlungs-Icon + Plus) */}
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" href={backHref} className="px-0 -ml-1" icon={<ChevronLeft size={18} strokeWidth={2} />}>
              {backLabel}
            </Button>
            {!loading && !hasAutoCollection && (
              <Button
                variant="secondary"
                size="sm"
                className="gap-1 px-2.5"
                onClick={() => setShowCreateTemplate(true)}
                aria-label="Sammlung erstellen"
              >
                <BookOpen size={16} />
                <Plus size={12} />
              </Button>
            )}
          </div>

          {!loading && (
            <div className="mt-1">
              {/* Logo + Meta — immer sichtbar */}
              <div className="flex items-center gap-4">
                {logoUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={logoUrl}
                    alt={nameDe}
                    className="h-12 max-w-[120px] object-contain shrink-0"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <div className="min-w-0">
                  <h1 className="text-role-h2 leading-tight truncate text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.2)]">
                    {nameDe || <span className="text-glass-muted">…</span>}
                  </h1>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {releaseYear && (
                      <span className="text-role-label text-glass-muted">{releaseYear}</span>
                    )}
                    {releaseYear && (ptcgoCode || symbolUrl) && <span className="text-glass-muted opacity-40 text-role-label">·</span>}
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

              {/* Fortschritt + Wert (Status) — Höhe folgt beim Ziehen dem Finger,
                  sonst per Stufe animiert. */}
              <div
                className="overflow-hidden"
                style={regionStyle(1)}
              >
                <div ref={registerRegion(1)} className="pt-4 space-y-1.5">
                    <div className="flex justify-between items-baseline">
                      <span className="text-role-title text-glass">{ownedCount} / {totalCount} Karten</span>
                      <span className="text-role-label text-glass-muted">{pct}%</span>
                    </div>
                    <Progress value={ownedCount} max={totalCount} accentColor="var(--pokedex-red)" />
                    {/* var(--pokedex-red) ist als CSS-Var ok — Progress nutzt es
                        nur direkt als `background`, keine Hex-Parsing-Tönung. */}

                    {/* Besitz-Wert / Gesamtwert des Sets — links unter dem Balken. */}
                    <div className="pt-0.5 text-role-label tabular-nums">
                      {pricesLoading && fullValue === 0 ? (
                        <span className="text-glass-muted">…</span>
                      ) : (
                        <>
                          <span className="text-glass font-semibold">{eur(ownedValue)}</span>
                          <span className="text-glass-muted"> / {eur(fullValue)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

              {/* Filter (Suche/Vorhanden/Rarity) — direkt auf dem Info-Panel,
                  Höhe folgt beim Ziehen dem Finger, sonst per Stufe animiert. */}
              <div className="mt-4">
                {/* Klappbarer Body: Suche + Vorhanden/Fehlen + Rarity */}
                <div
                  className="overflow-hidden"
                  style={regionStyle(0)}
                >
                  <div ref={registerRegion(0)} className="space-y-2 pt-1">
                    <Input
                      variant="search"
                      value={search}
                      onChange={setSearch}
                      onClear={() => setSearch('')}
                      placeholder="Suchen (Name, Nummer, Illustrator)"
                      size="sm"
                    />
                    <ButtonGroup
                      options={FILTER_OPTIONS}
                      value={filter}
                      onChange={setFilter}
                    />
                    <RarityFilterBar
                      cards={cards}
                      ownedIds={ownedTcgIds}
                      activeRarities={rarityFilter}
                      onToggle={toggleRarity}
                    />
                  </div>
                </div>

                {/* Immer sichtbar: Sortierung + Kartenanzahl */}
                <div className="pt-2">
                  <CardSortBar
                    options={SORT_OPTIONS}
                    sortField={sortField}
                    onSortFieldChange={setSortField}
                    sortDir={sortDir}
                    onSortDirChange={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                    resultLabel={pluralKarten(displayed.length)}
                  />
                </div>
              </div>

              {/* Griff (Grabber): Ziehen klappt stufenweise auf/zu (erst Filter,
                  dann Statusbalken); Tippen schaltet ganz auf/zu. */}
              <Grabber expanded={stage === 0} {...grabberProps} />
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center pt-16">
          <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* ── Card grid + Detail Sheet ── */}
          <div ref={gridWrapRef} className="px-3 py-3">
            <CardGrid
              cards={displayed}
              ownedMap={ownedMap}
              binders={binders}
              setMeta={{ nameDe: (nameDe || cards[0]?.setName) ?? '', logoUrl, printedTotal: totalCount, total: totalCount }}
              sortKey={sortField}
              priceMap={priceMap}
              onDetailClose={handleDetailClose}
              wishlistIds={wishlistIds}
              onToggleWishlist={toggleWishlist}
              pricesLoading={pricesLoading}
            />
          </div>

          <ScrollToTopButton />
        </>
      )}

      {showCreateTemplate && (
        <CreateTemplateBinderModal
          initialMasterSetId={setId}
          onClose={() => setShowCreateTemplate(false)}
          onSaved={() => { setShowCreateTemplate(false); reloadBinders(); }}
        />
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
