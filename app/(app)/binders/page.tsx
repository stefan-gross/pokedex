'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Plus, Folder, Heart } from 'lucide-react';
import { getBinders, deleteBinder } from '@/lib/firestore/binders';
import { getCards } from '@/lib/firestore/cards';
import { CreateBinderModal } from '@/components/binder/CreateBinderModal';
import { BinderCover } from '@/components/binder/BinderCover';
import { useTotalValue } from '@/lib/hooks/use-total-value';
import { tintedGlassStyle } from '@/lib/ui/tinted-glass';
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
      <div className="px-4 pt-4 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.18)]">Sammlungen</h1>
          <p className="text-role-body text-glass-muted">{binders.length} {binders.length === 1 ? 'Sammlung' : 'Sammlungen'}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-white"
          style={tintedGlassStyle('#2f855a')}
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
            <div className="flex justify-center"><Folder size={48} className="text-glass-muted" /></div>
            <p className="text-role-title text-glass">Noch keine Sammlungen</p>
            <p className="text-role-body text-glass-muted">Erstelle deinen ersten Binder oder eine Box, um Karten zu organisieren</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
              style={tintedGlassStyle('#2f855a')}
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

/** Binder/Box als Ringbuch-"Deckel"-Grafik (BinderCover) in der Sammlungsfarbe,
 *  Wert/Kartenanzahl als Overlay-Leiste unten. Boxen nutzen automatisch das
 *  Box-Icon statt des Ordner-Icons (binder.icon-Fallback), sehen sonst identisch aus. */
function BinderTile({ binder, binderCards, onDeleted: _ }: { binder: BinderDoc; binderCards: CardDoc[]; onDeleted: () => void }) {
  const cardCount = binder.cardIds.length;
  const isBox     = binder.collectionType === 'box';
  const totalValue = useTotalValue(binderCards);
  const wishlistCount = binder.wishlistCardIds?.length ?? 0;

  return (
    <Link href={`/binders/${binder.id}`} className="block active:scale-[.98] transition-transform">
      {/* Boxen etwas kleiner als Ordner darstellen (Karton wirkt kompakter) —
          Skalierung auf einem eigenen relative-Wrapper, damit Badge/Footer
          mitschrumpfen und weiterhin korrekt am Cover ausgerichtet bleiben. */}
      <div className="relative" style={isBox ? { transform: 'scale(0.92)', transformOrigin: 'center' } : undefined}>
        <BinderCover
          color={binder.color}
          name={binder.name}
          icon={binder.icon ?? (isBox ? 'box' : 'folder')}
          shape={isBox ? 'box' : 'folder'}
        />

        {wishlistCount > 0 && (
          <span
            className="absolute top-2.5 right-2.5 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: 'rgba(0,0,0,.35)', color: '#fff' }}
          >
            +{wishlistCount} <Heart size={9} fill="currentColor" />
          </span>
        )}

        <div className="absolute bottom-0 inset-x-0 flex items-end justify-between px-3.5 py-2.5">
          <span className="text-xs font-bold truncate text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.4)]">
            {!totalValue.loading && totalValue.withPrice > 0
              ? `≈ ${totalValue.total.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}`
              : ''}
          </span>
          <span className="text-xs text-white/85 shrink-0 tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,.4)]">
            {cardCount} {cardCount === 1 ? 'Karte' : 'Karten'}
          </span>
        </div>
      </div>
    </Link>
  );
}
