'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Plus, Folder, Heart } from 'lucide-react';
import { getBinders, deleteBinder } from '@/lib/firestore/binders';
import { getCards } from '@/lib/firestore/cards';
import { CreateBinderModal } from '@/components/binder/CreateBinderModal';
import { BinderIcon } from '@/lib/binder-icons';
import { useTotalValue } from '@/lib/hooks/use-total-value';
import { binderSizeLabel, type BinderSize } from '@/lib/binder-sizes';
import type { BinderDoc, CardDoc } from '@/types';

export default function BindersPage() {
  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    try {
      const [binderData, cardData] = await Promise.all([getBinders(), getCards()]);
      // Inbox „Neue Karten" und Default „Meine Sammlung" immer zuerst — danach normal nach sortOrder.
      const sorted = [...binderData].sort((a, b) => {
        const aRank = a.isInbox ? 0 : a.isDefault ? 1 : 2;
        const bRank = b.isInbox ? 0 : b.isDefault ? 1 : 2;
        if (aRank !== bRank) return aRank - bRank;
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      });
      setBinders(sorted);
      setCards(cardData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const cardsById = useMemo(() => {
    const m = new Map<string, CardDoc>();
    for (const c of cards) m.set(c.id, c);
    return m;
  }, [cards]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="px-4 pt-4 pb-4 flex items-center justify-between shadow-header bg-background">
        <div>
          <h1 className="text-2xl font-bold">Sammlungen</h1>
          <p className="text-sm text-muted-foreground">{binders.length} {binders.length === 1 ? 'Sammlung' : 'Sammlungen'}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="w-9 h-9 rounded-md flex items-center justify-center text-white"
          style={{ background: 'var(--action-add)' }}
        >
          <Plus size={20} />
        </button>
      </div>

      <div className="px-4 py-4">
        {loading && (
          <div className="flex justify-center pt-12">
            <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && binders.length === 0 && (
          <div className="text-center pt-16 space-y-3">
            <div className="flex justify-center"><Folder size={48} className="text-muted-foreground" /></div>
            <p className="font-semibold">Noch keine Sammlungen</p>
            <p className="text-sm text-muted-foreground">Erstelle deinen ersten Binder oder eine Box, um Karten zu organisieren</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-2 px-5 py-2.5 rounded-md text-sm font-semibold text-white"
              style={{ background: 'var(--action-add)' }}
            >
              Erste Sammlung erstellen
            </button>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {binders.map(binder => {
            const binderCards = binder.cardIds
              .map(id => cardsById.get(id))
              .filter((c): c is CardDoc => !!c);
            return (
              <BinderTile
                key={binder.id}
                binder={binder}
                binderCards={binderCards}
                onDeleted={load}
              />
            );
          })}
        </div>
      </div>

      {showCreate && (
        <CreateBinderModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

function BinderTile({ binder, binderCards, onDeleted: _ }: { binder: BinderDoc; binderCards: CardDoc[]; onDeleted: () => void }) {
  const cardCount = binder.cardIds.length;
  const bgColor   = binder.color ?? 'var(--pokedex-red)';
  const isBox     = binder.collectionType === 'box';
  const subtitle  = isBox ? 'Box' : binderSizeLabel((binder.size ?? 9) as BinderSize);
  const totalValue = useTotalValue(binderCards);

  return (
    <Link
      href={`/binders/${binder.id}`}
      className="relative rounded-2xl bg-card shadow-card overflow-hidden flex items-stretch active:scale-[.99] transition-transform"
    >
      {/* Vertikale Color-Bar links (statt oben, passt besser auf volle Breite) */}
      <div className="w-1.5 shrink-0" style={{ background: bgColor }} />

      <div className="flex-1 min-w-0 p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 pb-2 border-b border-border/60 min-w-0">
          <div className="shrink-0 h-6 flex items-center justify-center overflow-hidden">
            <BinderIcon name={binder.icon ?? (isBox ? 'box' : 'folder')} size={24} style={{ color: bgColor }} />
          </div>
          <div className="font-semibold text-base leading-tight truncate min-w-0">
            {binder.name}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="text-xs text-muted-foreground truncate flex items-center gap-2 min-w-0">
              <span className="truncate">
                {subtitle}
                {!isBox && binder.capacity != null && ` · ${binder.capacity} Karten`}
              </span>
              {(binder.wishlistCardIds?.length ?? 0) > 0 && (
                <span className="inline-flex items-center gap-0.5 shrink-0" style={{ color: '#ed64a6' }}>
                  +{binder.wishlistCardIds.length} <Heart size={10} fill="currentColor" />
                </span>
              )}
            </div>
            {!totalValue.loading && totalValue.withPrice > 0 && (
              <div className="text-[13px] font-bold truncate" style={{ color: bgColor }}>
                ≈ {totalValue.total.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
              </div>
            )}
          </div>

          <div className="shrink-0 flex flex-col items-center justify-center min-w-[72px]">
            <span
              className="text-[32px] font-extrabold leading-none tabular-nums"
              style={{ color: bgColor }}
            >
              {cardCount}
            </span>
            <span className="text-[10px] text-muted-foreground mt-1">
              {cardCount === 1 ? 'Karte' : 'Karten'}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
