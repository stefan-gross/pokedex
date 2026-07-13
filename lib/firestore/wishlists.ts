import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  orderBy, query, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/client';
import type { WishlistDoc, WishlistItem } from '@/types';

const COL = 'wishlists';

export async function getWishlists(): Promise<WishlistDoc[]> {
  const snap = await getDocs(query(collection(db, COL), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as WishlistDoc));
}

export async function getWishlist(id: string): Promise<WishlistDoc | null> {
  const snap = await getDoc(doc(db, COL, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as WishlistDoc) : null;
}

export async function addWishlist(name: string, description?: string): Promise<string> {
  const ref = await addDoc(collection(db, COL), {
    name,
    description: description ?? '',
    items: [],
    createdAt: Timestamp.now(),
  });
  return ref.id;
}

/** Einzelne freie Standard-Wishlist — analog zu `ensureDefaultBinder`.
 *  Explizit die erste NICHT an einen Vorlagen-Binder gekoppelte Liste
 *  (`!templateBinderId`) — sonst würde z.B. „Auf Wunschliste setzen" im
 *  Kartendetail eine automatisch verwaltete Vorlagen-Wunschliste treffen,
 *  falls die zufällig neuer/zuerst in der Sortierung ist. */
export async function ensureDefaultWishlist(): Promise<WishlistDoc> {
  const lists = await getWishlists();
  const free = lists.find(l => !l.templateBinderId);
  if (free) return free;
  const id = await addWishlist('Wunschliste');
  return { id, name: 'Wunschliste', description: '', items: [], createdAt: Timestamp.now() };
}

export async function updateWishlist(id: string, data: Partial<WishlistDoc>): Promise<void> {
  await updateDoc(doc(db, COL, id), data);
}

export async function deleteWishlist(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}

export async function addItemToWishlist(wishlistId: string, item: Omit<WishlistItem, 'id'>): Promise<WishlistItem | null> {
  const wl = await getWishlist(wishlistId);
  if (!wl) return null;
  const newItem: WishlistItem = { ...item, id: crypto.randomUUID() };
  await updateDoc(doc(db, COL, wishlistId), { items: [...wl.items, newItem] });
  return newItem;
}

export async function updateWishlistItem(wishlistId: string, itemId: string, data: Partial<WishlistItem>): Promise<void> {
  const wl = await getWishlist(wishlistId);
  if (!wl) return;
  const items = wl.items.map(i => i.id === itemId ? { ...i, ...data } : i);
  await updateDoc(doc(db, COL, wishlistId), { items });
}

export async function removeItemFromWishlist(wishlistId: string, itemId: string): Promise<void> {
  const wl = await getWishlist(wishlistId);
  if (!wl) return;
  await updateDoc(doc(db, COL, wishlistId), { items: wl.items.filter(i => i.id !== itemId) });
}
