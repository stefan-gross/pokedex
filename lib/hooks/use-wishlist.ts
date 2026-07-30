'use client';

import { useEffect, useState, useCallback } from 'react';
import type { CardInfo } from '@/lib/card-info';
import type { WishlistItem } from '@/types';
import { getWishlists, ensureDefaultWishlist, addItemToWishlist, removeItemFromWishlist, updateWishlist } from '@/lib/firestore/wishlists';

/** tcgId → {listId, itemId} für alle Wishlist-Einträge über alle Listen hinweg
 *  (aktuell effektiv nur die eine Standard-Liste, siehe `ensureDefaultWishlist`). */
type WishlistIndex = Map<string, { listId: string; itemId: string }>;

/** Lädt einmal alle Wishlists und liefert einen O(1)-Status-Lookup + Toggle-
 *  Funktion für viele Karten-Kacheln gleichzeitig (Suchen-/Set-Detail-Grid).
 *  Analog zum bereits bestehenden Einzelkarten-Muster in `CardDetailSheet`. */
export function useWishlist() {
  const [index, setIndex] = useState<WishlistIndex>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWishlists().then(lists => {
      if (cancelled) return;
      const next: WishlistIndex = new Map();
      for (const list of lists) {
        for (const item of list.items) {
          if (item.tcgId) next.set(item.tcgId, { listId: list.id, itemId: item.id });
        }
      }
      setIndex(next);
      setLoaded(true);
    }).catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, []);

  const toggle = useCallback(async (card: CardInfo) => {
    const existing = index.get(card.id);
    if (existing) {
      await removeItemFromWishlist(existing.listId, existing.itemId);
      setIndex(prev => { const n = new Map(prev); n.delete(card.id); return n; });
      return;
    }
    const list = await ensureDefaultWishlist();
    const newItem = await addItemToWishlist(list.id, {
      tcgId: card.id,
      name: card.name,
      setName: card.setName,
      setId: card.setId,
      number: card.number,
      tcgImageUrl: card.imgLargeDe || card.imgLarge || card.imgSmall,
      priority: 2,
      acquired: false,
    });
    if (newItem) setIndex(prev => new Map(prev).set(card.id, { listId: list.id, itemId: newItem.id }));
  }, [index]);

  /** Fügt mehrere Karten in EINEM Schreibvorgang zur freien Standard-Wunschliste
   *  hinzu — für „alle fehlenden auf die Wunschliste" auf der Set-Detailseite.
   *  Überspringt Karten, die bereits (auf irgendeiner Liste) gewünscht sind
   *  bzw. schon in der Standard-Liste stehen, und schreibt nur EIN
   *  `updateWishlist` (kein N× `addItemToWishlist`). Gibt die Anzahl tatsächlich
   *  neu hinzugefügter Karten zurück. */
  const addMany = useCallback(async (cards: CardInfo[]): Promise<number> => {
    const list = await ensureDefaultWishlist();
    const existing = new Set(list.items.map(i => i.tcgId).filter(Boolean) as string[]);
    const toAdd = cards.filter(c => !index.has(c.id) && !existing.has(c.id));
    if (toAdd.length === 0) return 0;
    const newItems: WishlistItem[] = toAdd.map(c => ({
      id: crypto.randomUUID(),
      tcgId: c.id,
      name: c.name,
      setName: c.setName,
      setId: c.setId,
      number: c.number,
      tcgImageUrl: c.imgLargeDe || c.imgLarge || c.imgSmall,
      priority: 2,
      acquired: false,
    }));
    await updateWishlist(list.id, { items: [...list.items, ...newItems] });
    setIndex(prev => {
      const n = new Map(prev);
      newItems.forEach(it => n.set(it.tcgId!, { listId: list.id, itemId: it.id }));
      return n;
    });
    return newItems.length;
  }, [index]);

  return {
    loaded,
    wishlistIds: new Set(index.keys()),
    toggle,
    addMany,
  };
}
