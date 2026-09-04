'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, SlidersHorizontal } from 'lucide-react';
import { CardGrid, CardGridSkeleton } from '@/components/card/CardGrid';
import { CardSortBar } from '@/components/card/CardSortBar';
import { RarityFilterBar } from '@/components/card/RarityFilterBar';
import { ButtonGroup } from '@/components/ui/button-group';
import { CardSearchField } from '@/components/search/CardSearchField';
import { SearchableSelect, MultiSelect, CustomSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Grabber } from '@/components/ui/Grabber';
import { ScrollToTopButton } from '@/components/ui/ScrollToTopButton';
import { LegendButton } from '@/components/ui/LegendButton';
import { useGrabberCollapse } from '@/lib/hooks/use-grabber-collapse';
import { getCards } from '@/lib/firestore/cards';
import type { FilterCounts } from '@/lib/firestore/catalog';
// REST-Varianten (kein WebChannel-Cold-Start) — Aliase, Aufrufstellen unverändert.
import {
  getCardsByDexNumberRest as getCardsByDexNumber,
  getCardsByEvolutionFamilyRest as getCardsByEvolutionFamily,
  getCatalogCountRest as getCatalogCount,
  getSortableCountRest as getSortableCount,
  getCatalogFilterCountsRest as getCatalogFilterCounts,
  getBrowseCountRest as getBrowseCount,
} from '@/lib/firestore/catalog-rest';
import { searchCatalogCards } from '@/lib/search/catalog-search';
import { correctQuery } from '@/lib/search/suggest-index';
import { useSuggestIndex } from '@/lib/search/use-suggest-index';
import { getEvolutionFamilyDexNumbers } from '@/lib/pokeapi';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { applyFacetFilters, type FacetState, type FacetDim } from '@/lib/search/facet-filter';
import { SPECIAL_MECHANIC_KEYS, rarityMatchValues } from '@/lib/card-constants';
import { useCardBrowser, TCG_TYPES, type TcgType, type CardBrowserFilter } from '@/lib/hooks/useCardBrowser';
import { useWishlist } from '@/lib/hooks/use-wishlist';
import { EnergyIcon, ENERGY_META } from '@/components/ui/EnergyIcon';
import { getAllSets, type TcgSet } from '@/lib/firestore/sets';
import type { CardDoc } from '@/types';
import type { BrowseSortKey } from '@/lib/firestore/catalog';
import { trendFromCached } from '@/lib/prices/trend-from-cached';

type OwnedFilter   = 'all' | 'owned' | 'missing';
type SearchSortKey = 'number' | 'name' | 'pokedex' | 'hp' | 'price';
type Supertype     = 'Pokémon' | 'Trainer' | 'Energy';

// Mindestlänge pro Wort für Mehrwort- bzw. reine Illustrator-Suche — vermeidet
// teure/false-positive-lastige Kombinationsversuche bei sehr kurzen Eingaben
const MIN_COMBO_LEN = 3;

// Anzahl Karten, die pro Scroll-Schritt zusätzlich sichtbar gemacht werden
const SEARCH_REVEAL_CHUNK = 20;

// Limits sind reine Kosten-/Sicherheitsbremsen gegen einen extrem generischen
// Suchbegriff (z.B. 1 Buchstabe), der sonst den ganzen Katalog laden würde —
// keine Notwendigkeit für die Korrektheit der Suche selbst.
// Direkt angezeigte Treffer (Raster blendet ohnehin nur häppchenweise ein,
// SEARCH_REVEAL_CHUNK) — hoch genug, dass auch generische Kurz-Präfixe wie
// "Cha" (mehrere Pokémon-Familien über viele Sets) nicht abgeschnitten werden.
const SEARCH_DISPLAY_LIMIT = 300;
// Nur als Zwischenmenge für die Wort-für-Wort-Schnittmenge (Schritt 2) genutzt,
// nie direkt angezeigt — darf höher liegen, deckt auch sehr produktive
// Illustratoren (aktuell max. 208 Karten im Katalog) mit Puffer ab.
const SEARCH_CANDIDATE_LIMIT = 1000;

const OWNED_OPTIONS: { value: OwnedFilter; label: string }[] = [
  { value: 'all',     label: 'Alle'      },
  { value: 'owned',   label: 'Vorhanden' },
  { value: 'missing', label: 'Fehlen'    },
];

const BROWSE_SORT_OPTIONS: { value: BrowseSortKey; label: string }[] = [
  { value: 'name',    label: 'A–Z'          },
  { value: 'hp',      label: 'KP (höchste)' },
  { value: 'pokedex', label: 'Pokédex-Nr.'  },
  { value: 'price',   label: 'Preis'        },
];

