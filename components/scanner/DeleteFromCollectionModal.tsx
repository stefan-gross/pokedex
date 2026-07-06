'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import type { CardInfo } from '@/lib/card-info';
import type { CardDoc, BinderDoc } from '@/types';
import { deleteCard, getCardsByTcgId } from '@/lib/firestore/cards';
import { getBinders, removeCardFromBinderAndCleanup } from '@/lib/firestore/binders';
import { CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';
import { CardPrice } from '@/components/card/CardPrice';
import { BinderIcon } from '@/lib/binder-icons';
import { useSetMeta } from '@/lib/hooks/use-set-meta';
import { CardNameLabel } from '@/components/card/CardNameLabel';

const CLOSE_ANIM_MS = 250;

const CONDITION_COLOR: Record<string, string> = {
  NM: '#48bb78', LP: '#facc15', MP: '#fb923c', HP: '#f87171', Poor: '#9ca3af',
};

interface Props {
  card: CardInfo;
  /** Scanner liegt immer über dem Kamerabild — Drawer dort unabhängig vom
   *  App-Theme immer dunkel darstellen (via erzwungener `.dark`-Klasse). */
  fromScanner?: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

/** Löschen-Drawer — Gegenstück zu `AddToCollectionModal`, gleiches
 *  Liquid-Glass-Design. Zeigt eine Zeile pro Exemplar (Sammlung + Zustand/
 *  Sprache/Variante) mit eigenem Löschen-Button, plus einen Button, um die
 *  Karte komplett aus allen Sammlungen zu entfernen. */
export function DeleteFromCollectionModal({ card, fromScanner = false, onClose, onDeleted }: Props) {
  const [allBinders, setAllBinders] = useState<BinderDoc[]>([]);
  const [ownedCopies, setOwnedCopies] = useState<CardDoc[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  // DE-Setname + gedruckte Nummer/Gesamtzahl (z.B. "052/172") — exakt wie bei
  // der gescannten Karte (RecognizedCardLarge), statt der rohen Katalog-Felder.
  const setMeta = useSetMeta(card.setId, undefined, card.setName);
  const cardNumBase = card.number.split('/')[0].padStart(3, '0');
  const cardNumTotal = setMeta?.printedTotal ? String(setMeta.printedTotal).padStart(3, '0') : null;
  const cardNumDisplay = cardNumTotal ? `${cardNumBase}/${cardNumTotal}` : card.number;

  const [visible, setVisible] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    const r = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(r);
  }, []);

  useEffect(() => {
    Promise.all([getBinders(), getCardsByTcgId(card.id)]).then(([b, c]) => {
      setAllBinders(b);
      setOwnedCopies(c);
      setLoaded(true);
    });
  }, [card.id]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, CLOSE_ANIM_MS);
  };

  const bindersOf = (copy: CardDoc) => allBinders.filter(b => b.cardIds.includes(copy.id));

  const deleteCopy = async (copy: CardDoc) => {
    if (confirmId !== copy.id) { setConfirmId(copy.id); return; }
    setDeletingId(copy.id);
    try {
      await Promise.all(bindersOf(copy).map(b => removeCardFromBinderAndCleanup(b.id, copy.id)));
      await deleteCard(copy.id);
      const remaining = ownedCopies.filter(c => c.id !== copy.id);
      setOwnedCopies(remaining);
      onDeleted();
      if (remaining.length === 0) handleClose();
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  };

  const deleteAll = async () => {
    if (!confirmAll) { setConfirmAll(true); return; }
    setDeletingAll(true);
    try {
      for (const copy of ownedCopies) {
        await Promise.all(bindersOf(copy).map(b => removeCardFromBinderAndCleanup(b.id, copy.id)));
        await deleteCard(copy.id);
      }
      onDeleted();
      handleClose();
    } finally {
      setDeletingAll(false);
      setConfirmAll(false);
    }
  };

  const sheetTransition = dragStartYRef.current != null ? 'none' : `transform ${CLOSE_ANIM_MS}ms ease-out`;

  return createPortal((
    <div className={fromScanner ? 'dark fixed inset-0 z-[100] flex items-end' : 'fixed inset-0 z-[100] flex items-end'}>
      <div
        className="absolute inset-0 transition-opacity duration-[250ms] bg-[rgba(240,242,248,0.5)] [backdrop-filter:saturate(0.55)_brightness(1.06)_blur(2px)] [-webkit-backdrop-filter:saturate(0.55)_brightness(1.06)_blur(2px)] dark:bg-[rgba(8,7,12,0.35)] dark:[backdrop-filter:saturate(0.5)_brightness(0.42)_blur(2px)] dark:[-webkit-backdrop-filter:saturate(0.5)_brightness(0.42)_blur(2px)]"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={handleClose}
      />

      <div
        className="relative w-full rounded-t-[26px] bg-[rgba(255,255,255,0.42)] dark:bg-[rgba(28,29,38,0.4)] border-t border-[rgba(255,255,255,0.85)] dark:border-[rgba(255,255,255,0.18)] shadow-[0_-12px_40px_rgba(0,0,0,0.18)] dark:shadow-[0_-12px_40px_rgba(0,0,0,0.5)] [backdrop-filter:blur(34px)_saturate(1.5)] [-webkit-backdrop-filter:blur(34px)_saturate(1.5)] max-h-[90dvh] flex flex-col text-foreground"
        style={{
          transform: visible ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: sheetTransition,
          padding: '12px 18px calc(22px + env(safe-area-inset-bottom, 0px))',
          colorScheme: fromScanner ? 'dark' : undefined,
        }}
      >
        {/* Handle — Swipe-Down zum Schließen */}
        <div
          className="flex items-center justify-center -mt-1 mb-3 py-2 cursor-grab shrink-0"
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
            try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            if (dy > 80) handleClose();
            else setDragY(0);
          }}
          onPointerCancel={() => { dragStartYRef.current = null; setDragY(0); }}
        >
          <div className="w-9 h-1 rounded-full bg-[rgba(46,46,50,0.2)] dark:bg-white/30" />
        </div>

        <div className="overflow-y-auto">
          {/* Karten-Zeile */}
          <div className="flex items-center gap-3 pb-[14px] mb-4 border-b border-[rgba(46,46,50,0.1)] dark:border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.imgSmallDe || card.imgSmall}
              alt={card.name}
              className="w-10 h-14 rounded-[3px] object-cover shrink-0"
            />
            <div className="min-w-0">
              <div className="text-base font-bold truncate"><CardNameLabel card={card} /></div>
              <div className="text-xs text-muted-foreground truncate">{setMeta?.nameDe ?? card.setName} · {cardNumDisplay}</div>
            </div>
            <CardPrice tcgId={card.id} plain fontSize={15} className="ml-auto text-[#6cb0ff]! font-extrabold shrink-0" />
          </div>

          {/* Sammlungen, in denen die Karte ist — eine Zeile pro Exemplar */}
          <div className="flex flex-col gap-1.5 mb-4">
            {!loaded ? (
              <div className="flex items-center gap-2 py-3">
                <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0" />
                <p className="text-[13px] text-muted-foreground">Lade Sammlungen…</p>
              </div>
            ) : ownedCopies.length === 0 ? (
              <p className="text-[13px] text-muted-foreground py-3">Nicht in der Sammlung</p>
            ) : (
              ownedCopies.map(copy => {
                const binder = allBinders.find(b => b.cardIds.includes(copy.id));
                const binderName = binder?.name ?? 'Meine Sammlung';
                const binderColor = binder?.color ?? 'var(--muted-foreground)';
                const condColor = CONDITION_COLOR[copy.condition] ?? 'var(--muted-foreground)';
                const isConfirm = confirmId === copy.id;
                const isDeleting = deletingId === copy.id;
                return (
                  <div
                    key={copy.id}
                    className="glass-inner flex items-center gap-2.5 rounded-xl px-3 py-2"
                    style={{ background: `color-mix(in srgb, ${binderColor} 16%, transparent)` }}
                  >
                    <div
                      className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0"
                      style={{ background: `color-mix(in srgb, ${binderColor} 20%, transparent)` }}
                    >
                      <BinderIcon name={binder?.icon ?? 'folder'} size={18} style={{ color: binderColor }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold truncate">{binderName}</div>
                      <div className="text-[12px] text-muted-foreground truncate">
                        <span style={{ color: condColor, fontWeight: 600 }}>{CONDITIONS.find(c => c.value === copy.condition)?.label ?? copy.condition}</span>
                        {' · '}{copy.language.toUpperCase()}{' · '}{VARIANT_LABELS[copy.variant]}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteCopy(copy)}
                      disabled={isDeleting}
                      className={`shrink-0 w-9 h-9 rounded-[10px] flex items-center justify-center transition-colors ${
                        isConfirm ? 'text-white' : 'bg-[rgba(46,46,50,0.06)] dark:bg-white/8 text-[#9aa0ac] dark:text-white/50'
                      }`}
                      style={isConfirm ? { background: 'var(--action-delete)' } : undefined}
                      aria-label={isConfirm ? 'Wirklich löschen?' : 'Exemplar löschen'}
                    >
                      {isDeleting ? <span className="text-[10px]">…</span> : <Trash2 size={15} />}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {ownedCopies.length > 0 && (
          <button
            onClick={deleteAll}
            disabled={deletingAll}
            className="w-full rounded-[15px] font-bold text-white disabled:opacity-50 transition-opacity shrink-0"
            style={{
              height: 54, fontSize: 17,
              background: 'var(--action-delete)',
              boxShadow: '0 6px 20px rgba(197,48,48,0.4)',
            }}
          >
            {deletingAll ? 'Wird gelöscht…' : confirmAll ? 'Wirklich überall löschen?' : 'Überall löschen'}
          </button>
        )}
      </div>
    </div>
  ), document.body);
}
