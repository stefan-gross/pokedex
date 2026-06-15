'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { getCards } from '@/lib/firestore/cards';
import { VARIANT_LABELS } from '@/lib/card-constants';
import type { CardDoc } from '@/types';

const CLOSE_ANIM_MS = 250;

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
  const [visible, setVisible] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    const r = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(r);
  }, []);

  useEffect(() => {
    getCards().then(setCards).catch(() => setCards([]));
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, CLOSE_ANIM_MS);
  };

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
    <div className="fixed inset-0 z-[100] flex items-end">
      <div
        className="absolute inset-0 bg-black/60 transition-opacity duration-[250ms]"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={handleClose}
      />

      <div
        className="relative w-full rounded-t-2xl bg-card border-t border-border pb-safe flex flex-col"
        style={{
          maxHeight: '80vh',
          transform: visible ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: dragStartYRef.current != null ? 'none' : `transform ${CLOSE_ANIM_MS}ms ease-out`,
        }}
      >
        {/* Handle */}
        <div
          className="flex items-center justify-center -mt-1 mb-1 py-2 cursor-grab shrink-0"
          style={{ touchAction: 'none' }}
          onPointerDown={e => {
            dragStartYRef.current = e.clientY;
            setDragY(0);
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            if (dragStartYRef.current == null) return;
            const dy = e.clientY - dragStartYRef.current;
            setDragY(Math.max(0, dy));
          }}
          onPointerUp={e => {
            if (dragStartYRef.current == null) return;
            const dy = e.clientY - dragStartYRef.current;
            dragStartYRef.current = null;
            try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {}
            if (dy > 80) handleClose();
            else setDragY(0);
          }}
          onPointerCancel={() => { dragStartYRef.current = null; setDragY(0); }}
        >
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="px-4 pb-2 flex items-center justify-between gap-2 shrink-0">
          <h2 className="text-base font-semibold">Karte wählen</h2>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-md flex items-center justify-center"
            style={{ background: 'var(--secondary)' }}
            aria-label="Schließen"
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pb-3 shrink-0">
          <div className="flex items-center gap-2 px-3 h-10 rounded-md border border-border bg-secondary">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Name, Nummer oder Set suchen…"
              className="flex-1 bg-transparent text-sm outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
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
                    src={c.tcgImageUrl ?? `https://images.pokemontcg.io/${c.setId}/${c.number.split('/')[0]}_hires.png`}
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
      </div>
    </div>
  );
}
