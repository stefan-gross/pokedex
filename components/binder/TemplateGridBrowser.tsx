'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getCards } from '@/lib/firestore/cards';
import { getBinders } from '@/lib/firestore/binders';
import { resolveTemplateSlots } from '@/lib/template-binders/resolve';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { getRarityGroup } from '@/lib/card-constants';
import { filterCardsByQuery } from '@/lib/search/card-query';
import { pickTrendPrice } from '@/lib/prices/value-tier';
import { useWishlist } from '@/lib/hooks/use-wishlist';
import { Input } from '@/components/ui/input';
import { ButtonGroup } from '@/components/ui/button-group';
import { CardGrid, CardGridSkeleton } from '@/components/card/CardGrid';
import { CardSortBar } from '@/components/card/CardSortBar';
import { RarityFilterBar } from '@/components/card/RarityFilterBar';
import type { PriceResult } from '@/lib/prices/types';
import type { BinderDoc, BinderTemplate, CardDoc } from '@/types';

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
const pluralKarten = (n: number) => (n === 1 ? '1 Karte' : `${n} Karten`);

/** Fertige, in EIN Panel montierbare Teile der Vorlagen-Grid-Ansicht. */
export interface TemplateGridParts {
  /** true, sobald die Kartenmenge geladen ist (für die Höhenmessung des Grabbers). */
  ready: boolean;
  /** Filter-Region (Suche + Vorhanden/Fehlen + Rarity) — vom Aufrufer in die
   *  kollabierende Region des sticky Panels gehängt. */
  filterControls: ReactNode;
  /** Sortierung + Kartenanzahl — immer sichtbar unter der Filter-Region. */
  sortBar: ReactNode;
  /** Das Karten-Raster (oder Skeleton) für den Content-Bereich. */
  grid: ReactNode;
}

/**
 * Grid-Ansicht einer Vorlagen-Sammlung als vollwertiger Set-Browser: zeigt ALLE
 * Karten der Vorlage (besessen farbig, fehlend im Grau-Look), mit Suche,
 * Vorhanden/Fehlen-Filter, Rarity-Facetten und Sortierung — dieselben geteilten
 * Komponenten wie die Set-Detailseite (`RarityFilterBar`/`CardSortBar`/`CardGrid`/
 * `filterCardsByQuery`).
 *
 * Bewusst als Hook (statt Komponente): so kann die Binder-Detailseite die Filter
 * in IHR bestehendes sticky Kopf-Panel (mit Ansichts-Switch + Infos) einhängen,
 * statt ein zweites Panel darunter zu stapeln. Der Kollaps (Grabber/Scroll) läuft
 * über das `useGrabberCollapse` des Aufrufers.
 */
