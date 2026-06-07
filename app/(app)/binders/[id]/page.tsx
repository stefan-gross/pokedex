'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Settings, Trash2 } from 'lucide-react';
import { getBinder, deleteBinder } from '@/lib/firestore/binders';
import { getCard } from '@/lib/firestore/cards';
import { CreateBinderModal } from '@/components/binder/CreateBinderModal';
import type { BinderDoc, CardDoc } from '@/types';

interface Props {
  params: Promise<{ id: string }>;
}

type SlotCard = { type: 'owned'; card: CardDoc } | { type: 'wishlist'; cardId: string };

export default function BinderDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [binder, setBinder] = useState<BinderDoc | null>(null);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const load = async () => {
    const b = await getBinder(id);
    if (!b) { router.push('/binders'); return; }
    setBinder(b);
    const owned = await Promise.all(b.cardIds.map(cid => getCard(cid)));
    setCards(owned.filter(Boolean) as CardDoc[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const handleDelete = async () => {
    if (!binder) return;
    if (!confirm(`Sammlung „${binder.name}" löschen?`)) return;
    await deleteBinder(binder.id);
    router.push('/binders');
  };

  if (loading || !binder) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const binderColor = binder.color ?? 'var(--pokedex-red)';
  const isBox   = binder.collectionType === 'box';
  const binderSize = binder.size ?? 9;
  const cols = binderSize === 9 ? 3 : binderSize === 12 ? 3 : binderSize === 16 ? 4 : 3;
  const slots = isBox ? null : Array.from({ length: binderSize });

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background border-b border-border px-4 pt-12 pb-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-muted-foreground">
            <ChevronLeft size={22} />
          </button>
          <span className="text-xl">{binder.icon ?? '📁'}</span>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold truncate">{binder.name}</h1>
            <p className="text-xs text-muted-foreground">{cards.length}/{binder.size} Karten</p>
          </div>
          <button
            onClick={() => setShowActions(a => !a)}
            className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center"
          >
            <Settings size={15} />
          </button>
        </div>

        {/* Actions dropdown */}
        {showActions && (
          <div className="absolute right-4 top-[calc(100%-8px)] bg-card border border-border rounded-xl shadow-lg overflow-hidden z-30 min-w-[160px]">
            <button
              onClick={() => { setShowActions(false); setShowEdit(true); }}
              className="w-full px-4 py-3 text-sm text-left hover:bg-secondary"
            >
              Bearbeiten
            </button>
            <button
              onClick={() => { setShowActions(false); handleDelete(); }}
              className="w-full px-4 py-3 text-sm text-left text-destructive hover:bg-secondary"
            >
              Sammlung löschen
            </button>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-4 py-2 flex gap-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          Vorhanden
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full" style={{ background: '#ed64a6' }} />
          Wunschliste
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-secondary border border-border" />
          Leer
        </div>
      </div>

      {/* Card grid */}
      <div className="px-3 pb-6 grid gap-2" style={{ gridTemplateColumns: `repeat(${isBox ? 2 : cols}, 1fr)` }}>
        {isBox ? (
          /* Box: alle Karten ohne feste Slots */
          cards.map((card, i) => (
            <div key={i} className="relative rounded-xl overflow-hidden border border-green-500/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={card.tcgImageUrl ?? `https://images.pokemontcg.io/${card.setId}/${card.number.split('/')[0]}_hires.png`}
                alt={card.name}
                className="w-full aspect-[2.5/3.5] object-cover"
              />
              {card.quantity > 1 && (
                <div className="absolute top-1 right-1 text-[9px] font-bold px-1 py-0.5 rounded bg-black/70 text-white">
                  ×{card.quantity}
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 px-1 pb-1 pt-3"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,.7), transparent)' }}>
                <div className="text-[9px] text-white/80 truncate">{card.number}</div>
              </div>
            </div>
          ))
        ) : (
          /* Binder: feste Slots */
          slots!.map((_, i) => {
            const card = cards[i];
            const isWishlist = !card && (binder.wishlistCardIds?.[i] != null);

            if (card) {
              return (
                <div key={i} className="relative rounded-xl overflow-hidden border border-green-500/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={card.tcgImageUrl ?? `https://images.pokemontcg.io/${card.setId}/${card.number.split('/')[0]}_hires.png`}
                    alt={card.name}
                    className="w-full aspect-[2.5/3.5] object-cover"
                  />
                  {card.quantity > 1 && (
                    <div className="absolute top-1 right-1 text-[9px] font-bold px-1 py-0.5 rounded bg-black/70 text-white">
                      ×{card.quantity}
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 px-1 pb-1 pt-3"
                    style={{ background: 'linear-gradient(to top, rgba(0,0,0,.7), transparent)' }}>
                    <div className="text-[9px] text-white/80 truncate">{card.number}</div>
                  </div>
                </div>
              );
            }

            if (isWishlist) {
              return (
                <div key={i} className="relative rounded-xl overflow-hidden border" style={{ borderColor: 'rgba(237,100,166,.4)', background: '#080808' }}>
                  <div className="w-full aspect-[2.5/3.5] flex flex-col items-center justify-center">
                    <svg width="16" height="15" viewBox="0 0 24 22" fill="rgba(237,100,166,.7)" stroke="none">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                    <div className="text-[8px] mt-1" style={{ color: 'rgba(237,100,166,.7)' }}>WL</div>
                  </div>
                </div>
              );
            }

            return (
              <div key={i} className="rounded-xl border border-dashed border-border aspect-[2.5/3.5] flex items-center justify-center bg-secondary/30">
                <span className="text-muted-foreground/30 text-lg">{i + 1}</span>
              </div>
            );
          })
        )}
      </div>

      {showEdit && (
        <CreateBinderModal
          existing={binder}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
        />
      )}
    </div>
  );
}
