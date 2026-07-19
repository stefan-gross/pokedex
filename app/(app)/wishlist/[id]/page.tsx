'use client';

import { use, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Heart, Minus, Lock } from 'lucide-react';
import { getWishlist, removeItemFromWishlist } from '@/lib/firestore/wishlists';
import { getCatalogCardsByIds } from '@/lib/firestore/catalog';
import { getCardsByTcgId } from '@/lib/firestore/cards';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { Card } from '@/components/card/Card';
import { usePricesBatch } from '@/lib/hooks/use-prices-batch';
import { pickTrendPrice } from '@/lib/prices/value-tier';
import type { WishlistDoc, WishlistItem, CardDoc } from '@/types';

interface Props {
  params: Promise<{ id: string }>;
}

export default function WishlistDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [list, setList] = useState<WishlistDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailCard, setDetailCard] = useState<CardInfo | null>(null);
  const [detailOwned, setDetailOwned] = useState<CardDoc[]>([]);

  const load = async () => {
    try {
      const wl = await getWishlist(id);
      if (!wl) { router.push('/wishlist'); return; }
      setList(wl);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const isTemplateList = !!list?.templateBinderId;
  const items = list?.items ?? [];
  const withTcgId = items.filter(i => i.tcgId);
  const freeText  = items.filter(i => !i.tcgId);

  const tcgIds = useMemo(() => withTcgId.map(i => i.tcgId!).filter(Boolean), [withTcgId]);
  const { prices } = usePricesBatch(tcgIds);

  async function handleRemove(item: WishlistItem) {
    if (!list || isTemplateList) return;
    await removeItemFromWishlist(list.id, item.id);
    setList(l => l ? { ...l, items: l.items.filter(i => i.id !== item.id) } : l);
  }

  async function openDetail(item: WishlistItem) {
    if (!item.tcgId) return;
    const [cc] = await getCatalogCardsByIds([item.tcgId]);
    if (!cc) return;
    const owned = await getCardsByTcgId(item.tcgId);
    setDetailOwned(owned);
    setDetailCard(catalogCardToInfo(cc));
  }

  if (loading || !list) {
    return (
      <div className="min-h-screen flex justify-center pt-16">
        <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <div className="sticky top-safe z-20 mx-3 mt-2 glass rounded-[20px] px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/wishlist')} className="text-glass" aria-label="Zurück">
            <ChevronLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-role-h2 truncate text-glass flex items-center gap-1.5">
              {list.name}
              {isTemplateList && <Lock size={13} className="text-glass-muted shrink-0" />}
            </h1>
            <p className="text-role-label text-glass-muted">{items.length} {items.length === 1 ? 'Karte' : 'Karten'}</p>
          </div>
        </div>
        {isTemplateList && (
          <p className="text-role-label text-glass-muted mt-2">
            Automatisch verwaltet — fehlende Karten dieser Vorlage
          </p>
        )}
      </div>

      {items.length === 0 && (
        <div className="text-center pt-16 space-y-3 px-4">
          <div className="flex justify-center"><Heart size={48} className="text-glass-muted" /></div>
          <p className="text-role-title text-glass">
            {isTemplateList ? 'Nichts mehr offen — Vorlage vollständig' : 'Noch nichts auf der Wunschliste'}
          </p>
          {!isTemplateList && (
            <p className="text-role-body text-glass-muted">
              Öffne eine Karte im Detail und tippe auf „Auf Wunschliste setzen"
            </p>
          )}
        </div>
      )}

      {withTcgId.length > 0 && (
        <div className="px-3 pt-4 grid grid-cols-2 gap-2">
          {withTcgId.map(item => {
            const price = pickTrendPrice(prices.get(item.tcgId!));
            return (
              <Card
                key={item.id}
                card={{
                  id: item.tcgId!, name: item.name, number: item.number ?? '',
                  setId: item.setId ?? '', setName: item.setName ?? '',
                  imgSmall: item.tcgImageUrl ?? '', imgLarge: item.tcgImageUrl ?? '',
                }}
                onCardClick={() => openDetail(item)}
                sublabel={item.setName ? `${item.setName}${item.number ? ` · ${item.number}` : ''}` : item.name}
                price={price != null ? price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : undefined}
                isWishlisted
                onWishlist={isTemplateList ? undefined : () => handleRemove(item)}
              />
            );
          })}
        </div>
      )}

      {freeText.length > 0 && (
        <div className="px-3 pt-4 space-y-1.5">
          {freeText.map(item => (
            <div key={item.id} className="flex items-center justify-between gap-2 glass-inner rounded-xl px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-role-body text-glass truncate">{item.name}</p>
                {item.notes && <p className="text-role-label text-glass-muted truncate">{item.notes}</p>}
              </div>
              {!isTemplateList && (
                <button onClick={() => handleRemove(item)} className="text-glass-muted shrink-0" aria-label="Entfernen">
                  <Minus size={16} strokeWidth={2.5} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {detailCard && (
        <CardDetailSheet
          card={detailCard}
          ownedCopies={detailOwned}
          onClose={() => setDetailCard(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
