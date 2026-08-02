'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, X } from 'lucide-react';
import { getCards } from '@/lib/firestore/cards';
import { VARIANT_LABELS } from '@/lib/card-constants';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CardDoc } from '@/types';

interface Props {
  excludeBinderId?: string; // (zukünftig: nur Karten zeigen, die noch nicht in diesem Binder sind — aktuell aus)
  onClose: () => void;
  onPick: (cardDocId: string) => void;
}

/** Sheet zum Auswählen einer konkreten CardDoc für einen Binder-Slot.
 *  Zeigt alle Karten der Sammlung — jede CardDoc-Variante (tcgId × Variant × Condition × Sprache)
 *  als separaten Eintrag, damit Stefan gezielt eine spezifische Kopie auswählen kann. */
export function BinderSlotPickerModal({ onClose, onPick }: Props) {
  const [cards, setCards] = useState<CardDoc[] | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    getCards().then(setCards).catch(() => setCards([]));
  }, []);

  const filtered = useMemo(() => {
    if (!cards) return [];
    const s = search.trim().toLowerCase();
    if (!s) return cards;
    return cards.filter(c =>
      c.name.toLowerCase().includes(s) ||
      c.number.toLowerCase().includes(s) ||
      (c.setName ?? '').toLowerCase().includes(s)
    );
  }, [cards, search]);

  return (
    <Sheet
      open
      onClose={onClose}
      dragToClose
      elevated
      bodyClassName="px-2 pb-4"
      header={
        <div className="shrink-0">
          <div className="px-4 pb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Karte wählen</h2>
            <Button variant="ghost" onClick={onClose} icon={<X />} aria-label="Schließen" className="shrink-0" />
          </div>
          <div className="px-4 pb-3">
            <Input
              variant="search"
              value={search}
              onChange={setSearch}
              onClear={() => setSearch('')}
              placeholder="Name, Nummer oder Set suchen…"
              autoFocus
            />
          </div>
        </div>
      }
    >
        <div className="flex-1 overflow-y-auto">
          {cards === null ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {search ? 'Keine Karten gefunden.' : 'Noch keine Karten in deiner Sammlung.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-1.5">
              {filtered.map(c => (
                <button
                  key={c.id}
                  onClick={() => onPick(c.id)}
                  className="flex items-center gap-2 px-2 py-2 rounded-md text-left transition-colors hover:bg-secondary active:bg-secondary"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.tcgImageUrl ?? ""}
                    alt={c.name}
                    className="w-9 h-12 rounded object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">
                      {c.setId.toUpperCase()} · {c.number}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded border"
                      style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
                    >
                      {VARIANT_LABELS[c.variant] ?? c.variant}
                    </span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded border"
                      style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
                    >
                      {c.condition}
                    </span>
                    {c.quantity > 1 && (
                      <span className="text-[10px] text-muted-foreground font-mono">×{c.quantity}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
    </Sheet>
  );
}
