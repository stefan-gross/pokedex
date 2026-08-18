'use client';

import { useState, useEffect } from 'react';
import { Minus } from 'lucide-react';
import { resolveCardImage, type CardInfo } from '@/lib/card-info';
import type { CardDoc, BinderDoc, CardVariant, CardCondition, CardLanguage } from '@/types';
import { deleteCard, getCardsByTcgId } from '@/lib/firestore/cards';
import { getBinders, removeCardFromBinderAndCleanup } from '@/lib/firestore/binders';
import { matchTemplateBinders } from '@/lib/template-binders/match-hint';
import { syncTemplateBinders } from '@/lib/template-binders/sync';
import { CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';
import { CardPrice } from '@/components/card/CardPrice';
import { BinderIcon } from '@/lib/binder-icons';
import { useSetMeta } from '@/lib/hooks/use-set-meta';
import { CardNameLabel } from '@/components/card/CardNameLabel';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

const CONDITION_COLOR: Record<string, string> = {
  NM: '#48bb78', LP: '#facc15', MP: '#fb923c', HP: '#f87171', Poor: '#9ca3af',
};

interface Props {
  card: CardInfo;
  /** Scanner liegt immer über dem Kamerabild — Drawer dort unabhängig vom
   *  App-Theme immer dunkel darstellen (via erzwungener `.dark`-Klasse). */
  fromScanner?: boolean;
  /** Beim Scan erkannte Attribute — das dazu passende Exemplar wird
   *  hervorgehoben und nach oben sortiert („passt zum Scan"). */
  matchVariant?: CardVariant;
  matchCondition?: CardCondition;
  matchLanguage?: CardLanguage;
  onClose: () => void;
  onDeleted: () => void;
}

/** Löschen-Drawer — Gegenstück zu `AddToCollectionModal`, gleiches
 *  Liquid-Glass-Design. Zeigt eine Zeile pro Exemplar (Sammlung + Zustand/
 *  Sprache/Variante) mit eigenem Löschen-Button, plus einen Button, um die
 *  Karte komplett aus allen Sammlungen zu entfernen. */
export function DeleteFromCollectionModal({
  card, fromScanner = false, matchVariant, matchCondition, matchLanguage, onClose, onDeleted,
}: Props) {
  // Passt ein Exemplar zu den beim Scan erkannten Attributen? (nur werten, wenn
  // mindestens ein Match-Kriterium übergeben wurde). Solche Exemplare stehen
  // oben und werden grün markiert — meist will man genau dieses entfernen.
  const isMatch = (copy: CardDoc) =>
    (matchVariant != null || matchCondition != null || matchLanguage != null) &&
    (matchVariant == null   || copy.variant === matchVariant) &&
    (matchCondition == null || copy.condition === matchCondition) &&
    (matchLanguage == null  || copy.language === matchLanguage);
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

  useEffect(() => {
    Promise.all([getBinders(), getCardsByTcgId(card.id)]).then(([b, c]) => {
      setAllBinders(b);
      setOwnedCopies(c);
      setLoaded(true);
    });
  }, [card.id]);

  const bindersOf = (copy: CardDoc) => allBinders.filter(b => b.cardIds.includes(copy.id));

  const deleteCopy = async (copy: CardDoc) => {
    if (confirmId !== copy.id) { setConfirmId(copy.id); return; }
    setDeletingId(copy.id);
    try {
      await Promise.all(bindersOf(copy).map(b => removeCardFromBinderAndCleanup(b.id, copy.id)));
      await deleteCard(copy.id);
      const remaining = ownedCopies.filter(c => c.id !== copy.id);
      setOwnedCopies(remaining);
      const matched = matchTemplateBinders(card, allBinders.filter(b => b.template));
      if (matched.length > 0) await syncTemplateBinders({ binderIds: matched.map(b => b.id) });
      onDeleted();
      if (remaining.length === 0) onClose();
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
      const matched = matchTemplateBinders(card, allBinders.filter(b => b.template));
      if (matched.length > 0) await syncTemplateBinders({ binderIds: matched.map(b => b.id) });
      onDeleted();
      onClose();
    } finally {
      setDeletingAll(false);
      setConfirmAll(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dragToClose
      forceDark={fromScanner}
      lockScroll={!fromScanner}
      elevated
      footer={ownedCopies.length > 0 ? (
        <Button
          onClick={deleteAll}
          disabled={deletingAll}
          variant="primary"
          accentColor="#c53030"
          size="lg"
          className="w-full"
          icon={!deletingAll ? <Minus size={18} strokeWidth={2.5} /> : undefined}
        >
          {deletingAll ? 'Wird gelöscht…' : confirmAll ? 'Wirklich überall löschen?' : 'Überall löschen'}
        </Button>
      ) : undefined}
    >
          {/* Karten-Zeile */}
          <div className="flex items-center gap-3 pb-[14px] mb-4 border-b border-[rgba(46,46,50,0.1)] dark:border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resolveCardImage(card, 'small')}
              alt={card.name}
              className="w-10 h-14 rounded-[3px] object-cover shrink-0"
            />
            <div className="min-w-0">
              <div className="text-base font-bold truncate"><CardNameLabel card={card} /></div>
              <div className="text-xs text-muted-foreground truncate">{setMeta?.nameDe ?? card.setName} · {cardNumDisplay}</div>
            </div>
            <CardPrice tcgId={card.id} plain fontSize={15} className="ml-auto font-extrabold shrink-0" />
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
              [...ownedCopies].sort((a, b) => Number(isMatch(b)) - Number(isMatch(a))).map(copy => {
                const binder = allBinders.find(b => b.cardIds.includes(copy.id));
                const binderName = binder?.name ?? 'Unsortiert';
                const binderColor = binder?.color ?? 'var(--muted-foreground)';
                const condColor = CONDITION_COLOR[copy.condition] ?? 'var(--muted-foreground)';
                const isConfirm = confirmId === copy.id;
                const isDeleting = deletingId === copy.id;
                const matched = isMatch(copy);
                return (
                  <div
                    key={copy.id}
                    className="glass-inner flex items-center gap-2.5 rounded-xl px-3 py-2"
                    style={matched
                      ? { background: 'rgba(53,209,90,0.16)', boxShadow: 'inset 0 0 0 1px rgba(53,209,90,0.4)' }
                      : { background: `color-mix(in srgb, ${binderColor} 16%, transparent)` }}
                  >
                    <div
                      className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0"
                      style={{ background: `color-mix(in srgb, ${binderColor} 20%, transparent)` }}
                    >
                      <BinderIcon name={binder?.icon ?? 'folder'} size={18} style={{ color: binderColor }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold truncate flex items-center gap-1.5">
                        {binderName}
                        {matched && (
                          <span className="text-[10px] font-bold px-1.5 py-px rounded" style={{ color: '#8ff0b0', background: 'rgba(53,209,90,0.2)' }}>
                            passt zum Scan
                          </span>
                        )}
                      </div>
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
                      {isDeleting ? <span className="text-[10px]">…</span> : <Minus size={16} strokeWidth={2.5} />}
                    </button>
                  </div>
                );
              })
            )}
          </div>
    </Sheet>
  );
}
