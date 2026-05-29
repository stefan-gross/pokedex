import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  orderBy, query, Timestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { db } from '../firebase/client';
import type { BinderDoc } from '@/types';

const COL = 'binders';

export async function getBinders(): Promise<BinderDoc[]> {
  const snap = await getDocs(query(collection(db, COL), orderBy('sortOrder')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as BinderDoc));
}

export async function getBinder(id: string): Promise<BinderDoc | null> {
  const snap = await getDoc(doc(db, COL, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as BinderDoc) : null;
}

export async function addBinder(data: Omit<BinderDoc, 'id' | 'createdAt' | 'cardIds' | 'wishlistCardIds'>): Promise<string> {
  const ref = await addDoc(collection(db, COL), {
    ...data,
    cardIds: [],
    wishlistCardIds: [],
    createdAt: Timestamp.now(),
  });
  return ref.id;
}

export async function updateBinder(id: string, data: Partial<BinderDoc>): Promise<void> {
  await updateDoc(doc(db, COL, id), data);
}

export async function deleteBinder(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}

export async function addCardToBinder(binderId: string, cardId: string): Promise<void> {
  await updateDoc(doc(db, COL, binderId), { cardIds: arrayUnion(cardId) });
}

export async function removeCardFromBinder(binderId: string, cardId: string): Promise<void> {
  await updateDoc(doc(db, COL, binderId), { cardIds: arrayRemove(cardId) });
}

export async function addWishlistCardToBinder(binderId: string, wishlistCardId: string): Promise<void> {
  await updateDoc(doc(db, COL, binderId), { wishlistCardIds: arrayUnion(wishlistCardId) });
}
