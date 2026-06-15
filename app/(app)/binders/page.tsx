'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Plus, Folder, Heart } from 'lucide-react';
import { getBinders, deleteBinder } from '@/lib/firestore/binders';
import { getCards } from '@/lib/firestore/cards';
import { CreateBinderModal } from '@/components/binder/CreateBinderModal';
import { BinderIcon } from '@/lib/binder-icons';
import { useTotalValue } from '@/lib/hooks/use-total-value';
import type { BinderDoc, CardDoc } from '@/types';

export default function BindersPage() {
  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    try {
      const [binderData, cardData] = await Promise.all([getBinders(), getCards()]);
      // Inbox-Binder „Neue Karten" nur anzeigen, wenn Karten drin sind
      setBinders(binderData.filter(b => !(b.isInbox && b.cardIds.length === 0)));
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

        <div className="grid grid-cols-2 gap-3">
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
  const subtitle  = isBox ? 'Box' : `${binder.size ?? 9}er Binder`;
  const totalValue = useTotalValue(binderCards);

  return (
    <Link
      href={`/binders/${binder.id}`}
      className="relative rounded-2xl bg-card shadow-card overflow-hidden flex flex-col min-h-[120px] active:scale-[.98] transition-transform"
    >
      {/* Color bar */}
      <div className="h-1.5 w-full" style={{ background: bgColor }} />

      <div className="flex-1 p-3 flex flex-col justify-between">
        <div className="flex items-start gap-2">
          <BinderIcon name={binder.icon ?? (isBox ? 'box' : 'folder')} size={24} style={{ color: bgColor }} className="shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-sm leading-tight truncate">{binder.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
          </div>
        </div>

        <div className="flex flex-col gap-1 mt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {cardCount} Karten
              {(binder.wishlistCardIds?.length ?? 0) > 0 && (
                <span className="ml-1 inline-flex items-center gap-0.5" style={{ color: '#ed64a6' }}>
                  +{binder.wishlistCardIds.length} <Heart size={10} fill="currentColor" />
                </span>
              )}
            </span>
            {!isBox && binder.size && (
              <div
                className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: `${bgColor}20`, color: bgColor }}
              >
                {cardCount}/{binder.size}
              </div>
            )}
          </div>
          {!totalValue.loading && totalValue.withPrice > 0 && (
            <span className="text-sm font-bold" style={{ color: bgColor }}>
              ≈ {totalValue.total.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
