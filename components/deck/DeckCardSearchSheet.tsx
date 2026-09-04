'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { searchCatalogCards } from '@/lib/search/catalog-search';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { getAllSets } from '@/lib/firestore/sets';
import { CardImage } from '@/components/card/CardImage';
import { Sheet } from '@/components/ui/modal';
import { CardSearchField } from '@/components/search/CardSearchField';
import { CardFilterBar } from '@/components/search/CardFilterBar';
import { CardSortBar } from '@/components/card/CardSortBar';
import { Stepper } from '@/components/ui/stepper';
import { applyFacetFilters, type FacetState, type OwnedFilter, type Supertype } from '@/lib/search/facet-filter';
import { type TcgType } from '@/lib/hooks/useCardBrowser';
import { trendFromCached } from '@/lib/prices/trend-from-cached';

// Evolutionsstufe → Badge (gleiche Farbcodierung wie im Deck-Editor).
const STAGE_BADGE: Record<string, { label: string; color: string }> = {
  'Basic':   { label: 'Basis',   color: '#3f9e2c' },
  'Stage 1': { label: 'Phase 1', color: '#3182ce' },
  'Stage 2': { label: 'Phase 2', color: '#7a5cd8' },
};
function stageOf(card: CardInfo) {
  if (card.supertype !== 'Pokémon') return null;
  if (card.subtypes?.includes('Stage 2')) return STAGE_BADGE['Stage 2'];
  if (card.subtypes?.includes('Stage 1')) return STAGE_BADGE['Stage 1'];
  if (card.subtypes?.includes('Basic')) return STAGE_BADGE['Basic'];
  return null;
}

type SortKey = 'number' | 'name' | 'pokedex' | 'hp' | 'price';
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'number',  label: 'Nummer'      },
  { value: 'name',    label: 'Name'        },
  { value: 'pokedex', label: 'Pokédex-Nr.' },
  { value: 'hp',      label: 'KP'          },
  { value: 'price',   label: 'Preis'       },
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** catalogId → aktuelle Anzahl im Deck (für den Stepper-Zustand). */
  counts: Map<string, number>;
  /** tcgIds, die der Nutzer besitzt — für den Vorhanden/Fehlend-Filter + Marker. */
  ownedTcgIds: Set<string>;
  onAdd: (card: CardInfo) => void;
  onSetCount: (catalogId: string, count: number) => void;
}

