'use client';

import { useState, useEffect, useMemo } from 'react';
import { Heart, X } from 'lucide-react';
import { getWishlists, ensureDefaultWishlist, removeItemFromWishlist } from '@/lib/firestore/wishlists';
import { getCatalogCardsByIds } from '@/lib/firestore/catalog';
import { getCardsByTcgId } from '@/lib/firestore/cards';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { usePricesBatch } from '@/lib/hooks/use-prices-batch';
import { pickTrendPrice, PRICE_COLOR } from '@/lib/prices/value-tier';
import type { WishlistDoc, WishlistItem, CardDoc } from '@/types';

export default function WishlistPage() {
  const [list, setList] = useState<WishlistDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailCard, setDetailCard] = useState<CardInfo | null>(null);
  const [detailOwned, setDetailOwned] = useState<CardDoc[]>([]);

  const load = async () => {
    try {
      const lists = await getWishlists();
      setList(lists[0] ?? await ensureDefaultWishlist());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const items = list?.items ?? [];
  const withTcgId = items.filter(i => i.tcgId);
  const freeText  = items.filter(i => !i.tcgId);

  const tcgIds = useMemo(() => withTcgId.map(i => i.tcgId!).filter(Boolean), [withTcgId]);
  const { prices } = usePricesBatch(tcgIds);

  async function handleRemove(item: WishlistItem) {
    if (!list) return;
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

  if (loading) {
    return (
      <div className="min-h-screen flex justify-center pt-16">
        <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <div className="px-4 pt-4 pb-4">
        <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.18)]">Wunschliste</h1>
        <p className="text-role-body text-glass-muted">{items.length} {items.length === 1 ? 'Karte' : 'Karten'}</p>
      </div>

      {items.length === 0 && (
        <div className="text-center pt-16 space-y-3 px-4">
          <div className="flex justify-center"><Heart size={48} className="text-glass-muted" /></div>
          <p className="text-role-title text-glass">Noch nichts auf der Wunschliste</p>
          <p className="text-role-body text-glass-muted">
            Öffne eine Karte im Detail und tippe auf „Auf Wunschliste setzen"
          </p>
        </div>
      )}

      {withTcgId.length > 0 && (
        <div className="px-3 grid grid-cols-2 gap-2">
          {withTcgId.map(item => {
            const price = pickTrendPrice(prices.get(item.tcgId!));
            return (
              <div key={item.id} className="relative flex flex-col">
                <div
                  className="relative rounded-[8px] overflow-hidden glass cursor-pointer"
                  onClick={() => openDetail(item)}
                >
                  {item.tcgImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.tcgImageUrl}
                      alt={item.name}
                      className="w-full aspect-[2.5/3.5] object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-[2.5/3.5] flex items-center justify-center text-glass-muted text-xs">
                      {item.name}
                    </div>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); handleRemove(item); }}
                    className="absolute top-1 right-1 w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(0,0,0,.6)' }}
                    aria-label="Von Wunschliste entfernen"
                  >
                    <X size={14} color="#fff" />
                  </button>
                  {price != null && (
                    <div
                      className="absolute bottom-1.5 left-1.5 text-role-badge px-1.5 py-0.5 rounded-md"
                      style={{ background: 'rgba(0,0,0,.7)', color: PRICE_COLOR }}
                    >
                      {price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-glass text-center mt-1.5 truncate px-0.5 leading-tight">
                  {item.name}
                </div>
                {item.setName && (
                  <div className="text-[10px] text-glass-muted text-center truncate px-0.5 leading-tight">
                    {item.setName}{item.number ? ` · ${item.number}` : ''}
                  </div>
                )}
              </div>
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
              <button onClick={() => handleRemove(item)} className="text-glass-muted shrink-0" aria-label="Entfernen">
                <X size={16} />
              </button>
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
