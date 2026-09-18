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
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ScrollToTopButton } from '@/components/ui/ScrollToTopButton';
import { LegendButton } from '@/components/ui/LegendButton';
import { SpeciesGrid } from '@/components/collection/SpeciesGrid';
import { IllustratorResults } from '@/components/collection/IllustratorResults';
import SPECIES_JSON from '@/lib/pokemon-species-de.json';

const SPECIES_LIST = SPECIES_JSON as { dex: number; name: string }[];
import { getCards } from '@/lib/firestore/cards';
import type { FilterCounts, CatalogCard } from '@/lib/firestore/catalog';
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
import { searchViaAlgolia } from '@/lib/search/algolia-search';
import { isAlgoliaConfigured } from '@/lib/search/algolia';
import { recordAlgoliaSearch, getAlgoliaUsage } from '@/lib/firestore/search-usage';
import { getSearchMode, shouldUseAlgolia } from '@/lib/search/search-mode';
import { getAlgoliaFacetCounts, type AlgoliaFacetCounts } from '@/lib/search/algolia-facets';
import { getRegionStats } from '@/lib/firestore/region-stats';
import { correctQuery } from '@/lib/search/suggest-index';
import { useSuggestIndex } from '@/lib/search/use-suggest-index';
import { getEvolutionFamilyDexNumbers } from '@/lib/pokeapi';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { applyFacetFilters, type FacetState, type FacetDim } from '@/lib/search/facet-filter';
import { SPECIAL_MECHANIC_KEYS, rarityMatchValues, rarityLabelOf } from '@/lib/card-constants';
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

// Suche/Filterung startet erst ab dieser Eingabelänge — darunter bleibt die
// Ansicht im Browse-Modus (kein Fetch, keine „0 Treffer"-Anzeige bei 1–2 Zeichen).
// Gleich der Autosuggest-Schwelle (suggest-index.ts: < 3 → keine Vorschläge).
const MIN_SEARCH_CHARS = 3;

// Eine echte Kartensuche liegt vor, wenn die Eingabe lang genug ist ODER eine
// explizite Dex-Suche `#<Nr>` ist (z.B. „#6" von der Pokémon-Detailseite) —
// die muss unabhängig von der Länge immer suchen.
const hasSearchQuery = (q: string) => {
  const t = q.trim();
  return t.length >= MIN_SEARCH_CHARS || /^#\d+$/.test(t);
};

// Limits sind reine Kosten-/Sicherheitsbremsen gegen einen extrem generischen
// Suchbegriff (z.B. 1 Buchstabe), der sonst den ganzen Katalog laden würde —
// keine Notwendigkeit für die Korrektheit der Suche selbst.
// Direkt angezeigte Treffer (Raster blendet ohnehin nur häppchenweise ein,
// SEARCH_REVEAL_CHUNK) — hoch genug, dass auch generische Kurz-Präfixe wie
// "Cha" (mehrere Pokémon-Familien über viele Sets) nicht abgeschnitten werden.
const SEARCH_DISPLAY_LIMIT = 400;
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
  { value: 'name',    label: 'Name'        },
  { value: 'hp',      label: 'KP'          },
  { value: 'pokedex', label: 'Pokédex-Nr.' },
  { value: 'price',   label: 'Preis'       },
];

const SEARCH_SORT_OPTIONS: { value: SearchSortKey; label: string }[] = [
  { value: 'number',  label: 'Nummer'      },
  { value: 'name',    label: 'Name'        },
  { value: 'pokedex', label: 'Pokédex-Nr.' },
  { value: 'hp',      label: 'KP'          },
  { value: 'price',   label: 'Preis'       },
];

// Pokémon-Scope: nur Name / Pokédex-Nummer.
const POKEMON_SORT_OPTIONS: { value: 'name' | 'dex'; label: string }[] = [
  { value: 'dex',  label: 'Pokédex-Nr.' },
  { value: 'name', label: 'Name'        },
];

// Pokémon-Regionen (deutsch, aus der Generation abgeleitet — siehe
// GENERATION_REGIONS in lib/pokeapi.ts). Reihenfolge = Generationen.
const REGIONS = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Einall', 'Kalos', 'Alola', 'Galar', 'Paldea'];

function fmt(n: number) { return n.toLocaleString('de'); }

function CollectionContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const initialQ     = searchParams.get('q') ?? '';
  // Deep-Link aus dem Kartendetail: ?region=Galar → Stöbern mit Regionsfilter.
  // Synchron beim ersten Render übernommen (kein Effect-Race mit dem q-Sync,
  // der die URL sonst vor dem Lesen auf /collection zurücksetzen könnte).
  const initialRegion = searchParams.get('region') ?? '';

  // Rückkehr von einer Pokémon-Detailseite (in sessionStorage gesichert): Tab,
  // Suchbegriff, Sortierung und Scroll. SYNCHRON beim ersten Render gelesen, damit
  // die Seite nicht erst kurz im Karten-Tab (Default) aufblitzt und dann umspringt.
  const returnState = useMemo<{
    scope?: 'cards' | 'pokemon' | 'illustrator'; query?: string;
    sort?: 'name' | 'dex'; dir?: 'asc' | 'desc'; scrollY?: number;
  } | null>(() => {
    if (typeof window === 'undefined') return null;
    try { const s = sessionStorage.getItem('collectionReturn'); return s ? JSON.parse(s) : null; } catch { return null; }
  }, []);

  // ── Geteilter Filter-State ─────────────────────────────────────
  const [activeTypes,      setActiveTypes]      = useState<Set<TcgType>>(new Set());
  const [activeSupertype,  setActiveSupertype]  = useState<Supertype | 'all'>('all');
  const [ownedFilter,      setOwnedFilter]      = useState<OwnedFilter>('all');
  const [activeRarity,     setActiveRarity]     = useState<string | null>(null);
  const [activeRegion,     setActiveRegion]     = useState(REGIONS.includes(initialRegion) ? initialRegion : '');
  // Katalog-weite Statistik je Region (Karten + Arten) für den Stöber-Modus —
  // aus meta/region_stats (Firestore kann „distinct" nicht zählen).
  const [regionStats,      setRegionStats]      = useState<Record<string, { cards: number; species: number }>>({});
  // Globaler Algolia-Monatszähler (für das Budget in „Auto"). Ref = in doSearch
  // ohne Neuaufbau lesbar; State nur, damit ein Reload den Serverstand übernimmt.
  const [, setAlgoliaUsage] = useState(0);
  const algoliaUsageRef = useRef(0);
  // Kreuzreaktive Facetten-Zähler via Algolia (Stöber-Modus) — höchste Priorität
  // vor den client-/server-seitigen Zählern; null = nicht verfügbar → Fallback.
  const [algoliaFacets, setAlgoliaFacets] = useState<AlgoliaFacetCounts | null>(null);
  const algoliaFacetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeEvolutions, setActiveEvolutions] = useState<Set<string>>(new Set());
  const [activeSpecialMechanics, setActiveSpecialMechanics] = useState<Set<string>>(new Set());
  const [evoLineActive,    setEvoLineActive]    = useState(false);
  const [allSets,          setAllSets]          = useState<TcgSet[]>([]);
  const baseResultsRef = useRef<CardInfo[]>([]); // Suchergebnisse vor Evo-Line-Erweiterung

  // ── Browse-spezifisch ─────────────────────────────────────────
  const [browseSort,    setBrowseSort]    = useState<BrowseSortKey>('name');
  const [browseSortDir, setBrowseSortDir] = useState<'asc' | 'desc'>('asc');

  // ── Suche ─────────────────────────────────────────────────────
  const [inputValue,    setInputValue]    = useState(returnState?.query ?? initialQ);
  // Geteilter Autosuggest-/Fuzzy-Index — nur noch für die „Meintest du …?"-
  // Korrektur unten; das Autosuggest-Panel selbst steckt in `CardSearchField`.
  const suggestIndex = useSuggestIndex();
  const [relaxedNote,   setRelaxedNote]   = useState<string | null>(null);
  const [results,       setResults]       = useState<CardInfo[]>([]);
  // Wahre Gesamttrefferzahl aus Algolia, falls die materialisierte Menge am
  // Sicherheits-Deckel (ALGOLIA_MAX_HITS) abgeschnitten wurde. null = nicht
  // gedeckelt (dann ist results bereits vollständig und displayed.length exakt).
  const [searchTotalHint, setSearchTotalHint] = useState<number | null>(null);
  const [ownedCards,    setOwnedCards]    = useState<CardDoc[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSort,    setSearchSort]    = useState<SearchSortKey>('number');
  const [searchSortDir, setSearchSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterSet,     setFilterSet]     = useState('');
  const [sets,          setSets]          = useState<{ id: string; name: string; count: number }[]>([]);
  const [catalogCount,  setCatalogCount]  = useState(0);
  // -1 = „noch nicht geladen" (unterscheidet vom echten Leer-Katalog 0). Wichtig
  // für den 0-Guard in doSearch: eine Erst-/Deep-Link-Suche (?q=…) lief sonst
  // gegen den noch nicht geladenen Count (0) und lieferte fälschlich 0 Treffer.
  const catalogCountRef = useRef(-1);
  // Anzahl Karten je (inhärentem) Sortierfeld — Pokédex-Nr./KP blenden Karten
  // ohne das Feld aus (Trainer/Energie). Für den Header-Zähler. (Preis lädt
  // zweiphasig alle Karten → braucht hier keinen Sonder-Zähler.)
  const [sortCounts,    setSortCounts]    = useState<{ pokedex: number; hp: number }>({ pokedex: 0, hp: 0 });
  const [searchVisibleCount, setSearchVisibleCount] = useState(20);
  const searchSentinelRef = useRef<HTMLDivElement>(null);

  // ── Such-Scope (mobile-first Umbau): Karten | Pokémon | Illustrator ───────
  const [scope, setScope] = useState<'cards' | 'pokemon' | 'illustrator'>(returnState?.scope ?? 'cards');
  const [filterOpen, setFilterOpen] = useState(false);
  // Pro Tab eigener Suchbegriff (+ nur Karten: eigene Filter). Beim Zurückwechseln
  // wird der jeweilige Stand wiederhergestellt statt zurückgesetzt.
  const queryStash    = useRef<Record<'cards' | 'pokemon' | 'illustrator', string>>({ cards: initialQ, pokemon: '', illustrator: '' });
  const cardFilterStash = useRef<null | {
    activeSupertype: Supertype | 'all'; activeTypes: Set<TcgType>; activeEvolutions: Set<string>;
    activeSpecialMechanics: Set<string>; activeRarity: string | null; activeRegion: string;
    filterSet: string; ownedFilter: OwnedFilter;
  }>(null);
  const [pokemonSort, setPokemonSort] = useState<'name' | 'dex'>(returnState?.sort ?? 'dex');
  const [pokemonSortDir, setPokemonSortDir] = useState<'asc' | 'desc'>(returnState?.dir ?? 'asc');
  // Trefferzahl des Illustrator-Scopes (von IllustratorResults gemeldet) für die
  // Anzeige rechts neben dem Suchfeld.
  const [illustratorCount, setIllustratorCount] = useState<number | null>(null);

  // ── UI-State ──────────────────────────────────────────────────
  const [filterCounts,     setFilterCounts]     = useState<FilterCounts | null>(null);
  const [browseTotal,      setBrowseTotal]      = useState<number | null>(null);
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
    // Region-Statistik (Katalog-weit: Karten + Arten) einmalig — für den Stöber-
    // Modus. Im Such-Modus wird beides kreuzreaktiv aus den Treffern berechnet.
    getRegionStats().then(s => { if (s) setRegionStats(s); }).catch(() => {});
    // Globalen Algolia-Zählerstand laden (für die Budget-Entscheidung in „Auto").
    getAlgoliaUsage().then(n => { algoliaUsageRef.current = n; setAlgoliaUsage(n); }).catch(() => {});
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
      // Leere Logo-Spalte, damit auch „Alle Sets" bündig zu den Set-Namen beginnt.
      { value: '', label: 'Alle Sets', icon: <span className="w-12 h-4 shrink-0" /> },
      ...[...sets]
        // Sortierung: Trefferzahl ABSTEIGEND (vollste Sets oben), bei Gleichstand
        // Name alphabetisch AUFSTEIGEND.
        .sort((a, b) => {
          if (a.count !== b.count) return b.count - a.count;
          const la = setsMetaMap.get(a.id)?.nameDe ?? a.name;
          const lb = setsMetaMap.get(b.id)?.nameDe ?? b.name;
          return la.localeCompare(lb, 'de');
        })
        .map(s => {
          const meta = setsMetaMap.get(s.id);
          return {
            value: s.id,
            label: meta?.nameDe ?? s.name,
            keywords: [meta?.name, s.name, meta?.ptcgoCode].filter(Boolean).join(' '),
            // Feste Logo-Spalte (immer gleiche Breite) → alle Set-Namen beginnen
            // an derselben Stelle (kein „Floaten" durch unterschiedlich breite Logos).
            icon: (
              <span className="w-12 h-4 flex items-center shrink-0">
                {meta?.logoUrl && <img src={meta.logoUrl} alt="" className="max-h-4 max-w-full object-contain" />}
              </span>
            ),
            // Rechts: Kürzel als Pill ODER (falls kein Kürzel) das Set-Symbol —
            // nicht beides. Dann mit Abstand rechtsbündig die Trefferzahl (feste
            // Zahlenbreite → über alle Zeilen ausgerichtet).
            trailing: (
              <>
                {meta?.ptcgoCode ? (
                  <span
                    className="px-1.5 py-0.5 rounded-full text-[11px] font-semibold leading-none text-glass-muted shrink-0"
                    style={{ background: 'var(--muted)' }}
                  >
                    {meta.ptcgoCode}
                  </span>
                ) : meta?.symbolUrl ? (
                  <img src={meta.symbolUrl} alt="" className="w-3.5 h-3.5 object-contain shrink-0" />
                ) : null}
                <span className="ml-2 inline-block min-w-[2.75ch] text-right tabular-nums text-glass font-medium">
                  {s.count.toLocaleString('de')}
                </span>
              </>
            ),
          };
        }),
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
  const hasActiveFilterForCount = !!(filterSet || activeTypes.size || activeSupertype !== 'all' || activeEvolutions.size || activeSpecialMechanics.size || ownedFilter !== 'all' || activeRarity || activeRegion);
  useEffect(() => {
    if (!hasActiveFilterForCount) { setBrowseTotal(null); return; }
    // "Vorhanden" wird per ID komplett geladen (kein Server-Count nötig) → null,
    // das Label nutzt dann die exakte geladene Anzahl (browseCards.length).
    if (ownedFilter === 'owned') { setBrowseTotal(null); return; }
    // Der Server-Count kann immer nur EINE Filterdimension zählen (kein Composite-
    // Index). Sind mehrere Filter gleichzeitig aktiv, würde die Prioritäts-Auswahl
    // (wie makeBrowseFilter) nur nach EINEM zählen und die übrigen ignorieren
    // (z.B. Rarity + Kartenart „Trainer" → zählte alle Rarity-Treffer). Dann keine
    // falsche Gesamtzahl anzeigen, sondern auf die exakt geladene, client-gefilterte
    // Menge (browseCards.length) zurückfallen — bei kombinierten (selektiven)
    // Filtern ist die Treffermenge ohnehin vollständig geladen (LOAD_ALL_CAP).
    const activeDims = [
      !!filterSet, !!activeRegion, activeTypes.size > 0, !!activeRarity,
      activeSpecialMechanics.size > 0, activeEvolutions.size > 0,
      activeSupertype !== 'all', ownedFilter !== 'all',
    ].filter(Boolean).length;
    if (activeDims >= 2) { setBrowseTotal(null); return; }
    // Einzelner aktiver Filter → server-seitig exakt zählbar (setId > region > type
    // > rarity > specialMechanics > evolutionStage > supertype).
    const browseFilter = filterSet
      ? { setId: filterSet }
      : activeRegion
        ? { region: activeRegion }
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
  }, [filterSet, activeTypesKey, activeSupertype, activeEvolutionsKey, activeRarity, activeRegion, activeSpecialMechanics, ownedFilter, hasActiveFilterForCount]);

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
    region:          activeRegion || undefined,
    ownedFilter,
    ownedIds,
  }), [filterSet, activeSupertype, activeTypesKey, activeEvolutionsKey, activeSpecialMechanicsKey, activeRarity, activeRegion, ownedFilter, ownedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    cards: browseCards, loading: browseLoading,
    loadingMore, hasMore, loadMore, facetBase,
  } = useCardBrowser(browseSort, browserFilter, browseSortDir === 'desc');

  // ── Kreuzreaktive Facetten-Zähler via Algolia (nur Stöbern) ───────────────
  // Löst den Firestore-Nachteil (kein Composite-Index für kombinierte Filter):
  // Algolia rechnet die Zähler nativ über den ganzen Index — auch für sehr breite
  // Filter (> LOAD_ALL_CAP), die der client-seitige `facetBase`-Pfad nicht abdeckt.
  // Nur wenn: Stöber-Modus, Algolia konfiguriert + im Budget, KEIN Owned-Filter
  // (Nutzerdaten, nicht im Index). Sonst null → bestehender Zähler-Pfad greift.
  useEffect(() => {
    const browseNow = !hasSearchQuery(inputValue); // isBrowseMode ist erst weiter unten definiert
    const usable = browseNow && ownedFilter === 'all' && isAlgoliaConfigured()
      && shouldUseAlgolia(getSearchMode(), algoliaUsageRef.current);
    if (!usable) { setAlgoliaFacets(null); return; }
    if (algoliaFacetTimerRef.current) clearTimeout(algoliaFacetTimerRef.current);
    let cancelled = false;
    algoliaFacetTimerRef.current = setTimeout(() => {
      getAlgoliaFacetCounts({
        setId:            filterSet || undefined,
        supertype:        activeSupertype !== 'all' ? activeSupertype : undefined,
        types:            activeTypes.size ? [...activeTypes] : undefined,
        rarityGroup:      activeRarity ?? undefined,
        region:           activeRegion || undefined,
        specialMechanics: activeSpecialMechanics.size ? [...activeSpecialMechanics] : undefined,
      }, (n) => {
        for (let i = 0; i < n; i++) void recordAlgoliaSearch();
        algoliaUsageRef.current += n; setAlgoliaUsage(algoliaUsageRef.current);
      }).then(res => { if (!cancelled) setAlgoliaFacets(res); })
        .catch(() => { if (!cancelled) setAlgoliaFacets(null); });
    }, 250);
    return () => { cancelled = true; if (algoliaFacetTimerRef.current) clearTimeout(algoliaFacetTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, ownedFilter, filterSet, activeSupertype, activeTypesKey, activeRarity, activeRegion, activeSpecialMechanicsKey]);

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
      // Katalog nachweislich leer (vor dem ersten Sync) → keine Treffer. NUR bei
      // exakt 0 (geladen+leer), nicht bei -1 (noch nicht geladen), sonst würde
      // eine frühe Deep-Link-Suche fälschlich leer zurückkommen.
      if (catalogCountRef.current === 0) { setResults([]); setSets([]); return; }

      // Such-Backend wählen: Modus (Auto/Algolia/Firestore, pro Gerät) + globales
      // Monats-Budget. „Auto" nutzt Algolia bis zum Budget, danach Firestore.
      // Fällt bei Algolia-Fehler ebenfalls auf die bestehende Suche zurück.
      let cards: CatalogCard[]; let sortHint: 'pokedex' | undefined;
      const useAlgolia = isAlgoliaConfigured() && shouldUseAlgolia(getSearchMode(), algoliaUsageRef.current);
      // Region NICHT an Algolia geben: sie wird client-seitig über den Facetten-
      // Filter angewandt (wie Rarity), damit das Auto-Lockern bei 0 Treffern
      // greift (server-seitig gefiltert käme der Fetch leer zurück → kein Relax).
      // Algolia holt die KOMPLETTE Treffermenge (mehrseitig, gedeckelt in
      // searchViaAlgolia) — kein 400er-Limit mehr. So sind Facetten-Zähler,
      // Sortierung und Gesamtzahl clientseitig über ALLE Treffer exakt.
      const algolia = useAlgolia ? await searchViaAlgolia(q) : null;
      if (algolia) {
        // Genutzte Algolia-Suche(n) global zählen (Budget/Anzeige) + lokal
        // hochzählen. Eine breite Suche kann mehrere Seiten-Requests kosten.
        const reqs = algolia.requests ?? 1;
        for (let i = 0; i < reqs; i++) void recordAlgoliaSearch();
        algoliaUsageRef.current += reqs; setAlgoliaUsage(algoliaUsageRef.current);
        cards = algolia.cards; sortHint = undefined;
        // Nur setzen, wenn tatsächlich am Deckel abgeschnitten (nbHits > geladen).
        setSearchTotalHint((algolia.nbHits ?? cards.length) > cards.length ? (algolia.nbHits ?? null) : null);
      } else {
        // Gemeinsame Server-Such-Pipeline (Dex → Name → Mehrwort Name∪Illustrator
        // → Illustrator-Fallback) — bewusst OHNE `setId`: wir holen ALLE Treffer,
        // damit das Set-Dropdown genau die Sets zeigt, in denen der Suchbegriff
        // vorkommt. Die Eingrenzung auf das gewählte Set passiert danach
        // client-seitig (kein zweiter Query, kein Composite-Index nötig).
        ({ cards, sortHint } = await searchCatalogCards(q, {
          displayLimit: SEARCH_DISPLAY_LIMIT,
          candidateLimit: SEARCH_CANDIDATE_LIMIT,
          minComboLen: MIN_COMBO_LEN,
          // Dex-Brücke: über die Pokédex-Nr. der Namens-Treffer die GANZE Art
          // nachziehen — „Glurak" findet so auch „Mega-Glurak"/„Glurak ex" usw.
          // (nur bei fokussierter Suche ≤ 4 Arten aktiv, s. searchCatalogCards).
          bridgeByDex: true,
        }));
        setSearchTotalHint(null); // Firestore-Pfad liefert bereits die volle Menge
      }

      if (cards.length === 0) { setResults([]); setSets([]); setSearchTotalHint(null); return; }

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
    // Nur im Karten-Scope die Karten-Such-Pipeline nutzen; Pokémon/Illustrator
    // filtern client-seitig ihre eigene Liste (kein Backend-Query).
    const enoughChars = scope === 'cards' && hasSearchQuery(inputValue);
    if (enoughChars) setSearchLoading(true);
    debounceRef.current = setTimeout(() => {
      // Unter der Schwelle NICHT suchen — leere Suche räumt Treffer weg, die
      // Ansicht fällt in den Browse-Modus zurück.
      doSearch(enoughChars ? inputValue : '');
      router.replace(
        inputValue ? `/collection?q=${encodeURIComponent(inputValue)}` : '/collection',
        { scroll: false },
      );
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputValue, scope, doSearch, router]);

  // `q` aus der URL in die Eingabe übernehmen, wenn er sich EXTERN ändert (z.B.
  // Klick auf den Illustrator im Kartendetail navigiert auf /collection?q=…,
  // während wir schon hier sind). Der Debounce oben hält sonst nur EINE Richtung
  // synchron (Eingabe → URL). setInputValue(prev=>…) verhindert eine Rück-Schleife.
  // Ein LEERES `q` wird NICHT übernommen: sonst löscht das leere `q` der blanken
  // /collection-URL beim Zurückkehren den wiederhergestellten Suchbegriff (und der
  // Effekt bleibt idempotent, auch unter StrictMode-Doppelausführung).
  useEffect(() => {
    const q = searchParams.get('q') ?? '';
    if (!q) return;
    setInputValue(prev => (prev === q ? prev : q));
  }, [searchParams]);

  // Rückkehr von einer Pokémon-Detailseite: Tab/Suchbegriff/Sortierung kommen
  // bereits aus den useState-Initialisierern (kein Flash). Hier nur noch die
  // Scrollposition wiederherstellen, den Stash nachziehen und den Marker löschen.
  useEffect(() => {
    if (!returnState) return;
    if (returnState.scope && typeof returnState.query === 'string') {
      queryStash.current[returnState.scope] = returnState.query;
    }
    if (typeof returnState.scrollY === 'number') {
      const y = returnState.scrollY;
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
    }
    try { sessionStorage.removeItem('collectionReturn'); } catch {}
  }, [returnState]);

  // Deep-Link ?region=… auch übernehmen, wenn wir schon auf /collection sind
  // (Kartendetail als Overlay → Push auf dieselbe Route re-mountet nicht). Nur
  // setzen, nie leeren: fehlt der Param, bleibt eine ggf. manuell gewählte Region.
  useEffect(() => {
    const r = searchParams.get('region');
    if (r && REGIONS.includes(r)) setActiveRegion(r);
  }, [searchParams]);

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
    ownedFilter, activeSupertype, activeTypes, activeEvolutions, activeSpecialMechanics, activeRarity, activeRegion, ownedIds,
  }), [ownedFilter, activeSupertype, activeTypesKey, activeEvolutionsKey, activeSpecialMechanicsKey, activeRarity, activeRegion, ownedIds]); // eslint-disable-line react-hooks/exhaustive-deps

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
      { active: !!local.activeRegion,               label: 'Region',       relax: () => { local.activeRegion = ''; },               drop: () => setActiveRegion('') },
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

  const isBrowseMode = !hasSearchQuery(inputValue);
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
    // Suche: displayed.length ist die (gefilterte) Gesamtzahl — results hält die
    // komplette Algolia-Menge. Nur wenn am Deckel abgeschnitten UND kein Facetten-
    // Filter aktiv ist, die wahre Gesamtzahl mit „+" zeigen (sehr breite Suchen).
    : searchTotalHint != null && displayed.length === results.length
      ? `${fmt(searchTotalHint)}+`
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

  // Server-primäre Filterdimension (gleiche Priorität wie makeBrowseFilter im
  // Browse-Hook). Nur für Dimensionen, die NICHT server-primär sind, lässt sich
  // aus `facetBase` ein sauberer kreuzreaktiver Zähler ableiten (die server-
  // primäre Dimension hat die Basis bereits eingeengt → Zähler wären degeneriert).
  const serverPrimaryDim = filterSet ? 'setId'
    : activeRegion ? 'region'
    : activeTypes.size ? 'types'
    : activeRarity ? 'rarity'
    : activeSpecialMechanics.size ? 'special'
    : activeEvolutions.size === 1 ? 'evolution'
    : activeSupertype !== 'all' ? 'supertype'
    : 'none';

  // Bei „Vorhanden" lädt useCardBrowser die Sammlung per ID (facetBase = ganze
  // Owned-Menge, NICHT nach einer Dimension eingeengt) → die kreuzreaktiven
  // `browseFacetCounts` sind dann für ALLE Dimensionen gültig, auch für die
  // aktuell gewählte. Sonst fiele z.B. die Rarity fälschlich auf die GLOBALEN
  // `filterCounts` zurück (zeigte 8 statt der 1 owned-Karte).
  const facetPrimaryDim = ownedFilter === 'owned' ? 'none' : serverPrimaryDim;

  // Kreuzreaktive Kartenart-/Typ-Zähler im Stöber-Modus: „wie viele Trainer/
  // Pokémon/… gäbe es INNERHALB der aktuell aktiven Auswahl (z.B. dieser Rarity)".
  // Basis = server-gefilterte, vollständig geladene Treffermenge VOR den Client-
  // Filtern (`facetBase`). Leer (paginiert/kein selektiver Filter) → null, dann
  // greift der server-seitige `filterCounts`-Fallback. Client-seitig, weil es
  // server-seitig keine Composite-Indizes (z.B. supertype+rarity) dafür gibt.
  const browseFacetCounts = useMemo(() => {
    if (!isBrowseMode || facetBase.length === 0) return null;
    const rarityVariants = activeRarity ? new Set(rarityMatchValues(activeRarity)) : null;
    const special = new Set<string>(SPECIAL_MECHANIC_KEYS as readonly string[]);
    // Erfüllt die Karte ALLE aktiven Client-Filter außer `exclude` (die Dimension,
    // deren Zähler gerade berechnet wird — sie darf sich nicht selbst einschränken)?
    const passes = (c: CatalogCard, exclude: string) => {
      if (exclude !== 'setId'  && filterSet && c.setId !== filterSet) return false;
      if (exclude !== 'region' && activeRegion && c.region !== activeRegion) return false;
      if (exclude !== 'types'  && activeTypes.size && !c.types?.some(t => (activeTypes as Set<string>).has(t))) return false;
      if (exclude !== 'supertype' && activeSupertype !== 'all' && c.supertype?.toLowerCase() !== activeSupertype.toLowerCase()) return false;
      if (exclude !== 'rarity' && rarityVariants && !(c.rarity && rarityVariants.has(c.rarity))) return false;
      if (exclude !== 'special' && activeSpecialMechanics.size && !c.subtypes?.some(s => activeSpecialMechanics.has(s))) return false;
      if (activeEvolutions.size && !c.subtypes?.some(s => activeEvolutions.has(s))) return false;
      if (ownedFilter === 'owned'   && !ownedIds.has(c.id)) return false;
      if (ownedFilter === 'missing' &&  ownedIds.has(c.id)) return false;
      return true;
    };
    const supertypes: Record<string, number> = { 'Pokémon': 0, Trainer: 0, Energy: 0 };
    const types: Record<string, number> = Object.fromEntries(TCG_TYPES.map(t => [t, 0]));
    const rarities: Record<string, number> = {};
    const sets: Record<string, number> = {};
    const regionAgg: Record<string, { cards: number; species: Set<number> }> =
      Object.fromEntries(REGIONS.map(r => [r, { cards: 0, species: new Set<number>() }]));
    let specialForms = 0;
    for (const c of facetBase) {
      if (c.supertype && c.supertype in supertypes && passes(c, 'supertype')) supertypes[c.supertype]++;
      if (passes(c, 'types')) for (const t of c.types ?? []) if (t in types) types[t]++;
      if (passes(c, 'rarity')) { const lbl = rarityLabelOf(c.rarity); rarities[lbl] = (rarities[lbl] ?? 0) + 1; }
      if (passes(c, 'setId') && c.setId) sets[c.setId] = (sets[c.setId] ?? 0) + 1;
      if (passes(c, 'region') && c.region && regionAgg[c.region]) {
        regionAgg[c.region].cards++;
        if (typeof c.nationalDexNumber === 'number') regionAgg[c.region].species.add(c.nationalDexNumber);
      }
      if (passes(c, 'special') && c.subtypes?.some(s => special.has(s))) specialForms++;
    }
    const regions: Record<string, { cards: number; species: number }> =
      Object.fromEntries(Object.entries(regionAgg).map(([r, v]) => [r, { cards: v.cards, species: v.species.size }]));
    return { supertypes, types, rarities, regions, specialForms, sets };
  }, [isBrowseMode, facetBase, filterSet, activeRegion, activeTypesKey, activeSupertype, activeRarity, activeSpecialMechanicsKey, activeEvolutionsKey, ownedFilter, ownedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set-Dropdown mit kreuzreaktiven Zählern: nur Sets einblenden, die in der
  // aktiven Auswahl Treffer haben (0-Sets weg → keine Sackgasse) + Anzahl rechts.
  // Das aktive Set bleibt IMMER sichtbar (zum Abwählen). Quelle: Algolia, sonst
  // client-seitig aus `facetBase`; ohne beide (kein Filter/paginiert) alle Sets.
  const browseSetOptionsShown = useMemo(() => {
    const counts = algoliaFacets?.sets ?? browseFacetCounts?.sets ?? null;
    if (!counts) return browseSetOptions;
    return browseSetOptions
      .filter(o => o.value === '' || o.value === filterSet || (counts[o.value] ?? 0) > 0)
      .map(o => {
        if (o.value === '') return o;
        // Rechts: Set-Kürzel als Pill, danach die Anzahl ganz am Ende
        // (gleiche Optik wie im Such-Modus, s. setFilterOptions).
        const code = (o as { hint?: string }).hint;
        return {
          ...o,
          hint: undefined,
          trailing: (
            <>
              {code && (
                <span
                  className="px-1.5 py-0.5 rounded-full text-[11px] font-semibold leading-none text-glass-muted shrink-0"
                  style={{ background: 'var(--muted)' }}
                >
                  {code}
                </span>
              )}
              <span className="ml-2 inline-block min-w-[2.75ch] text-right tabular-nums text-glass font-medium">
                {(counts[o.value] ?? 0).toLocaleString('de')}
              </span>
            </>
          ),
        };
      });
  }, [browseSetOptions, algoliaFacets, browseFacetCounts, filterSet]);

  // Disabled-Logik für Type-Pills
  const typeCountInContext = useMemo(() => {
    if (isBrowseMode) {
      // Algolia (kreuzreaktiv, deckt auch Breitfilter ab) hat Vorrang; 0-Werte
      // fehlen in der Algolia-Antwort → auf 0 normalisieren (→ deaktiviert).
      if (algoliaFacets) return Object.fromEntries(TCG_TYPES.map(t => [t, algoliaFacets.types[t] ?? 0]));
      if (browseFacetCounts && facetPrimaryDim !== 'types') return browseFacetCounts.types;
      return filterCounts?.types ?? null;
    }
    const base = applyFacetFilters(results, facetState, 'types');
    return Object.fromEntries(TCG_TYPES.map(t => [t, base.filter(c => c.types?.includes(t)).length]));
  }, [isBrowseMode, algoliaFacets, browseFacetCounts, serverPrimaryDim, filterCounts, results, facetState]);

  // Region-Statistik im Kontext (Karten + Arten): Browse = katalogweit
  // (meta/region_stats), Suche = kreuzreaktiv aus den Treffern (alle anderen
  // aktiven Filter angewandt, ohne Region selbst; Arten = distinct Pokédex-Nr.).
  const regionStatInContext = useMemo<Record<string, { cards: number; species: number }> | null>(() => {
    if (isBrowseMode) {
      // Algolia liefert Karten-Zähler je Region; Arten (distinct Dex-Nr.) sind kein
      // Facet → aus den globalen regionStats als Näherung übernommen.
      if (algoliaFacets) return Object.fromEntries(REGIONS.map(r =>
        [r, { cards: algoliaFacets.regions[r] ?? 0, species: regionStats[r]?.species ?? 0 }]));
      if (browseFacetCounts && facetPrimaryDim !== 'region') return browseFacetCounts.regions;
      return Object.keys(regionStats).length ? regionStats : null;
    }
    const base = applyFacetFilters(results, facetState, 'region');
    return Object.fromEntries(REGIONS.map(r => {
      const inR = base.filter(c => c.region === r);
      const species = new Set(inR.map(c => c.nationalDexNumber).filter((n): n is number => typeof n === 'number')).size;
      return [r, { cards: inR.length, species }];
    }));
  }, [isBrowseMode, algoliaFacets, browseFacetCounts, serverPrimaryDim, regionStats, results, facetState]);

  // „Sonderformen" fasst alle Spezial-Mechaniken (GX/ex/V/VMAX/VSTAR/V-Union …)
  // zu EINEM Filter zusammen — aktiv = irgendeine Mechanik gewählt.
  const specialFormsActive = activeSpecialMechanics.size > 0;
  const specialFormsCount = useMemo(() => {
    if (isBrowseMode) {
      // Kreuzreaktiv aus der aktiven Auswahl, sofern verfügbar; sonst globaler
      // Katalog-Count (sonst zählte nur die aktuell geladene Seite → fälschlich 0).
      if (algoliaFacets) return algoliaFacets.specialForms;
      if (browseFacetCounts && facetPrimaryDim !== 'special') return browseFacetCounts.specialForms;
      return filterCounts?.specialForms;
    }
    const base = applyFacetFilters(results, facetState, 'specialMechanics');
    if (base.length === 0) return undefined;
    const keys = new Set<string>(SPECIAL_MECHANIC_KEYS as readonly string[]);
    return base.filter(c => c.subtypes?.some(s => keys.has(s))).length;
  }, [isBrowseMode, algoliaFacets, browseFacetCounts, serverPrimaryDim, filterCounts, browseCards, results, facetState]);

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
      // Kreuzreaktive Zähler (innerhalb der aktiven Auswahl, z.B. dieser Rarity),
      // sofern die Kartenart nicht selbst der server-primäre Filter ist; sonst
      // server-seitige Gesamt-Zähler (Fallback).
      const sc = algoliaFacets ? algoliaFacets.supertype
        : (browseFacetCounts && facetPrimaryDim !== 'supertype')
          ? browseFacetCounts.supertypes
          : filterCounts?.supertypes;
      return [
        { value: 'all',     label: 'Alle',    count: sc ? Object.values(sc).reduce((a, b) => a + b, 0) : undefined },
        { value: 'Pokémon', label: 'Pokémon', count: sc?.['Pokémon'] },
        { value: 'Trainer', label: 'Trainer', count: sc?.['Trainer'] ?? (sc ? 0 : undefined) },
        { value: 'Energy',  label: 'Energie', count: sc?.['Energy']  ?? (sc ? 0 : undefined) },
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
  }, [isBrowseMode, algoliaFacets, browseFacetCounts, serverPrimaryDim, filterCounts, results, facetState]);

  const showTypePills = activeSupertype === 'all' || activeSupertype === 'Pokémon';
  const showEvolution = showTypePills;

  // Karten für RarityFilterBar (browseModus = geladene Karten; Suche = kreuzreaktiv,
  // alle Filter außer Rarity selbst)
  const rarityCards  = isBrowseMode ? browseCards : applyFacetFilters(results, facetState, 'rarity');

  // Aktive Filter-Anzahl (für das Badge am Filter-Icon).
  const activeFilterCount =
    (ownedFilter !== 'all' ? 1 : 0) + (activeSupertype !== 'all' ? 1 : 0) +
    (activeTypes.size ? 1 : 0) + (activeRarity ? 1 : 0) + (activeRegion ? 1 : 0) +
    (activeSpecialMechanics.size ? 1 : 0) + (filterSet ? 1 : 0);

  // Scope wechseln: Suchbegriff + Karten-Filter des aktuellen Tabs sichern, den
  // des Ziel-Tabs wiederherstellen — jeder Tab führt seinen eigenen Stand.
  const changeScope = (s: 'cards' | 'pokemon' | 'illustrator') => {
    if (s === scope) return;
    // aktuellen Tab sichern
    queryStash.current[scope] = inputValue;
    if (scope === 'cards') {
      cardFilterStash.current = {
        activeSupertype, activeTypes, activeEvolutions, activeSpecialMechanics,
        activeRarity, activeRegion, filterSet, ownedFilter,
      };
    }
    // Ziel-Tab wiederherstellen
    setInputValue(queryStash.current[s]);
    if (s === 'cards') {
      const f = cardFilterStash.current;
      if (f) {
        setActiveSupertype(f.activeSupertype); setActiveTypes(f.activeTypes); setActiveEvolutions(f.activeEvolutions);
        setActiveSpecialMechanics(f.activeSpecialMechanics); setActiveRarity(f.activeRarity); setActiveRegion(f.activeRegion);
        setFilterSet(f.filterSet); setOwnedFilter(f.ownedFilter);
      }
    } else {
      // Karten-Filter aus dem aktiven State räumen (Grid/Badge sauber); der
      // Snapshot bleibt im Stash und kehrt beim Zurückwechseln zurück.
      setActiveSupertype('all'); setActiveTypes(new Set()); setActiveEvolutions(new Set());
      setActiveSpecialMechanics(new Set()); setActiveRarity(null); setActiveRegion(''); setFilterSet('');
      setOwnedFilter('all'); setFilterOpen(false);
    }
    setScope(s);
  };

  // Pokémon-Scope: gefilterte Anzahl (für die Sortier-/Zähl-Zeile).
  const pokemonCount = useMemo(() => {
    if (scope !== 'pokemon') return 0;
    const q = inputValue.trim().toLowerCase();
    if (!q) return SPECIES_LIST.length;
    const num = q.replace(/^#/, '');
    const numeric = /^\d+$/.test(num);
    return SPECIES_LIST.filter(p => p.name.toLowerCase().includes(q) || (numeric && String(p.dex).includes(num))).length;
  }, [scope, inputValue]);

  const placeholder = scope === 'pokemon' ? 'Pokémon suchen' : scope === 'illustrator' ? 'Illustrator suchen' : 'Name, Illustrator … oder stöbern';

  // Autosuggest im Pokémon-Scope: Speziesnamen ab 3 Zeichen (Präfix vor Teiltreffer),
  // Label = Pokédex-Nr. Klick auf einen Vorschlag filtert das Grid auf den Namen.
  const pokemonSuggest = useCallback((v: string) => {
    const q = v.trim().toLowerCase();
    if (q.length < MIN_SEARCH_CHARS) return [];
    const label = (dex: number) => `#${String(dex).padStart(4, '0')}`;
    const starts: { value: string; label: string }[] = [];
    const contains: { value: string; label: string }[] = [];
    for (const s of SPECIES_LIST) {
      const n = s.name.toLowerCase();
      if (n.startsWith(q)) starts.push({ value: s.name, label: label(s.dex) });
      else if (n.includes(q)) contains.push({ value: s.name, label: label(s.dex) });
      if (starts.length >= 5) break;
    }
    return [...starts, ...contains].slice(0, 5);
  }, []);

  return (
    <div className="flex flex-col min-h-screen">

      {/* ── Sticky Header ──────────────────────────────────────── */}
      <div className="sticky top-[calc(env(safe-area-inset-top,0px)_+_0.5rem)] z-20 mx-3 mt-2 glass rounded-[20px] px-4 pt-3 pb-3 space-y-2">

        {/* Scope-Switch: Karten | Pokémon | Illustrator */}
        <ButtonGroup
          options={[
            { value: 'cards',       label: 'Karten'      },
            { value: 'pokemon',     label: 'Pokémon'     },
            { value: 'illustrator', label: 'Illustrator' },
          ]}
          value={scope}
          onChange={v => changeScope(v as 'cards' | 'pokemon' | 'illustrator')}
        />

        {/* Suchfeld (+ Filter-Icon nur im Karten-Scope) */}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <CardSearchField
              size="lg"
              value={inputValue}
              onChange={setInputValue}
              onClear={clearSearch}
              onSubmit={q => { if (debounceRef.current) clearTimeout(debounceRef.current); doSearch(scope === 'cards' && hasSearchQuery(q) ? q : ''); }}
              placeholder={placeholder}
              inlineComplete={scope === 'cards'}
              enableSuggest={scope === 'cards' || scope === 'pokemon'}
              customSuggest={scope === 'pokemon' ? pokemonSuggest : undefined}
            />
          </div>
          {scope === 'cards' && (
            <div className="relative shrink-0">
              <Button variant="ghost" icon={<SlidersHorizontal size={20} />} onClick={() => setFilterOpen(true)} aria-label="Filter" />
              {activeFilterCount > 0 && (
                <span
                  className="absolute top-0 right-0 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white pointer-events-none"
                  style={{ background: 'var(--pokedex-blue)' }}
                >
                  {activeFilterCount}
                </span>
              )}
            </div>
          )}
          {scope === 'illustrator' && illustratorCount != null && (
            <span className="text-sm font-semibold text-glass tabular-nums shrink-0">
              {illustratorCount.toLocaleString('de')} Illustratoren
            </span>
          )}
        </div>

        {/* Sortierung + Ergebniszahl je Scope (Illustrator: keine, immer Name asc) */}
        {scope === 'cards' && (isBrowseMode ? (
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
        ))}
        {scope === 'pokemon' && (
          <CardSortBar
            options={POKEMON_SORT_OPTIONS}
            sortField={pokemonSort}
            onSortFieldChange={v => setPokemonSort(v as 'name' | 'dex')}
            sortDir={pokemonSortDir}
            onSortDirChange={() => setPokemonSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            resultLabel={`${pokemonCount.toLocaleString('de')} Pokémon`}
          />
        )}
      </div>

      {/* ── Filter-Bottom-Sheet (nur Karten-Scope) ──────────────── */}
      <Sheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title={`Filter${resultCount != null ? ` (${resultCount})` : ''}`}
        dragToClose
        footer={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => { setActiveSupertype('all'); setActiveTypes(new Set()); setActiveEvolutions(new Set()); setActiveSpecialMechanics(new Set()); setActiveRarity(null); setActiveRegion(''); setFilterSet(''); setOwnedFilter('all'); }}
            >
              Zurücksetzen
            </Button>
            <Button variant="primary" className="flex-1" onClick={() => setFilterOpen(false)}>Fertig</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {/* Owned (Alle|Vorhanden|Fehlen) */}
          <ButtonGroup
            options={ownedOptions.map(o => ({ ...o, disabled: o.count === 0 }))}
            value={ownedFilter}
            onChange={v => setOwnedFilter(v as OwnedFilter)}
          />

          {/* Kartenart (Alle|Pokémon|Trainer|Energie) */}
          <CustomSelect
            value={activeSupertype}
            onChange={v => { setActiveSupertype(v as Supertype | 'all'); setActiveTypes(new Set()); setActiveEvolutions(new Set()); }}
            onClear={activeSupertype !== 'all' ? () => { setActiveSupertype('all'); setActiveTypes(new Set()); setActiveEvolutions(new Set()); } : undefined}
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

          {/* Pokémon-Typ (Mehrfach-Auswahl) */}
          {showTypePills && (
            <MultiSelect
              values={[...activeTypes]}
              onChange={vals => setActiveTypes(new Set(vals))}
              options={typeOptions}
              placeholder="Alle Typen"
              aria-label="Pokémon-Typ"
            />
          )}

          {/* Region */}
          {showTypePills && (
            <CustomSelect
              value={activeRegion}
              onChange={v => setActiveRegion(v)}
              onClear={activeRegion ? () => setActiveRegion('') : undefined}
              options={[
                { value: '', label: 'Alle Regionen' },
                ...REGIONS.map(r => {
                  const s = regionStatInContext?.[r];
                  return {
                    value: r,
                    label: r,
                    hint: s ? `${s.cards.toLocaleString('de')} (${s.species})` : undefined,
                    disabled: s?.cards === 0,
                  };
                }),
              ]}
              height="sm"
              fullWidth
              aria-label="Region"
            />
          )}

          {/* Rarity + Sonderformen */}
          <RarityFilterBar
            cards={rarityCards}
            ownedIds={ownedIds}
            activeRarities={activeRarity ? new Set([activeRarity]) : new Set()}
            onToggle={label => setActiveRarity(prev => prev === label ? null : label)}
            rarityCounts={isBrowseMode
              ? (algoliaFacets ? algoliaFacets.rarities
                 : (browseFacetCounts && facetPrimaryDim !== 'rarity') ? browseFacetCounts.rarities
                 : filterCounts?.rarities)
              : undefined}
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

          {/* Evolutionslinie */}
          {showEvolution && !isBrowseMode && (
            <Switch
              checked={evoLineActive}
              onChange={setEvoLineActive}
              label="Evolutionslinie"
              className="self-start"
            />
          )}

          {/* Set-Filter */}
          <SearchableSelect
            value={filterSet}
            onChange={setFilterSet}
            onClear={filterSet ? () => setFilterSet('') : undefined}
            options={isBrowseMode ? browseSetOptionsShown : setFilterOptions}
            height="sm"
            fullWidth
            searchPlaceholder="Set suchen …"
            aria-label="Set-Filter"
          />
        </div>
      </Sheet>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="flex-1 px-3 py-3">

        {/* Pokémon-Scope: Pokédex-Grid (alle 1025 Spezies) */}
        {scope === 'pokemon' && (
          <SpeciesGrid
            query={inputValue}
            sort={pokemonSort}
            dir={pokemonSortDir}
            onSelect={(dex) => {
              // Rückkehr-Zustand sichern (Tab + Suchbegriff + Sortierung + Scroll),
              // damit „Zurück" von der Detailseite wieder im Pokémon-Tab an gleicher
              // Stelle mit gleicher Sortierung landet.
              try { sessionStorage.setItem('collectionReturn', JSON.stringify({ scope: 'pokemon', query: inputValue, sort: pokemonSort, dir: pokemonSortDir, scrollY: window.scrollY })); } catch {}
              router.push(`/pokemon/${dex}`);
            }}
          />
        )}

        {/* Illustrator-Scope: Profil-Liste */}
        {scope === 'illustrator' && <IllustratorResults query={inputValue} onCount={setIllustratorCount} />}

        {/* ── Karten-Scope: Suche/Browse wie bisher ── */}
        {scope === 'cards' && (<>

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
        </>)}
      </div>

      <ScrollToTopButton />
      <LegendButton symbols={['wishlist-heart', 'unreviewed', 'count', 'foreign-lang', 'pending']} />

    </div>
  );
}

export default function CollectionPage() {
  return <Suspense><CollectionContent /></Suspense>;
}