export function DeckCardSearchSheet({ open, onClose, counts, ownedTcgIds, onAdd, onSetCount }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CardInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Geteilter Filter-/Sortier-State (wie die Hauptsuche) ──────────
  const [ownedFilter, setOwnedFilter] = useState<OwnedFilter>('all');
  const [activeSupertype, setActiveSupertype] = useState<Supertype | 'all'>('all');
  const [activeTypes, setActiveTypes] = useState<Set<TcgType>>(new Set());
  const [sort, setSort] = useState<SortKey>('number');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [setLogos, setSetLogos] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!open) return;
    getAllSets().then(sets => setSetLogos(new Map(sets.map(s => [s.id, s.logoUrl])))).catch(() => {});
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    const t = setTimeout(async () => {
      if (term.length < 2) { setResults([]); setLoading(false); return; }
      setLoading(true);
      try {
        const { cards } = await searchCatalogCards(term, { displayLimit: 300, bridgeByDex: true });
        setResults(cards.map(catalogCardToInfo));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const activeTypesKey = useMemo(() => [...activeTypes].sort().join(','), [activeTypes]);

  // Geteilte Filterlogik (identisch zur Suche/Set-Detailseite).
  const facetState = useMemo<FacetState>(() => ({
    ownedFilter, activeSupertype, activeTypes,
    activeEvolutions: new Set(), activeSpecialMechanics: new Set(), activeRarity: null,
    ownedIds: ownedTcgIds,
  }), [ownedFilter, activeSupertype, activeTypesKey, ownedTcgIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const r = [...applyFacetFilters(results, facetState)];
    const d = sortDir === 'desc' ? -1 : 1;
    r.sort((a, b) => {
      if (sort === 'name')    return d * a.name.localeCompare(b.name);
      if (sort === 'pokedex') return d * ((a.nationalDexNumber ?? 9999) - (b.nationalDexNumber ?? 9999));
      if (sort === 'hp')      return d * ((a.hp ?? 0) - (b.hp ?? 0));
      if (sort === 'price') {
        const pa = trendFromCached(a.prices), pb = trendFromCached(b.prices);
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1;
        if (pb == null) return -1;
        return d * (pa - pb);
      }
      return d * ((parseInt(a.number) || 0) - (parseInt(b.number) || 0));
    });
    return r;
  }, [results, facetState, sort, sortDir]);

  const resultCount = shown.length;

  return (
    <Sheet open={open} onClose={onClose} title="Karte hinzufügen">
      <div className="flex flex-col gap-2.5 min-h-[72dvh]">
        <CardSearchField value={q} onChange={setQ} onClear={() => setQ('')} placeholder="Name, Illustrator … oder #Dex" autoFocus />

        {/* Geteilte Filterleiste — hier: Vorhanden + Kartenart + Pokémon-Typ. */}
        <CardFilterBar
          cards={results}
          ownedIds={ownedTcgIds}
          owned={ownedFilter}
          onOwnedChange={setOwnedFilter}
          supertype={activeSupertype}
          onSupertypeChange={setActiveSupertype}
          types={activeTypes}
          onTypesChange={setActiveTypes}
        />

        {/* Sortierung + Ergebniszahl */}
        <CardSortBar
          options={SORT_OPTIONS}
          sortField={sort}
          onSortFieldChange={setSort}
          sortDir={sortDir}
          onSortDirChange={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          resultLabel={q.trim().length >= 2 && !loading ? `${resultCount} Karten` : undefined}
        />

        {loading && <p className="text-role-label text-muted-foreground px-1">Suche …</p>}
        {!loading && q.trim().length >= 2 && shown.length === 0 && (
          <p className="text-role-label text-muted-foreground px-1">
            {results.length > 0 ? 'Keine Treffer für diesen Filter.' : 'Keine Treffer.'}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {shown.map(card => {
            const n = counts.get(card.id) ?? 0;
            const stage = stageOf(card);
            const logo = setLogos.get(card.setId);
            const owned = ownedTcgIds.has(card.id);
            return (
              <div key={card.id} className="flex items-center gap-3">
                <div className="w-10 shrink-0">
                  <CardImage card={card} size="small" alt={card.name} width={63} height={88} className="w-full rounded" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{card.name}</span>
                    {stage && <span className="text-[10px] font-bold px-1.5 py-px rounded shrink-0 text-white" style={{ background: stage.color }}>{stage.label}</span>}
                    {card.hp != null && <span className="text-role-label text-muted-foreground shrink-0 tabular-nums">{card.hp} KP</span>}
                  </div>
                  <div className="flex items-center gap-1.5 text-role-label text-muted-foreground min-w-0">
                    {logo && <img src={logo} alt="" className="h-3.5 w-auto max-w-[42px] object-contain shrink-0" />}
                    {card.setCode && <span className="font-semibold shrink-0">{card.setCode}</span>}
                    <span className="truncate">· {card.number}</span>
                    {owned && <span className="shrink-0 font-semibold" style={{ color: '#3f9e2c' }}>· besitzt</span>}
                  </div>
                </div>
                {n > 0 ? (
                  <Stepper value={n} onDec={() => onSetCount(card.id, n - 1)} onInc={() => onAdd(card)} />
                ) : (
                  <button onClick={() => onAdd(card)} className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white" style={{ background: '#2f855a' }} aria-label="hinzufügen">
                    <Plus size={18} strokeWidth={2.6} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}