export function useTemplateGrid({
  template, active, priceResults, onCardsChanged,
  selectMode, binderCardIds, selectedCardIds, onToggleSelectCard,
}: {
  template: BinderTemplate | null;
  /** Nur laden/arbeiten, wenn die Grid-Ansicht wirklich sichtbar ist. */
  active: boolean;
  /** Preisdaten (tcgId → PriceResult) aus der Binder-Seite; für Preis-Sortierung/Pills. */
  priceResults?: Map<string, PriceResult | null>;
  onCardsChanged?: () => void;
  /** Bearbeiten-Modus: ein Tipp wählt das in DIESER Sammlung liegende Exemplar aus. */
  selectMode?: boolean;
  /** CardDoc-IDs, die in dieser (Vorlagen-)Sammlung liegen — bestimmt, welche
   *  Karte (per tcgId) auswählbar ist und welches Exemplar getroffen wird. */
  binderCardIds?: string[];
  /** Aktuell ausgewählte CardDoc-IDs (Seiten-State). */
  selectedCardIds?: Set<string>;
  /** Umschalten der Auswahl eines CardDoc-Exemplars. */
  onToggleSelectCard?: (cardDocId: string) => void;
}): TemplateGridParts {
  const [cards, setCards]   = useState<CardInfo[] | null>(null);
  const [owned, setOwned]   = useState<CardDoc[]>([]);
  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('number');
  const [sortDir, setSortDir]     = useState<SortDir>('asc');
  const [rarityFilter, setRarityFilter] = useState<Set<string>>(new Set());
  const { manualIds, autoIds, manualLists, memberManualListIds, toggleOnList } = useWishlist();

  // Kartenmenge der Vorlage (Master-Set/Pokémon/Illustrator) + eigene Karten —
  // erst laden, wenn die Grid-Ansicht sichtbar ist (spart Reads in Blätter-/
  // Seiten-Ansicht).
  const templateKey = template ? JSON.stringify(template) : null;
  useEffect(() => {
    if (!template || !active) return;
    let cancelled = false;
    (async () => {
      const [slots, ownedCards, allBinders] = await Promise.all([
        resolveTemplateSlots(template), getCards(), getBinders(),
      ]);
      if (cancelled) return;
      setBinders(allBinders);
      // Slots → flache, deduplizierte Katalog-Kartenliste → CardInfo (DE-Namen/-Bilder).
      const seen = new Set<string>();
      const infos: CardInfo[] = [];
      for (const s of slots) for (const cc of s.catalog) {
        if (seen.has(cc.id)) continue;
        seen.add(cc.id);
        infos.push(catalogCardToInfo(cc));
      }
      setCards(infos);
      setOwned(ownedCards);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey, active]);

  const ownedMap = useMemo(() => {
    const m = new Map<string, CardDoc[]>();
    for (const c of owned) if (c.tcgId) { const a = m.get(c.tcgId) ?? []; a.push(c); m.set(c.tcgId, a); }
    return m;
  }, [owned]);
  const ownedTcgIds = useMemo(() => new Set(ownedMap.keys()), [ownedMap]);

  // Auswahl (Bearbeiten-Modus): pro tcgId genau das Exemplar, das in DIESER
  // Sammlung liegt (binderCardIds). Grid-Karten sind Katalog-Karten (`id` =
  // tcgId) → Brücke tcgId → CardDoc-ID, damit ein Tipp das richtige Exemplar
  // aus der Sammlung entfernt (nicht ein Duplikat aus „Unsortiert").
  const binderCardIdSet = useMemo(() => new Set(binderCardIds ?? []), [binderCardIds]);
  const exemplarByTcg = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of owned) if (c.tcgId && binderCardIdSet.has(c.id) && !m.has(c.tcgId)) m.set(c.tcgId, c.id);
    return m;
  }, [owned, binderCardIdSet]);
  const selectableIds = useMemo(() => new Set(exemplarByTcg.keys()), [exemplarByTcg]);
  const selectedTcgIds = useMemo(() => {
    const s = new Set<string>();
    if (selectedCardIds) exemplarByTcg.forEach((docId, tcgId) => { if (selectedCardIds.has(docId)) s.add(tcgId); });
    return s;
  }, [exemplarByTcg, selectedCardIds]);

  const priceMap = useMemo(() => {
    const m = new Map<string, number>();
    priceResults?.forEach((pr, id) => { const v = pickTrendPrice(pr); if (v != null) m.set(id, v); });
    return m;
  }, [priceResults]);

  const spansMultipleSets = useMemo(
    () => cards ? new Set(cards.map(c => c.setId)).size > 1 : false, [cards]);

  const displayed = useMemo(() => {
    if (!cards) return [];
    let result = [...cards];
    if (filter === 'owned')   result = result.filter(c => ownedTcgIds.has(c.id));
    if (filter === 'missing') result = result.filter(c => !ownedTcgIds.has(c.id));
    result = filterCardsByQuery(result, search);
    if (rarityFilter.size > 0) {
      result = result.filter(c => rarityFilter.has((c.rarity ? getRarityGroup(c.rarity) : null)?.label ?? 'Sonstige'));
    }
    result.sort((a, b) => {
      if (sortField === 'price') {
        const pa = priceMap.get(a.id), pb = priceMap.get(b.id);
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1;
        if (pb == null) return -1;
        return sortDir === 'desc' ? pb - pa : pa - pb;
      }
      let cmp = 0;
      if (sortField === 'number')       cmp = (parseInt(a.number) || 0) - (parseInt(b.number) || 0) || a.number.localeCompare(b.number);
      else if (sortField === 'name')    cmp = a.name.localeCompare(b.name);
      else if (sortField === 'pokedex') cmp = (a.nationalDexNumber ?? 0) - (b.nationalDexNumber ?? 0);
      else if (sortField === 'hp')      cmp = (a.hp ?? 0) - (b.hp ?? 0);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return result;
  }, [cards, filter, search, sortField, sortDir, priceMap, rarityFilter, ownedTcgIds]);

  const toggleRarity = (label: string) =>
    setRarityFilter(prev => { const n = new Set(prev); if (n.has(label)) n.delete(label); else n.add(label); return n; });

  const filterControls = (
    <div className="space-y-2">
      <Input
        variant="search"
        value={search}
        onChange={setSearch}
        onClear={() => setSearch('')}
        placeholder="Suchen (Name, Nummer, Illustrator)"
        size="sm"
      />
      <ButtonGroup options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
      {cards && <RarityFilterBar cards={cards} ownedIds={ownedTcgIds} activeRarities={rarityFilter} onToggle={toggleRarity} />}
    </div>
  );

  const sortBar = (
    <CardSortBar
      options={SORT_OPTIONS}
      sortField={sortField}
      onSortFieldChange={setSortField}
      sortDir={sortDir}
      onSortDirChange={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
      resultLabel={pluralKarten(displayed.length)}
    />
  );

  const grid = cards === null ? (
    <CardGridSkeleton count={9} />
  ) : (
    <CardGrid
      cards={displayed}
      ownedMap={ownedMap}
      binders={binders}
      sortKey={sortField}
      priceMap={priceMap}
      manualIds={manualIds}
      autoIds={autoIds}
      manualLists={manualLists}
      memberIdsFor={memberManualListIds}
      onToggleList={toggleOnList}
      onCardsChanged={onCardsChanged}
      showSetBadge={spansMultipleSets}
      selectMode={selectMode}
      selectableIds={selectableIds}
      selectedIds={selectedTcgIds}
      onToggleSelect={(c) => { const id = exemplarByTcg.get(c.id); if (id) onToggleSelectCard?.(id); }}
    />
  );

  return { ready: active && cards !== null, filterControls, sortBar, grid };
}
