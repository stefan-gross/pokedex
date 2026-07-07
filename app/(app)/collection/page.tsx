'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, X, SlidersHorizontal, GitMerge } from 'lucide-react';
import { CardGrid, CardGridSkeleton } from '@/components/card/CardGrid';
import { CardSortBar } from '@/components/card/CardSortBar';
import { RarityFilterBar } from '@/components/card/RarityFilterBar';
import { ButtonGroup } from '@/components/ui/button-group';
import { getCards } from '@/lib/firestore/cards';
import { searchCatalog, searchCatalogByArtistPrefix, getCatalogCardsByIds, getCardsByDexNumber, getCardsByEvolutionFamily, getCatalogCount, getCatalogFilterCounts, getBrowseCount, type FilterCounts, type CatalogCard } from '@/lib/firestore/catalog';
import { searchTcgdexDe } from '@/lib/tcgdex';
import { getEvolutionFamilyDexNumbers } from '@/lib/pokeapi';
import { catalogCardToInfo, tcgApiCardToInfo, type CardInfo } from '@/lib/card-info';
import { getRarityGroup } from '@/lib/card-constants';
import { useCardBrowser, TCG_TYPES, type TcgType, type CardBrowserFilter } from '@/lib/hooks/useCardBrowser';
import { useWishlist } from '@/lib/hooks/use-wishlist';
import { EnergyIcon, ENERGY_META } from '@/components/ui/EnergyIcon';
import type { TcgApiCard } from '@/lib/pokemon-tcg';
import type { CardDoc } from '@/types';
import type { BrowseSortKey } from '@/lib/firestore/catalog';

type OwnedFilter   = 'all' | 'owned' | 'missing' | 'review';
type SearchSortKey = 'number' | 'name' | 'pokedex' | 'hp';
type Supertype     = 'Pokémon' | 'Trainer' | 'Energy';

// Mindestlänge pro Wort für Mehrwort- bzw. reine Illustrator-Suche — vermeidet
// teure/false-positive-lastige Kombinationsversuche bei sehr kurzen Eingaben
const MIN_COMBO_LEN = 3;

// Anzahl Karten, die pro Scroll-Schritt zusätzlich sichtbar gemacht werden
const SEARCH_REVEAL_CHUNK = 20;

const OWNED_OPTIONS: { value: OwnedFilter; label: string }[] = [
  { value: 'all',     label: 'Alle'      },
  { value: 'owned',   label: 'Vorhanden' },
  { value: 'missing', label: 'Fehlen'    },
  { value: 'review',  label: 'Prüfen'    },
];

const BROWSE_SORT_OPTIONS: { value: BrowseSortKey; label: string }[] = [
  { value: 'name',    label: 'A–Z'          },
  { value: 'hp',      label: 'KP (höchste)' },
  { value: 'pokedex', label: 'Pokédex-Nr.'  },
];

const SEARCH_SORT_OPTIONS: { value: SearchSortKey; label: string }[] = [
  { value: 'number',  label: 'Nummer'      },
  { value: 'name',    label: 'Name'        },
  { value: 'pokedex', label: 'Pokédex-Nr.' },
  { value: 'hp',      label: 'KP'          },
];

const EVOLUTION_OPTIONS: { value: string | null; label: string }[] = [
  { value: null,      label: 'Alle Stufen' },
  { value: 'Basic',   label: 'Basis'   },
  { value: 'Stage 1', label: 'Phase 1' },
  { value: 'Stage 2', label: 'Phase 2' },
];

function fmt(n: number) { return n.toLocaleString('de'); }