const SEARCH_SORT_OPTIONS: { value: SearchSortKey; label: string }[] = [
  { value: 'number',  label: 'Nummer'      },
  { value: 'name',    label: 'Name'        },
  { value: 'pokedex', label: 'Pokédex-Nr.' },
  { value: 'hp',      label: 'KP'          },
  { value: 'price',   label: 'Preis'       },
];

function fmt(n: number) { return n.toLocaleString('de'); }

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
  const [activeSpecialMechanics, setActiveSpecialMechanics] = useState<Set<string>>(new Set());
  const [evoLineActive,    setEvoLineActive]    = useState(false);
  const [allSets,          setAllSets]          = useState<TcgSet[]>([]);
  const baseResultsRef = useRef<CardInfo[]>([]); // Suchergebnisse vor Evo-Line-Erweiterung

  // ── Browse-spezifisch ─────────────────────────────────────────
  const [browseSort,    setBrowseSort]    = useState<BrowseSortKey>('name');
  const [browseSortDir, setBrowseSortDir] = useState<'asc' | 'desc'>('asc');

  // ── Suche ─────────────────────────────────────────────────────
  const [inputValue,    setInputValue]    = useState(initialQ);
  // Geteilter Autosuggest-/Fuzzy-Index — nur noch für die „Meintest du …?"-
  // Korrektur unten; das Autosuggest-Panel selbst steckt in `CardSearchField`.
  const suggestIndex = useSuggestIndex();
  const [relaxedNote,   setRelaxedNote]   = useState<string | null>(null);
  const [results,       setResults]       = useState<CardInfo[]>([]);
  const [ownedCards,    setOwnedCards]    = useState<CardDoc[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSort,    setSearchSort]    = useState<SearchSortKey>('number');
  const [searchSortDir, setSearchSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterSet,     setFilterSet]     = useState('');
  const [sets,          setSets]          = useState<{ id: string; name: string; count: number }[]>([]);
  const [catalogCount,  setCatalogCount]  = useState(0);
  const catalogCountRef = useRef(0);
  // Anzahl Karten je (inhärentem) Sortierfeld — Pokédex-Nr./KP blenden Karten
  // ohne das Feld aus (Trainer/Energie). Für den Header-Zähler. (Preis lädt
  // zweiphasig alle Karten → braucht hier keinen Sonder-Zähler.)
  const [sortCounts,    setSortCounts]    = useState<{ pokedex: number; hp: number }>({ pokedex: 0, hp: 0 });
  const [searchVisibleCount, setSearchVisibleCount] = useState(20);
  const searchSentinelRef = useRef<HTMLDivElement>(null);

  // ── UI-State ──────────────────────────────────────────────────
  const [filterCounts,     setFilterCounts]     = useState<FilterCounts | null>(null);
  const [browseTotal,      setBrowseTotal]      = useState<number | null>(null);
  // Grabber-/Scroll-Kollaps über den geteilten Hook (1 Region, s.u.).
  const panelRef    = useRef<HTMLDivElement>(null);
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef    = useRef<HTMLDivElement>(null);

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => {
    getCards().then(setOwnedCards).catch(() => {});
    getCatalogCount().then(n => { setCatalogCount(n); catalogCountRef.current = n; }).catch(() => {});
    Promise.all([
      getSortableCount('nationalDexNumber'),
      getSortableCount('hp'),
    ]).then(([pokedex, hp]) => setSortCounts({ pokedex, hp })).catch(() => {});
    getCatalogFilterCounts().then(setFilterCounts).catch(() => {});
    getAllSets().then(setAllSets).catch(() => {});
  }, []);

  // Fuzzy-Korrektur bei 0 Treffern („Meintest du …?").
  const correction = useMemo(
    () => (inputValue.trim().length >= 3 ? correctQuery(suggestIndex, inputValue) : null),
    [suggestIndex, inputValue],
  );

  // Set-Metadaten (Symbol/Kürzel) für die Set-Badges auf Karten-Kacheln —
  // einmalig geladen, ~140 Docs, für die gesamte Seiten-Lebensdauer gecacht.
  const setsMetaMap = useMemo(() => new Map(allSets.map(s => [s.id, s])), [allSets]);
  // Nur Sets, in denen der aktuelle Suchbegriff mindestens eine Karte hat
  // (aus `sets` = alle Treffer-Sets). Deutschen Namen + Kürzel/EN-Name via
  // `setsMetaMap` auflösen, alphabetisch aufsteigend.
  const setFilterOptions = useMemo(
    () => [
      { value: '', label: 'Alle Sets' },
      ...sets
        .map(s => {
          const meta = setsMetaMap.get(s.id);
          return {
            value: s.id,
            label: meta?.nameDe ?? s.name,
            keywords: [meta?.name, s.name, meta?.ptcgoCode].filter(Boolean).join(' '),
            hint: s.count.toLocaleString('de'),   // Treffer-Anzahl rechts (statt Kürzel)
            icon: meta?.symbolUrl
              ? <img src={meta.symbolUrl} alt="" className="w-4 h-4 object-contain shrink-0" />
              : undefined,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'de')),
    ],
    [sets, setsMetaMap],
  );

  // Browse-Modus: ALLE Sets zur Auswahl (neueste zuerst) — der Set-Filter läuft
  // server-seitig (setId-equality), daher auch für große Sets sofort.
  const browseSetOptions = useMemo(
    () => [
      { value: '', label: 'Alle Sets' },
      ...[...allSets]
        .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
        .map(s => ({
          value: s.id,
          label: s.nameDe ?? s.name,
          keywords: [s.name, s.nameDe, s.ptcgoCode].filter(Boolean).join(' '),
          hint: s.ptcgoCode ?? undefined,
          icon: s.symbolUrl
            ? <img src={s.symbolUrl} alt="" className="w-4 h-4 object-contain shrink-0" />
            : undefined,
        })),
    ],
    [allSets],
  );

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
  const hasActiveFilterForCount = !!(filterSet || activeTypes.size || activeSupertype !== 'all' || activeEvolutions.size || activeSpecialMechanics.size || ownedFilter !== 'all' || activeRarity);
  useEffect(() => {
    if (!hasActiveFilterForCount) { setBrowseTotal(null); return; }
    // "Vorhanden" wird per ID komplett geladen (kein Server-Count nötig) → null,
    // das Label nutzt dann die exakte geladene Anzahl (browseCards.length).
    if (ownedFilter === 'owned') { setBrowseTotal(null); return; }
    // Gleiche Server-Filter-Priorität wie makeBrowseFilter: setId > type > rarity
    // > evolutionStage > supertype (sonst zählte z.B. eine aktive Rarity/ein Set
    // fälschlich den ganzen Katalog statt der Treffer).
    const browseFilter = filterSet
      ? { setId: filterSet }
      : activeTypes.size > 0
        ? { types: [...activeTypes] }
        : activeRarity
          ? { rarityKeys: rarityMatchValues(activeRarity) }
          : activeSpecialMechanics.size > 0
            ? { specialMechanics: [...activeSpecialMechanics] }
            : activeEvolutions.size === 1
              ? { evolutionStage: [...activeEvolutions][0] }
              : activeSupertype !== 'all'
                ? { supertype: activeSupertype }
                : {};
    getBrowseCount(browseFilter).then(n => setBrowseTotal(n >= 0 ? n : null)).catch(() => setBrowseTotal(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSet, activeTypesKey, activeSupertype, activeEvolutionsKey, activeRarity, activeSpecialMechanics, ownedFilter, hasActiveFilterForCount]);

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

  const activeSpecialMechanicsKey = useMemo(() => [...activeSpecialMechanics].sort().join(','), [activeSpecialMechanics]);

  const browserFilter = useMemo<CardBrowserFilter>(() => ({
    setId:           filterSet || undefined,
    supertype:       activeSupertype !== 'all' ? activeSupertype : undefined,
    types:           activeTypes.size > 0 ? [...activeTypes] : undefined,
    evolutionStages: activeEvolutions.size > 0 ? [...activeEvolutions] : undefined,
    specialMechanics: activeSpecialMechanics.size > 0 ? [...activeSpecialMechanics] : undefined,
    rarity:          activeRarity ?? undefined,
    ownedFilter,
    ownedIds,
  }), [filterSet, activeSupertype, activeTypesKey, activeEvolutionsKey, activeSpecialMechanicsKey, activeRarity, ownedFilter, ownedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    cards: browseCards, loading: browseLoading,
    loadingMore, hasMore, loadMore,
  } = useCardBrowser(browseSort, browserFilter, browseSortDir === 'desc');

  const { manualIds, autoIds, manualLists, memberManualListIds, autoListsFor, toggleOnList } = useWishlist();
  const wishlistGridProps = {
    manualIds, autoIds, manualLists,
    memberIdsFor: memberManualListIds,
    autoListsFor,
    onToggleList: toggleOnList,
  };

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
    try {
      // Kein lokaler Katalog (vor dem ersten Sync) → keine Treffer.
      if (catalogCountRef.current === 0) { setResults([]); setSets([]); return; }

      // Gemeinsame Server-Such-Pipeline (Dex → Name → Mehrwort Name∪Illustrator
      // → Illustrator-Fallback) — bewusst OHNE `setId`: wir holen ALLE Treffer,
      // damit das Set-Dropdown genau die Sets zeigt, in denen der Suchbegriff
      // vorkommt. Die Eingrenzung auf das gewählte Set passiert danach
      // client-seitig (kein zweiter Query, kein Composite-Index nötig).
      const { cards, sortHint } = await searchCatalogCards(q, {
        displayLimit: SEARCH_DISPLAY_LIMIT,
        candidateLimit: SEARCH_CANDIDATE_LIMIT,
        minComboLen: MIN_COMBO_LEN,
        // Dex-Brücke: über die Pokédex-Nr. der Namens-Treffer die GANZE Art
        // nachziehen — „Glurak" findet so auch „Mega-Glurak"/„Glurak ex" usw.
        // (nur bei fokussierter Suche ≤ 4 Arten aktiv, s. searchCatalogCards).
        bridgeByDex: true,
      });

      if (cards.length === 0) { setResults([]); setSets([]); return; }

      const infos = cards.map(catalogCardToInfo);
      // Set-Liste fürs Dropdown aus ALLEN Treffern (unabhängig vom gewählten Set),
      // sonst schrumpfte sie nach der Auswahl auf genau dieses eine Set. Pro Set
      // die Trefferzahl mitzählen (fürs Dropdown-Anzeige rechts).
      const setMap = new Map<string, { name: string; count: number }>();
      infos.forEach(c => {
        const e = setMap.get(c.setId) ?? { name: c.setName, count: 0 };
        e.count++;
        setMap.set(c.setId, e);
      });
      setSets(Array.from(setMap.entries()).map(([id, { name, count }]) => ({ id, name, count })));
      // Anzeige auf das gewählte Set eingrenzen (client-seitig).
      const scoped = filterSet ? infos.filter(c => c.setId === filterSet) : infos;
      baseResultsRef.current = scoped;
      setResults(scoped);
      if (sortHint === 'pokedex') setSearchSort('pokedex');
    } catch {
      setResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [filterSet]); // catalogCount raus → doSearch bleibt stabil, kein Re-Search beim Laden

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Ladezustand SOFORT beim Tippen setzen (nicht erst im Fetch) — sonst blieben
    // während der 350ms-Debounce die alten Treffer stehen. So erscheint das
    // Karten-Skeleton unmittelbar und bleibt bis die neuen Ergebnisse da sind.
    if (inputValue.trim()) setSearchLoading(true);
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

  const facetState = useMemo<FacetState>(() => ({
    ownedFilter, activeSupertype, activeTypes, activeEvolutions, activeSpecialMechanics, activeRarity, ownedIds,
  }), [ownedFilter, activeSupertype, activeTypesKey, activeEvolutionsKey, activeSpecialMechanicsKey, activeRarity, ownedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter + Suche: Wenn ein NEUES Suchergebnis (results) durch die aktiven
  // Filter auf 0 fällt (obwohl es ungefilterte Treffer gibt), werden GENAU die
  // Filter automatisch gelockert, die die 0 verursachen — die übrigen bleiben
  // erhalten. Läuft nur bei Ergebnis-Wechsel (Suchänderung), NICHT beim
  // manuellen Setzen eines Filters (dep = results), sonst ließe sich kein Filter
  // setzen, der (noch) 0 trifft.
  useEffect(() => {
    if (!inputValue || results.length === 0) return;
    if (applyFacetFilters(results, facetState).length > 0) return;   // Filter passen
    const local: FacetState = {
      ...facetState,
      activeTypes: new Set(facetState.activeTypes),
      activeEvolutions: new Set(facetState.activeEvolutions),
      activeSpecialMechanics: new Set(facetState.activeSpecialMechanics),
    };
    // Reihenfolge: erst spezifische/optische Filter lockern, zuletzt Owned.
    const steps: { active: boolean; label: string; relax: () => void; drop: () => void }[] = [
      { active: !!local.activeRarity,               label: 'Seltenheit',   relax: () => { local.activeRarity = null; },              drop: () => setActiveRarity(null) },
      { active: local.activeSpecialMechanics.size > 0, label: 'Sonderformen', relax: () => { local.activeSpecialMechanics = new Set(); }, drop: () => setActiveSpecialMechanics(new Set()) },
      { active: local.activeEvolutions.size > 0,    label: 'Stufe',        relax: () => { local.activeEvolutions = new Set(); },     drop: () => setActiveEvolutions(new Set()) },
      { active: local.activeTypes.size > 0,         label: 'Typ',          relax: () => { local.activeTypes = new Set(); },          drop: () => setActiveTypes(new Set()) },
      { active: local.activeSupertype !== 'all',    label: 'Kartenart',    relax: () => { local.activeSupertype = 'all'; },          drop: () => setActiveSupertype('all') },
      { active: local.ownedFilter !== 'all',        label: 'Vorhanden',    relax: () => { local.ownedFilter = 'all'; },              drop: () => setOwnedFilter('all') },
    ];
    const relaxed: string[] = [];
    for (const step of steps) {
      if (applyFacetFilters(results, local).length > 0) break;
      if (!step.active) continue;
      step.relax(); step.drop(); relaxed.push(step.label);
    }
    setRelaxedNote(relaxed.length ? relaxed.join(', ') : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  // Hinweis wieder ausblenden, sobald der Nutzer den Suchtext ändert.
  useEffect(() => { setRelaxedNote(null); }, [inputValue]);

  // Sucherg. durch geteilte Filter gefiltert
  const displayed = useMemo(() => {
    const r = [...applyFacetFilters(results, facetState)];
    const d = searchSortDir === 'desc' ? -1 : 1;
    r.sort((a, b) => {
      if (searchSort === 'name')    return d * a.name.localeCompare(b.name);
      if (searchSort === 'pokedex') return d * ((a.nationalDexNumber ?? 9999) - (b.nationalDexNumber ?? 9999));
      if (searchSort === 'hp')      return d * ((a.hp ?? 0) - (b.hp ?? 0));
      if (searchSort === 'price') {
        // Preis aus inline gecachtem `prices`-Feld; ohne Preis immer ans Ende.
        const pa = trendFromCached(a.prices), pb = trendFromCached(b.prices);
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1;
        if (pb == null) return -1;
        return d * (pa - pb);
      }
      return d * ((parseInt(a.number) || 0) - (parseInt(b.number) || 0));
    });
    return r;
  }, [results, facetState, searchSort, searchSortDir]);

  // Preis-Maps (id → Trendpreis) aus den inline gecachten Preisen — für die
  // Preis-Anzeige unter den Kacheln bei „Preis"-Sortierung (kein Extra-Fetch).
  const browsePriceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of browseCards) { const p = trendFromCached(c.prices); if (p != null) m.set(c.id, p); }
    return m;
  }, [browseCards]);
  const searchPriceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of displayed) { const p = trendFromCached(c.prices); if (p != null) m.set(c.id, p); }
    return m;
  }, [displayed]);

  const isBrowseMode = !inputValue;
  // Zeigt an, ob die Suchergebnisse mehrere unterschiedliche Sets enthalten —
  // nur dann macht das Set-Badge auf den Karten-Kacheln Sinn (sonst redundant).
  const resultsSpanMultipleSets = useMemo(
    () => new Set(displayed.map(c => c.setId)).size > 1,
    [displayed],
  );

  useEffect(() => {
    const el = searchSentinelRef.current;
    if (!el || isBrowseMode) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setSearchVisibleCount(n => n + SEARCH_REVEAL_CHUNK);
    }, { rootMargin: '300px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isBrowseMode, displayed.length]);

  const clearSearch = () => {
    setInputValue('');
    setResults([]);
    setSets([]);
    router.replace('/collection', { scroll: false });
  };

  // Ergebniszahl — immer die exakte Gesamtzahl, unabhängig davon wie viele
  // Karten aktuell tatsächlich geladen/gerendert sind (Lazy-Loading beim Scrollen)
  const resultCount = isBrowseMode
    ? browseTotal != null
      ? fmt(browseTotal)
      // Ungefilterter Browse nach Pokédex-Nr./KP: serverseitiges orderBy blendet
      // Karten ohne dieses (inhärente) Feld aus — Trainer/Energie haben keine
      // Pokédex-Nr./KP → die Zahl der Karten MIT diesem Feld anzeigen.
      // Preis dagegen lädt zweiphasig ALLE Karten (ohne Preis ans Ende) → voller
      // Katalog. Name → voller Katalog.
      : !hasActiveFilterForCount && (browseSort === 'pokedex' || browseSort === 'hp') && sortCounts[browseSort] > 0
        ? fmt(sortCounts[browseSort])
      : !hasActiveFilterForCount && catalogCount > 0
        ? fmt(catalogCount)
        : browseCards.length > 0 ? `${browseCards.length}${hasMore ? '+' : ''}` : null
    : displayed.length > 0 ? fmt(displayed.length) : null;
  const showResultCount = true;

  // Alle Zähler unten sind "kreuzreaktiv": im Suche-Modus werden sie aus den
  // Suchergebnissen berechnet, jeweils mit ALLEN AKTIVEN Filtern AUSSER der
  // eigenen Dimension (applyFacetFilters(..., skip)) — so zeigt z.B. die
  // Rarity-Zeile, wie viele Treffer JEDE Rarity hätte, wenn man Typ/Stufe/
  // Owned-Filter unverändert lässt, aber diese eine Rarity wählt. Im Browse-
  // Modus bleiben Typ/Stufe/Formen/Rarity wie bisher nur mit Typ+Supertype
  // kreuzreaktiv (Firestore-Limitierung — echte Kreuzreaktivität mit dem
  // Owned-Filter würde serverseitig eine "in"-Query über tausende IDs
  // brauchen, was Firestore nicht unterstützt).

  // Disabled-Logik für Type-Pills
  const typeCountInContext = useMemo(() => {
    if (isBrowseMode) return filterCounts?.types ?? null;
    const base = applyFacetFilters(results, facetState, 'types');
    return Object.fromEntries(TCG_TYPES.map(t => [t, base.filter(c => c.types?.includes(t)).length]));
  }, [isBrowseMode, filterCounts, results, facetState]);

  // „Sonderformen" fasst alle Spezial-Mechaniken (GX/ex/V/VMAX/VSTAR/V-Union …)
  // zu EINEM Filter zusammen — aktiv = irgendeine Mechanik gewählt.
  const specialFormsActive = activeSpecialMechanics.size > 0;
  const specialFormsCount = useMemo(() => {
    // Browse: globaler Katalog-Count (sonst zählte nur die aktuell geladene
    // Seite — z.B. A-Z-Anfang = lauter Basis-Pokémon → fälschlich 0).
    if (isBrowseMode) return filterCounts?.specialForms;
    const base = applyFacetFilters(results, facetState, 'specialMechanics');
    if (base.length === 0) return undefined;
    const keys = new Set<string>(SPECIAL_MECHANIC_KEYS as readonly string[]);
    return base.filter(c => c.subtypes?.some(s => keys.has(s))).length;
  }, [isBrowseMode, filterCounts, browseCards, results, facetState]);

  // Typ-Optionen für den Mehrfach-Auswahl-Dropdown (Icon + DE-Label + Count +
  // Typfarbe für die Pills, 0-Treffer ausgegraut).
  const typeOptions = useMemo(
    () => TCG_TYPES.map(t => ({
      value: t,
      label: ENERGY_META[t].de,
      icon: <EnergyIcon type={t} size={16} />,
      count: typeCountInContext?.[t],
      disabled: typeCountInContext?.[t] === 0,
      color: ENERGY_META[t].bg,
    })),
    [typeCountInContext],
  );

  // Owned-Optionen (Alle|Vorhanden|Fehlen) mit Zählern
  const ownedOptions = useMemo(() => {
    if (isBrowseMode) {
      // Browse: nur globale Näherung (eigene Sammlung ist vollständig lokal
      // bekannt, aber nicht mit Typ/Stufe/Rarity kombinierbar ohne teure
      // Firestore-"in"-Query über die gesamte Sammlung).
      const ownedTotal = ownedIds.size;
      return OWNED_OPTIONS.map(o => ({
        ...o,
        count: o.value === 'all' ? catalogCount || undefined
          : o.value === 'owned' ? ownedTotal
          : catalogCount > 0 ? Math.max(0, catalogCount - ownedTotal) : undefined,
      }));
    }
    const base = applyFacetFilters(results, facetState, 'owned');
    return OWNED_OPTIONS.map(o => ({
      ...o,
      count: o.value === 'all' ? base.length
        : o.value === 'owned' ? base.filter(c => ownedIds.has(c.id)).length
        : base.filter(c => !ownedIds.has(c.id)).length,
    }));
  }, [isBrowseMode, results, facetState, ownedIds, catalogCount]);

  // Supertype-Optionen mit Counts
  const supertypeOptions = useMemo(() => {
    if (isBrowseMode) {
      return [
        { value: 'all',     label: 'Alle',    count: filterCounts ? Object.values(filterCounts.supertypes).reduce((a, b) => a + b, 0) : undefined },
        { value: 'Pokémon', label: 'Pokémon', count: filterCounts?.supertypes['Pokémon'] },
        { value: 'Trainer', label: 'Trainer', count: filterCounts?.supertypes['Trainer'] ?? (filterCounts ? 0 : undefined) },
        { value: 'Energy',  label: 'Energie', count: filterCounts?.supertypes['Energy']  ?? (filterCounts ? 0 : undefined) },
      ];
    }
    const base = applyFacetFilters(results, facetState, 'supertype');
    const countFor = (s: string) => base.filter(c => c.supertype?.toLowerCase() === s.toLowerCase()).length;
    return [
      { value: 'all',     label: 'Alle',    count: base.length },
      { value: 'Pokémon', label: 'Pokémon', count: countFor('Pokémon') },
      { value: 'Trainer', label: 'Trainer', count: countFor('Trainer') },
      { value: 'Energy',  label: 'Energie', count: countFor('Energy') },
    ];
  }, [isBrowseMode, filterCounts, results, facetState]);

  const showTypePills = activeSupertype === 'all' || activeSupertype === 'Pokémon';
  const showEvolution = showTypePills;

  // Karten für RarityFilterBar (browseModus = geladene Karten; Suche = kreuzreaktiv,
  // alle Filter außer Rarity selbst)
  const rarityCards  = isBrowseMode ? browseCards : applyFacetFilters(results, facetState, 'rarity');

  // Grabber-/Scroll-Kollaps (1 Region: Set/Supertyp/Typ/Rarity/Stufen/Sonderformen).
  const { stage, registerRegion, regionStyle, grabberProps } = useGrabberCollapse({
    regionCount: 1,
    panelRef,
    gridWrapRef,
    measureDeps: [isBrowseMode, showTypePills, showEvolution, sets.length, activeSupertype],
  });

  return (
    <div className="flex flex-col min-h-screen">

      {/* ── Sticky Header ──────────────────────────────────────── */}
      {/* ── Sticky Header ──────────────────────────────────────── */}
      <div ref={panelRef} className="sticky top-safe z-20 mx-3 mt-2 glass rounded-[20px] px-4 pt-4 pb-3 space-y-2">

        {/* Suchfeld inkl. Autosuggest — geteilte Komponente (gleiche Suche
            app-weit). Enter führt die Suche sofort aus (Debounce überspringen). */}
        <CardSearchField
          size="lg"
          value={inputValue}
          onChange={setInputValue}
          onClear={clearSearch}
          onSubmit={q => { if (debounceRef.current) clearTimeout(debounceRef.current); doSearch(q); }}
          placeholder="Name, Illustrator … oder stöbern"
        />

        {/* Owned (Alle|Vorhanden|Fehlen) — immer sichtbar */}
        <ButtonGroup
          options={ownedOptions.map(o => ({ ...o, disabled: o.count === 0 }))}
          value={ownedFilter}
          onChange={v => setOwnedFilter(v as OwnedFilter)}
        />

        {/* Kollaps-Region (1): Supertyp + Typ + Rarity + Evolutionslinie +
            Sonderformen + Set — per Griff/Scroll ein-/ausklappbar. Suchfeld,
            Owned und Sortierung/Anzahl bleiben immer sichtbar. */}
        <div style={regionStyle(0)} className="overflow-hidden">
          <div ref={registerRegion(0)} className="flex flex-col gap-2 pt-0.5 pb-2">
            {/* Supertyp (Alle|Pokémon|Trainer|Energie) als Einfach-Auswahl-Dropdown */}
            <CustomSelect
              value={activeSupertype}
              onChange={v => { setActiveSupertype(v as Supertype | 'all'); setActiveTypes(new Set()); setActiveEvolutions(new Set()); }}
              options={supertypeOptions.map(o => ({
                value: o.value,
                label: o.label,
                count: o.count,
                disabled: o.count === 0 && o.value !== 'all',
              }))}
              height="sm"
              fullWidth
              aria-label="Kartenart"
            />

            {/* Pokémon-Typ als Mehrfach-Auswahl-Dropdown (Auswahl als Pills) */}
            {showTypePills && (
              <MultiSelect
                values={[...activeTypes]}
                onChange={vals => setActiveTypes(new Set(vals))}
                options={typeOptions}
                placeholder="Alle Typen"
                aria-label="Pokémon-Typ"
              />
            )}

            {/* Rarity — Browse: globale Firestore-Counts; Suche: aus Ergebnissen.
                „Sonderformen" läuft als zusätzlicher Chip am Ende der Rarity-Leiste
                mit (gleiche Optik wie z.B. Promo), fasst alle Spezial-Mechaniken
                (GX/ex/V/VMAX/VSTAR/V-Union …) zu EINEM Filter zusammen. */}
            <RarityFilterBar
              cards={rarityCards}
              ownedIds={ownedIds}
              activeRarities={activeRarity ? new Set([activeRarity]) : new Set()}
              onToggle={label => setActiveRarity(prev => prev === label ? null : label)}
              rarityCounts={isBrowseMode ? filterCounts?.rarities : undefined}
              extraChips={showTypePills ? [{
                key: 'special-forms',
                label: 'Sonderformen',
                count: specialFormsCount,
                color: 'var(--pokedex-red)',
                active: specialFormsActive,
                disabled: specialFormsCount === 0,
                onToggle: () => setActiveSpecialMechanics(prev =>
                  prev.size ? new Set() : new Set(SPECIAL_MECHANIC_KEYS)),
              }] : undefined}
            />

            {/* Evolutionslinie als Checkbox (Stufen-Pills entfernt) */}
            {showEvolution && !isBrowseMode && (
              <Switch
                checked={evoLineActive}
                onChange={setEvoLineActive}
                label="Evolutionslinie"
                className="self-start"
              />
            )}

            {/* Set-Filter — ganz unten, volle Breite, mit Symbol + Kürzel.
                Suchmodus: nur Sets mit mindestens einem Treffer.
                Browse: alle Sets (server-seitiger setId-Filter). */}
            <SearchableSelect
              value={filterSet}
              onChange={setFilterSet}
              options={isBrowseMode ? browseSetOptions : setFilterOptions}
              height="sm"
              fullWidth
              searchPlaceholder="Set suchen …"
              aria-label="Set-Filter"
            />
          </div>
        </div>

        {/* ── Sortierung + Ergebniszahl (immer direkt unter dem Filter-Panel) ── */}
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
          />
        )}

        {/* Griff (Grabber): Filter-Region ein-/ausklappen (ziehen oder tippen) */}
        <Grabber expanded={stage === 0} {...grabberProps} />
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div ref={gridWrapRef} className="flex-1 px-3 py-3">

        {/* Auto-Lockerung: dezenter Hinweis, welche Filter für dieses Ergebnis
            entfernt wurden (weil sie 0 Treffer ergeben hätten). */}
        {!isBrowseMode && relaxedNote && (
          <p className="text-role-label text-muted-foreground text-center mb-2">
            Filter gelockert: {relaxedNote}
          </p>
        )}

        {/* Browse-Modus — zeigt initial den gesamten Katalog, dynamisches Nachladen beim Scrollen */}
        {isBrowseMode && (
          browseLoading && browseCards.length === 0 ? (
            <CardGridSkeleton />
          ) : (
            <>
              {browseCards.length === 0 && !browseLoading && (
                <p className="text-center text-glass-muted text-role-body pt-12">
                  Keine Karten für diesen Filter.
                </p>
              )}
              <CardGrid cards={browseCards} ownedMap={ownedMap} sortKey={browseSort} priceMap={browsePriceMap} {...wishlistGridProps} onCardsChanged={() => getCards().then(setOwnedCards).catch(() => {})} />
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
                <p className="text-role-title text-glass">Keine Karten gefunden</p>
                <p className="text-role-label text-glass-muted">Kein Ergebnis für „{inputValue}"</p>
                {correction && (
                  <p className="text-role-label text-glass-muted">
                    Meintest du{' '}
                    <button
                      type="button"
                      onClick={() => setInputValue(correction)}
                      className="font-semibold underline text-glass"
                    >
                      {correction}
                    </button>
                    ?
                  </p>
                )}
              </div>
            )}
            {!searchLoading && results.length > 0 && displayed.length === 0 && inputValue && (
              <div className="flex flex-col items-center gap-2 pt-16 text-center">
                <SlidersHorizontal size={40} className="text-glass-muted" />
                <p className="text-role-title text-glass">Filter zu streng</p>
                <p className="text-role-label text-glass-muted">
                  {results.length} Karten gefunden, aber alle durch aktive Filter ausgeblendet.
                </p>
              </div>
            )}
            {!searchLoading && displayed.length > 0 && (
              <>
                <CardGrid
                  cards={displayed.slice(0, searchVisibleCount)}
                  ownedMap={ownedMap}
                  sortKey={searchSort}
                  priceMap={searchPriceMap}
                  {...wishlistGridProps}
                  onCardsChanged={() => getCards().then(setOwnedCards).catch(() => {})}
                  setsMeta={setsMetaMap}
                  showSetBadge={resultsSpanMultipleSets}
                />
                <div ref={searchSentinelRef} className="h-1" />
              </>
            )}
          </>
        )}
      </div>

      <ScrollToTopButton />
      <LegendButton symbols={['wishlist-heart', 'unreviewed', 'count', 'foreign-lang', 'pending']} />

    </div>
  );
}

export default function CollectionPage() {
  return <Suspense><CollectionContent /></Suspense>;
}
