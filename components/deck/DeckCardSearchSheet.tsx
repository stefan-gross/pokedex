'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { searchCatalogCards } from '@/lib/search/catalog-search';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { getAllSets } from '@/lib/firestore/sets';
import { CardImage } from '@/components/card/CardImage';
import { Sheet } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { ButtonGroup } from '@/components/ui/button-group';
import { Stepper } from '@/components/ui/stepper';

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

type Filter = 'all' | 'owned' | 'missing';
const FILTER_OPTS = [
  { value: 'all' as Filter, label: 'Alle' },
  { value: 'owned' as Filter, label: 'Vorhanden' },
  { value: 'missing' as Filter, label: 'Fehlend' },
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
  const [filter, setFilter] = useState<Filter>('all');
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
        const { cards } = await searchCatalogCards(term, { displayLimit: 60, bridgeByDex: true });
        setResults(cards.map(catalogCardToInfo));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const shown = useMemo(() => {
    if (filter === 'owned') return results.filter(c => ownedTcgIds.has(c.id));
    if (filter === 'missing') return results.filter(c => !ownedTcgIds.has(c.id));
    return results;
  }, [results, filter, ownedTcgIds]);

  return (
    <Sheet open={open} onClose={onClose} title="Karte hinzufügen">
      <div className="flex flex-col gap-3">
        <Input value={q} onChange={setQ} placeholder="Name, Illustrator … oder #Dex" autoFocus />
        <ButtonGroup value={filter} onChange={setFilter} options={FILTER_OPTS} accentColor="#3182ce" />
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