function FilterChip({ label, onRemove, color, icon }: {
  label: string; onRemove: () => void; color?: string; icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onRemove}
      className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border shrink-0 transition-colors ${color ? '' : 'glass-inner text-glass'}`}
      style={color
        ? { borderColor: color, background: `${color}22`, color }
        : undefined
      }
    >
      {icon}{label} <X size={10} />
    </button>
  );
}

function CollectionContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const initialQ     = searchParams.get('q') ?? '';

  // ── Geteilter Filter-State ─────────────────────────────────────
  const [activeTypes,      setActiveTypes]      = useState<Set<TcgType>>(new Set());
  const [activeSupertype,  setActiveSupertype]  = useState<Supertype | 'all'>('all');
  const [ownedFilter,      setOwnedFilter]      = useState<OwnedFilter>('all');
  const [activeRarity,     setActiveRarity]     = useState<string | null>(null);
  const [activeEvolutions, setActiveEvolutions] = useState<Set<string>>(new Set());
  const [evoLineActive,    setEvoLineActive]    = useState(false);
  const baseResultsRef = useRef<CardInfo[]>([]); // Suchergebnisse vor Evo-Line-Erweiterung

  // ── Browse-spezifisch ─────────────────────────────────────────
  const [browseSort,    setBrowseSort]    = useState<BrowseSortKey>('name');
  const [browseSortDir, setBrowseSortDir] = useState<'asc' | 'desc'>('asc');

  // ── Suche ─────────────────────────────────────────────────────
  const [inputValue,    setInputValue]    = useState(initialQ);
  const [results,       setResults]       = useState<CardInfo[]>([]);
  const [ownedCards,    setOwnedCards]    = useState<CardDoc[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSort,    setSearchSort]    = useState<SearchSortKey>('number');
  const [searchSortDir, setSearchSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterSet,     setFilterSet]     = useState('');
  const [sets,          setSets]          = useState<{ id: string; name: string }[]>([]);
  const [catalogCount,  setCatalogCount]  = useState(0);
  const catalogCountRef = useRef(0);
  const [searchVisibleCount, setSearchVisibleCount] = useState(20);
  const searchSentinelRef = useRef<HTMLDivElement>(null);

  // ── UI-State ──────────────────────────────────────────────────
  const [filterCounts,     setFilterCounts]     = useState<FilterCounts | null>(null);
  const [browseTotal,      setBrowseTotal]      = useState<number | null>(null);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const lastScrollY      = useRef(0);
  const scrollLockRef    = useRef(false);
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef    = useRef<HTMLDivElement>(null);

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => {
    getCards().then(setOwnedCards).catch(() => {});
    getCatalogCount().then(n => { setCatalogCount(n); catalogCountRef.current = n; }).catch(() => {});
    getCatalogFilterCounts().then(setFilterCounts).catch(() => {});
  }, []);

  // ── Dynamische Counts (debounced) ─────────────────────────────
  const activeTypesKey = useMemo(() => [...activeTypes].sort().join(','), [activeTypes]);

  useEffect(() => {
    if (countTimerRef.current) clearTimeout(countTimerRef.current);
    countTimerRef.current = setTimeout(() => {
      const singleType = activeTypes.size === 1 ? [...activeTypes][0] : undefined;
      getCatalogFilterCounts({
        type:      singleType,
        supertype: activeSupertype !== 'all' ? activeSupertype : undefined,
      }).then(setFilterCounts).catch(() => {});
    }, 300);
    return () => { if (countTimerRef.current) clearTimeout(countTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTypesKey, activeSupertype]);

  // ── Exakte Gesamtzahl für aktuellen Browse-Filter ─────────────
  const activeEvolutionsKey = useMemo(() => [...activeEvolutions].sort().join(','), [activeEvolutions]);
  const hasActiveFilterForCount = !!(activeTypes.size || activeSupertype !== 'all' || activeEvolutions.size || ownedFilter !== 'all' || activeRarity);
  useEffect(() => {
    if (!hasActiveFilterForCount) { setBrowseTotal(null); return; }
    const browseFilter = activeTypes.size > 0
      ? { type: [...activeTypes][0] }
      : activeEvolutions.size === 1
        ? { evolutionStage: [...activeEvolutions][0] }
        : activeSupertype !== 'all'
          ? { supertype: activeSupertype }
          : {};
    getBrowseCount(browseFilter).then(n => setBrowseTotal(n >= 0 ? n : null)).catch(() => setBrowseTotal(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTypesKey, activeSupertype, activeEvolutionsKey, hasActiveFilterForCount]);

  // ── Scroll-Collapse ───────────────────────────────────────────
  useEffect(() => {
    lastScrollY.current = window.scrollY;
    const onScroll = () => {
      if (scrollLockRef.current) return;
      const y = Math.max(0, window.scrollY);
      if (y > lastScrollY.current + 40 && y > 80) {
        setFiltersCollapsed(true);
        lastScrollY.current = y;
        scrollLockRef.current = true;
        setTimeout(() => {
          lastScrollY.current = Math.max(0, window.scrollY);
          scrollLockRef.current = false;
        }, 200);
      } else if (y < lastScrollY.current - 25) {
        setFiltersCollapsed(false);
        lastScrollY.current = y;
        scrollLockRef.current = true;
        setTimeout(() => {
          lastScrollY.current = Math.max(0, window.scrollY);
          scrollLockRef.current = false;
        }, 200);
      }
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

  // tcgIds der Karten die noch geprüft werden müssen (für "Zu prüfen"-Filter)
  const reviewTcgIds = useMemo(
    () => new Set(ownedCards.filter(c => c.needsReview && c.tcgId).map(c => c.tcgId!)),
    [ownedCards],
  );

  const browserFilter = useMemo<CardBrowserFilter>(() => ({
    supertype:       activeSupertype !== 'all' ? activeSupertype : undefined,
    types:           activeTypes.size > 0 ? [...activeTypes] : undefined,
    evolutionStages: activeEvolutions.size > 0 ? [...activeEvolutions] : undefined,
    rarity:          activeRarity ?? undefined,
    ownedFilter: ownedFilter === 'review' ? 'all' : ownedFilter,
    ownedIds,
  }), [activeSupertype, activeTypesKey, activeEvolutionsKey, activeRarity, ownedFilter, ownedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    cards: browseCards, loading: browseLoading,
    loadingMore, hasMore, loadMore,
  } = useCardBrowser(browseSort, browserFilter, browseSortDir === 'desc');

  const { wishlistIds, toggle: toggleWishlist } = useWishlist();

  // ── Infinite Scroll ───────────────────────────────────────────
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || inputValue) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasMore && !loadingMore && !browseLoading) loadMore();
    }, { rootMargin: '300px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, browseLoading, loadMore, inputValue]);

  // ── Such-Modus: nur einen sichtbaren Ausschnitt rendern, Rest beim
  // Scrollen nachladen — die zugrundeliegenden Arrays (results/displayed)
  // bleiben vollständig, Zähler/Filter-Counts bleiben also exakt ──
  useEffect(() => { setSearchVisibleCount(SEARCH_REVEAL_CHUNK); }, [inputValue]);

  // ── Suche ─────────────────────────────────────────────────────
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setSets([]); return; }
    setSearchLoading(true);

    const setAndReturn = (cards: CardInfo[]) => {
      const setMap = new Map<string, string>();
      cards.forEach(c => setMap.set(c.setId, c.setName));
      setSets(Array.from(setMap.entries()).map(([id, name]) => ({ id, name })));
      baseResultsRef.current = cards;
      setResults(cards);
    };

    try {
      // Pokédex-Nummer-Erkennung: "#25" oder reine Zahl (1–1025)
      const dexMatch = q.trim().match(/^#?(\d{1,4})$/);
      const dexNum = dexMatch ? parseInt(dexMatch[1], 10) : null;
      if (dexNum && dexNum >= 1 && dexNum <= 1025 && catalogCountRef.current > 0) {
        const dexHits = await getCardsByDexNumber(dexNum, 80);
        if (dexHits.length > 0) {
          setAndReturn(dexHits.map(catalogCardToInfo));
          setSearchSort('pokedex');
          return;
        }
      }

      // catalogCountRef statt catalogCount — keine Re-Render durch nachladen
      if (catalogCountRef.current > 0) {
        const words = q.trim().split(/\s+/).filter(Boolean);

        // Sucht einen Namensteil per Firestore-Präfix, mit TCGdex als Fallback.
        // TCGdex macht serverseitig eine lockere Teilstring-Suche — bei mehrteiliger
        // Eingabe würde das ein unpassendes zweites Wort stillschweigend ignorieren
        // (z.B. "Knapfel Nonsense" trotzdem als "Knapfel" matchen), deshalb nur für
        // echte Einzelwort-Namensteile, nie für die volle Mehrwort-Eingabe.
        const findByName = async (namePart: string): Promise<CatalogCard[]> => {
          const nameHits = await searchCatalog(namePart, filterSet, 80);
          if (nameHits.length > 0) return nameHits;
          if (namePart.trim().includes(' ')) return [];
          const tcgdexIds = await searchTcgdexDe(namePart);
          if (tcgdexIds.length === 0) return [];
          return getCatalogCardsByIds(tcgdexIds.slice(0, 80));
        };

        // 1. Gesamte Eingabe als Name (deckt auch mehrteilige Namen ab)
        let hits = await findByName(q);

        // 2. Mehrwort-Eingabe ("Knapfel Morii" bzw. "Morii Knapfel") — ein Wort als
        // Name, das andere client-seitig als Illustrator-Teilstring auf den gefundenen
        // Kandidaten abgeglichen (kein artistLower-Feld für Server-Suche vorhanden).
        // Erst ab MIN_COMBO_LEN Zeichen pro Wort, sonst zu viele False-Positives/Anfragen.
        if (hits.length === 0 && words.length > 1 && words.every(w => w.length >= MIN_COMBO_LEN)) {
          for (const { namePart, artistPart } of [
            { namePart: words.slice(0, -1).join(' '), artistPart: words[words.length - 1] },
            { namePart: words.slice(1).join(' '),     artistPart: words[0] },
          ]) {
            const nameHits = await findByName(namePart);
            if (nameHits.length === 0) continue;
            const artistLower = artistPart.toLowerCase();
            const filtered = nameHits.filter(c => c.artist?.toLowerCase().includes(artistLower));
            if (filtered.length > 0) { hits = filtered; break; }
          }
        }

        // 3. Reine Illustrator-Suche (ganze Eingabe = Künstlername/-präfix)
        if (hits.length === 0 && q.trim().length >= MIN_COMBO_LEN) {
          hits = await searchCatalogByArtistPrefix(q, 80);
        }

        if (hits.length > 0) { setAndReturn(hits.map(catalogCardToInfo)); return; }

        // Catalog vorhanden + nichts gefunden → API hilft auch nicht
        // (pokemontcg.io kennt nur englische Namen; deutsche Suchen würden immer scheitern)
        setResults([]);
        setSets([]);
        return;
      }

      // 3. pokemontcg.io API — nur wenn kein lokaler Catalog vorhanden (Erststart)
      const qStr = `name:${q}*${filterSet ? ` set.id:${filterSet}` : ''}`;
      const res  = await fetch(`/api/tcg?q=${encodeURIComponent(qStr)}&pageSize=80`);
      const data = await res.json();
      const cards: CardInfo[] = (data.data as TcgApiCard[] ?? []).map(tcgApiCardToInfo);
      const setMap = new Map<string, string>();
      cards.forEach(c => setMap.set(c.setId, c.setName));
      setSets(Array.from(setMap.entries()).map(([id, name]) => ({ id, name })));
      baseResultsRef.current = cards;
      setResults(cards);
    } catch {
      setResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [filterSet]); // catalogCount raus → doSearch bleibt stabil, kein Re-Search beim Laden

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

  // ── Evo-Linie: Ergebnisse um gesamte Evolutionsfamilie erweitern ──
  useEffect(() => {
    if (!evoLineActive) {
      // Deaktiviert → auf ursprüngliche Suchergebnisse zurücksetzen
      if (baseResultsRef.current.length > 0) setResults(baseResultsRef.current);
      return;
    }
    if (results.length === 0) return;

    const firstCard  = results.find(c => c.nationalDexNumber);
    const baseDexNum = firstCard?.nationalDexNumber;
    if (!baseDexNum) return;

    let cancelled = false;
    (async () => {
      let extra: CardInfo[] = [];

      // Firestore-First: evolutionFamily vorhanden → ein Query reicht
      if (firstCard?.evolutionFamily && firstCard.evolutionFamily.length > 1) {
        const hits = await getCardsByEvolutionFamily(baseDexNum);
        extra = hits.map(catalogCardToInfo);
      } else {
        // Fallback: PokéAPI → dann getCardsByDexNumber pro Familienmitglied
        const familyNums = await getEvolutionFamilyDexNumbers(baseDexNum);
        const otherNums  = familyNums.filter(n => n !== baseDexNum);
        if (otherNums.length > 0) {
          const batches = await Promise.all(otherNums.map(n => getCardsByDexNumber(n)));
          extra = batches.flat().map(catalogCardToInfo);
        }
      }

      if (cancelled || extra.length === 0) return;
      const existingIds = new Set(results.map(c => c.id));
      const newCards    = extra.filter(c => !existingIds.has(c.id));
      if (newCards.length > 0) setResults(prev => [...prev, ...newCards]);
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evoLineActive, results.length > 0 && results[0]?.id]);

  // Sucherg. durch geteilte Filter gefiltert
  const displayed = useMemo(() => {
    let r = [...results];
    if (ownedFilter === 'owned')        r = r.filter(c => ownedIds.has(c.id));
    if (ownedFilter === 'missing')     r = r.filter(c => !ownedIds.has(c.id));
    if (ownedFilter === 'review')      r = r.filter(c => reviewTcgIds.has(c.id));
    if (activeSupertype !== 'all')     r = r.filter(c => c.supertype?.toLowerCase() === activeSupertype.toLowerCase());
    if (activeTypes.size > 0)          r = r.filter(c => c.types?.some(t => activeTypes.has(t as TcgType)));
    if (activeEvolutions.size > 0)     r = r.filter(c => c.subtypes?.some(s => activeEvolutions.has(s)));
    if (activeRarity) {
      r = r.filter(c => (getRarityGroup(c.rarity ?? '')?.label ?? 'Sonstige') === activeRarity);
    }
    const d = searchSortDir === 'desc' ? -1 : 1;
    r.sort((a, b) =>
      searchSort === 'name'
        ? d * a.name.localeCompare(b.name)
        : searchSort === 'pokedex'
          ? d * ((a.nationalDexNumber ?? 9999) - (b.nationalDexNumber ?? 9999))
          : searchSort === 'hp'
            ? d * ((a.hp ?? 0) - (b.hp ?? 0))
            : d * ((parseInt(a.number) || 0) - (parseInt(b.number) || 0)),
    );
    return r;
  }, [results, ownedFilter, activeSupertype, activeTypesKey, activeEvolutionsKey, activeRarity, ownedIds, reviewTcgIds, searchSort, searchSortDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // Review-Mode: kein Suchbegriff + "Zu prüfen" Filter → eigene Karten laden
  const isReviewMode = !inputValue && ownedFilter === 'review';
  const isBrowseMode = !inputValue && ownedFilter !== 'review';
  const hasActiveFilter = !!(activeTypes.size || activeSupertype !== 'all' || ownedFilter !== 'all' || activeRarity || activeEvolutions.size);

  useEffect(() => {
    const el = searchSentinelRef.current;
    if (!el || isBrowseMode) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setSearchVisibleCount(n => n + SEARCH_REVEAL_CHUNK);
    }, { rootMargin: '300px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isBrowseMode, displayed.length]);

  // Review-Mode: Catalog-Karten für alle ungeprüften Einträge laden
  useEffect(() => {
    if (!isReviewMode) return;
    if (reviewTcgIds.size === 0) { setResults([]); return; }
    getCatalogCardsByIds([...reviewTcgIds]).then(cards => {
      baseResultsRef.current = cards.map(catalogCardToInfo);
      setResults(baseResultsRef.current);
    }).catch(() => {});
  }, [isReviewMode, reviewTcgIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearSearch = () => {
    setInputValue('');
    setResults([]);
    setSets([]);
    router.replace('/collection', { scroll: false });
  };

  const toggleType = (t: TcgType) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  const toggleEvolution = (stage: string) => {
    setActiveEvolutions(prev => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage); else next.add(stage);
      return next;
    });
  };

  // Ergebniszahl — immer die exakte Gesamtzahl, unabhängig davon wie viele
  // Karten aktuell tatsächlich geladen/gerendert sind (Lazy-Loading beim Scrollen)
  const resultCount = isBrowseMode
    ? browseTotal != null
      ? fmt(browseTotal)
      : !hasActiveFilterForCount && catalogCount > 0
        ? fmt(catalogCount)
        : browseCards.length > 0 ? `${browseCards.length}${hasMore ? '+' : ''}` : null
    : displayed.length > 0 ? fmt(displayed.length) : null;
  const showResultCount = true;

  // Disabled-Logik für Type-Pills
  const typeCountInContext = useMemo(() => {
    const source = isBrowseMode ? filterCounts?.types : null;
    if (source) return source;
    if (!isBrowseMode) {
      return Object.fromEntries(TCG_TYPES.map(t => [t, results.filter(c => c.types?.includes(t)).length]));
    }
    return null;
  }, [isBrowseMode, filterCounts, results]);

  // Disabled-Logik für Entwicklungsstufen-Pills
  const evolutionCountInContext = useMemo((): Record<string, number> | null => {
    const cards = isBrowseMode ? browseCards : results;
    if (cards.length === 0) return null;
    return {
      'Basic':   cards.filter(c => c.subtypes?.includes('Basic')).length,
      'Stage 1': cards.filter(c => c.subtypes?.includes('Stage 1')).length,
      'Stage 2': cards.filter(c => c.subtypes?.includes('Stage 2')).length,
    };
  }, [isBrowseMode, browseCards, results]);

  // Supertype-Optionen mit Counts
  const supertypeOptions = useMemo(() => [
    { value: 'all',     label: 'Alle',    count: filterCounts ? Object.values(filterCounts.supertypes).reduce((a, b) => a + b, 0) : undefined },
    { value: 'Pokémon', label: 'Pokémon', count: filterCounts?.supertypes['Pokémon'] },
    { value: 'Trainer', label: 'Trainer', count: filterCounts?.supertypes['Trainer'] ?? (filterCounts ? 0 : undefined) },
    { value: 'Energy',  label: 'Energie', count: filterCounts?.supertypes['Energy']  ?? (filterCounts ? 0 : undefined) },
  ], [filterCounts]);

  const showTypePills = activeSupertype === 'all' || activeSupertype === 'Pokémon';
  const showEvolution = showTypePills;

  // Karten für RarityFilterBar (browseModus = geladene Karten; Suche = Suchergebnisse)
  const rarityCards  = isBrowseMode ? browseCards : results;

  return (
    <div className="flex flex-col min-h-screen">

      {/* ── Sticky Header ──────────────────────────────────────── */}
      <div className="sticky top-safe z-20 mx-3 mt-2 glass rounded-[20px] px-4 pt-4 pb-3 space-y-2">

        {/* Suchfeld */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-glass-muted pointer-events-none" />
          <input
            type="search"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="Name, Illustrator … oder stöbern"
            className="w-full h-10 pl-9 pr-8 rounded-xl glass-inner text-glass text-sm placeholder:text-glass-muted focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {inputValue && (
            <button type="button" onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-glass-muted">
              <X size={14} />
            </button>
          )}
        </div>

        {/* ── Filter-Block ───────────────────────────────────── */}
        {filtersCollapsed ? (
          /* Kompakter Strip mit aktiven Chips */
          hasActiveFilter ? (
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
              {activeSupertype !== 'all' && (
                <FilterChip label={activeSupertype} onRemove={() => setActiveSupertype('all')} />
              )}
              {[...activeTypes].map(t => (
                <FilterChip
                  key={t}
                  label={ENERGY_META[t].de}
                  onRemove={() => toggleType(t)}
                  color={ENERGY_META[t].bg}
                  icon={<EnergyIcon type={t} size={14} />}
                />
              ))}
              {[...activeEvolutions].map(s => (
                <FilterChip
                  key={s}
                  label={EVOLUTION_OPTIONS.find(o => o.value === s)?.label ?? s}
                  onRemove={() => toggleEvolution(s)}
                />
              ))}
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
            {/* Zeile 1: Vorhanden/Fehlen (+ Set-Filter in Suche) */}
            <div className="flex items-center gap-2">
              <ButtonGroup options={OWNED_OPTIONS} value={ownedFilter} onChange={v => setOwnedFilter(v as OwnedFilter)} />
              {!isBrowseMode && sets.length > 1 && (
                <select value={filterSet} onChange={e => setFilterSet(e.target.value)}
                  className="h-8 px-2 rounded-lg glass-inner text-xs max-w-[120px] ml-auto">
                  <option value="">Alle Sets</option>
                  {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>

            {/* Zeile 2: Supertype mit Counts */}
            <ButtonGroup
              options={supertypeOptions}
              value={activeSupertype}
              onChange={v => { setActiveSupertype(v as Supertype | 'all'); setActiveTypes(new Set()); setActiveEvolutions(new Set()); }}
            />

            {/* Zeile 3: Typ-Pills (Mehrfachauswahl, OR) */}
            {showTypePills && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
                {TCG_TYPES.map(t => {
                  const active    = activeTypes.has(t);
                  const meta      = ENERGY_META[t];
                  const count     = typeCountInContext?.[t];
                  const isDisabled = count === 0;
                  return (
                    <button
                      key={t}
                      onClick={() => !isDisabled && toggleType(t)}
                      disabled={isDisabled}
                      className={`flex items-center gap-1.5 text-xs pl-1 pr-2.5 py-1 rounded-full border-2 whitespace-nowrap transition-all shrink-0 disabled:opacity-30 disabled:cursor-not-allowed ${active ? '' : 'glass-inner text-glass-muted'}`}
                      style={{
                        borderColor: active ? meta.bg : 'transparent',
                        background:  active ? `${meta.bg}22` : undefined,
                        color:       active ? meta.bg : undefined,
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

            {/* Zeile 4: Entwicklungsstufe als Pills (Mehrfachauswahl, leer = alle) */}
            {showEvolution && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
                {EVOLUTION_OPTIONS.filter(o => o.value !== null).map(o => {
                  const active     = activeEvolutions.has(o.value!);
                  const count      = evolutionCountInContext?.[o.value!];
                  const isDisabled = count === 0;
                  return (
                    <button
                      key={o.value}
                      onClick={() => !isDisabled && toggleEvolution(o.value!)}
                      disabled={isDisabled}
                      className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border-2 whitespace-nowrap transition-all shrink-0 disabled:opacity-30 disabled:cursor-not-allowed ${active ? '' : 'glass-inner text-glass-muted'}`}
                      style={{
                        borderColor: active ? 'var(--pokedex-red)' : 'transparent',
                        background:  active ? 'color-mix(in srgb, var(--pokedex-red) 15%, transparent)' : undefined,
                        color:       active ? 'var(--pokedex-red)' : undefined,
                        fontWeight:  active ? 600 : 400,
                      }}
                    >
                      {o.label}
                      {count != null && count > 0 && (
                        <span className="text-[10px] opacity-50 font-normal">{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Zeile 5: Rarity — Browse: globale Firestore-Counts; Suche: aus Ergebnissen */}
            <RarityFilterBar
              cards={rarityCards}
              ownedIds={ownedIds}
              activeRarities={activeRarity ? new Set([activeRarity]) : new Set()}
              onToggle={label => setActiveRarity(prev => prev === label ? null : label)}
              rarityCounts={isBrowseMode ? filterCounts?.rarities : undefined}
            />
          </>
        )}

        {/* ── Sortierung + Ergebniszahl (immer sichtbar) ──────── */}
        {isBrowseMode ? (
          <CardSortBar
            options={BROWSE_SORT_OPTIONS}
            sortField={browseSort}
            onSortFieldChange={setBrowseSort}
            sortDir={browseSortDir}
            onSortDirChange={() => setBrowseSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            resultLabel={showResultCount && resultCount != null ? `${resultCount} Karten` : undefined}
          />
        ) : (
          <CardSortBar
            options={SEARCH_SORT_OPTIONS}
            sortField={searchSort}
            onSortFieldChange={setSearchSort}
            sortDir={searchSortDir}
            onSortDirChange={() => setSearchSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            resultLabel={showResultCount && resultCount != null ? `${resultCount} Karten` : undefined}
            extra={
              <button
                onClick={() => setEvoLineActive(p => !p)}
                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-all ${evoLineActive ? '' : 'glass-inner text-glass-muted'}`}
                style={{
                  borderColor: evoLineActive ? 'var(--pokedex-red)' : 'transparent',
                  background:  evoLineActive ? 'color-mix(in srgb, var(--pokedex-red) 12%, transparent)' : undefined,
                  color:       evoLineActive ? 'var(--pokedex-red)' : undefined,
                  fontWeight:  evoLineActive ? 600 : 400,
                }}
              >
                <GitMerge size={12} /> Evo-Linie
              </button>
            }
          />
        )}
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="flex-1 px-3 py-3">

        {/* Browse-Modus — zeigt initial den gesamten Katalog, dynamisches Nachladen beim Scrollen */}
        {isBrowseMode && (
          browseLoading && browseCards.length === 0 ? (
            <CardGridSkeleton />
          ) : (
            <>
              {browseCards.length === 0 && !browseLoading && (
                <p className="text-center text-glass-muted text-sm pt-12">
                  Keine Karten für diesen Filter.
                </p>
              )}
              <CardGrid cards={browseCards} ownedMap={ownedMap} sortKey={browseSort} wishlistIds={wishlistIds} onToggleWishlist={toggleWishlist} />
              <div ref={sentinelRef} className="h-1" />
              {loadingMore && (
                <div className="flex justify-center py-4">
                  <div className="w-6 h-6 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </>
          )
        )}

        {/* Such-Modus */}
        {!isBrowseMode && (
          <>
            {searchLoading && <CardGridSkeleton />}
            {!searchLoading && results.length === 0 && inputValue && (
              <div className="flex flex-col items-center gap-2 pt-16 text-center">
                <Search size={40} className="text-glass-muted" />
                <p className="font-medium text-sm">Keine Karten gefunden</p>
                <p className="text-xs text-glass-muted">Kein Ergebnis für „{inputValue}"</p>
              </div>
            )}
            {!searchLoading && results.length > 0 && displayed.length === 0 && inputValue && (
              <div className="flex flex-col items-center gap-2 pt-16 text-center">
                <SlidersHorizontal size={40} className="text-glass-muted" />
                <p className="font-medium text-sm">Filter zu streng</p>
                <p className="text-xs text-glass-muted">
                  {results.length} Karten gefunden, aber alle durch aktive Filter ausgeblendet.
                </p>
              </div>
            )}
            {!searchLoading && displayed.length > 0 && (
              <>
                <CardGrid cards={displayed.slice(0, searchVisibleCount)} ownedMap={ownedMap} sortKey={searchSort} wishlistIds={wishlistIds} onToggleWishlist={toggleWishlist} />
                <div ref={searchSentinelRef} className="h-1" />
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
