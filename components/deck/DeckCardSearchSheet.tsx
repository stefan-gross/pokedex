'use client';

import { useState, useEffect } from 'react';
import { Plus, Minus } from 'lucide-react';
import { searchCatalogCards } from '@/lib/search/catalog-search';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { CardImage } from '@/components/card/CardImage';
import { Sheet } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';

interface Props {
  open: boolean;
  onClose: () => void;
  /** catalogId → aktuelle Anzahl im Deck (für den Stepper-Zustand). */
  counts: Map<string, number>;
  /** +1 (übergibt die volle Karte für die denormalisierten Deck-Felder). */
  onAdd: (card: CardInfo) => void;
  /** Anzahl exakt setzen (fürs Verringern). */
  onSetCount: (catalogId: string, count: number) => void;
}

export function DeckCardSearchSheet({ open, onClose, counts, onAdd, onSetCount }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CardInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    const t = setTimeout(async () => {
      if (term.length < 2) { setResults([]); setLoading(false); return; }
      setLoading(true);
      try {
        const { cards } = await searchCatalogCards(term, { displayLimit: 40, bridgeByDex: true });
        setResults(cards.map(catalogCardToInfo));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Sheet open={open} onClose={onClose} title="Karte hinzufügen">
      <div className="flex flex-col gap-3">
        <Input value={q} onChange={setQ} placeholder="Name, Illustrator … oder #Dex" autoFocus />
        {loading && <p className="text-role-label text-muted-foreground px-1">Suche …</p>}
        {!loading && q.trim().length >= 2 && results.length === 0 && (
          <p className="text-role-label text-muted-foreground px-1">Keine Treffer.</p>
        )}
        <div className="flex flex-col gap-2">
          {results.map(card => {
            const n = counts.get(card.id) ?? 0;
            return (
              <div key={card.id} className="flex items-center gap-3">
                <div className="w-10 shrink-0">
                  <CardImage card={card} size="small" alt={card.name} width={63} height={88} className="w-full rounded" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold">{card.name}</p>
                  <p className="truncate text-role-label text-muted-foreground">{card.setId} · {card.number}</p>
                </div>
                {n > 0 ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => onSetCount(card.id, n - 1)} className="w-8 h-8 rounded-full flex items-center justify-center bg-black/10 dark:bg-white/15" aria-label="weniger">
                      <Minus size={16} />
                    </button>
                    <span className="w-5 text-center font-bold tabular-nums">{n}</span>
                    <button onClick={() => onAdd(card)} className="w-8 h-8 rounded-full flex items-center justify-center bg-black/10 dark:bg-white/15" aria-label="mehr">
                      <Plus size={16} />
                    </button>
                  </div>
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
