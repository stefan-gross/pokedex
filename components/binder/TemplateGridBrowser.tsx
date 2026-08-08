'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getCards } from '@/lib/firestore/cards';
import { getBinders } from '@/lib/firestore/binders';
import { resolveTemplateSlots } from '@/lib/template-binders/resolve';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { getRarityGroup } from '@/lib/card-constants';
import { filterCardsByQuery } from '@/lib/search/card-query';
import { pickTrendPrice } from '@/lib/prices/value-tier';
import { useWishlist } from '@/lib/hooks/use-wishlist';
import { useGrabberCollapse } from '@/lib/hooks/use-grabber-collapse';
import { Input } from '@/components/ui/input';
import { ButtonGroup } from '@/components/ui/button-group';
import { Grabber } from '@/components/ui/Grabber';
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

/**
 * Grid-Ansicht einer Vorlagen-Sammlung als vollwertiger Set-Browser: zeigt ALLE
 * Karten der Vorlage (besessen farbig, fehlend im Grau-Look), mit Suche,
 * Vorhanden/Fehlen-Filter, Rarity-Facetten und Sortierung — dieselben geteilten
 * Komponenten wie die Set-Detailseite (`RarityFilterBar`/`CardSortBar`/`CardGrid`/
 * `filterCardsByQuery`), nur hier für die Vorlagen-Kartenmenge verdrahtet.
 */
export function TemplateGridBrowser({
  template, priceResults, onCardsChanged,
}: {
  template: BinderTemplate;
  /** Preisdaten (tcgId → PriceResult) aus der Binder-Seite; für Preis-Sortierung/Pills. */
  priceResults?: Map<string, PriceResult | null>;
  onCardsChanged?: () => void;
}) {
  const [cards, setCards]   = useState<CardInfo[] | null>(null);
  const [owned, setOwned]   = useState<CardDoc[]>([]);
  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('number');
  const [sortDir, setSortDir]     = useState<SortDir>('asc');
  const [rarityFilter, setRarityFilter] = useState<Set<string>>(new Set());
  const { wishlistIds, toggle: toggleWishlist } = useWishlist();

  // Kartenmenge der Vorlage (Master-Set/Pokémon/Illustrator) + eigene Karten.
  const templateKey = JSON.stringify(template);
  useEffect(() => {
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
  }, [templateKey]);

  const ownedMap = useMemo(() => {
    const m = new Map<string, CardDoc[]>();
    for (const c of owned) if (c.tcgId) { const a = m.get(c.tcgId) ?? []; a.push(c); m.set(c.tcgId, a); }
    return m;
  }, [owned]);
  const ownedTcgIds = useMemo(() => new Set(ownedMap.keys()), [ownedMap]);

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

  // Grabber-/Scroll-Kollaps wie auf der Such-/Set-Detailseite: EIN sticky
  // Glas-Panel, dessen Filter-Region (Suche + Vorhanden/Fehlen + Rarity) sich
  // per Griff (ziehen/tippen) und beim Scrollen ein-/ausklappt. Die Sortierung
  // bleibt immer sichtbar. `ready` erst, wenn die Karten geladen sind (sonst
  // misst der Hook eine leere Region).
  const panelRef    = useRef<HTMLDivElement>(null);
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const { stage, registerRegion, regionStyle, grabberProps } = useGrabberCollapse({
    regionCount: 1,
    panelRef,
    gridWrapRef,
    ready: cards !== null,
    measureDeps: [cards, spansMultipleSets],
  });

  return (
    <>
      {/* Sticky Filter-Panel — mirror der Set-Detailseite (ein Glas-Panel,
          kollabierende Filter-Region + immer sichtbare Sortierung + Griff). */}
      <div className="sticky top-safe z-20 px-3 pt-3 pb-1">
        <div ref={panelRef} className="glass rounded-[20px] px-4 pt-3 pb-3">
          {/* Klappbarer Body: Suche + Vorhanden/Fehlen + Rarity */}
          <div style={regionStyle(0)} className="overflow-hidden">
            <div ref={registerRegion(0)} className="space-y-2 pt-0.5">
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
          </div>

          {/* Immer sichtbar: Sortierung + Kartenanzahl */}
          <div className="pt-2">
            <CardSortBar
              options={SORT_OPTIONS}
              sortField={sortField}
              onSortFieldChange={setSortField}
              sortDir={sortDir}
              onSortDirChange={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
              resultLabel={pluralKarten(displayed.length)}
            />
          </div>

          {/* Griff: ziehen/tippen klappt die Filter-Region auf/zu. */}
          <Grabber expanded={stage === 0} {...grabberProps} />
        </div>
      </div>

      <div ref={gridWrapRef} className="px-3 py-3">
        {cards === null ? (
          <CardGridSkeleton count={9} />
        ) : (
          <CardGrid
            cards={displayed}
            ownedMap={ownedMap}
            binders={binders}
            sortKey={sortField}
            priceMap={priceMap}
            wishlistIds={wishlistIds}
            onToggleWishlist={(c) => toggleWishlist(c)}
            onCardsChanged={onCardsChanged}
            showSetBadge={spansMultipleSets}
          />
        )}
      </div>
    </>
  );
}
