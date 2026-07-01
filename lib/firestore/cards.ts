import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/client';
import type { CardDoc } from '@/types';

const COL = 'cards';

export async function getCards(): Promise<CardDoc[]> {
  const snap = await getDocs(query(collection(db, COL), orderBy('addedAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as CardDoc));
}

export async function getCard(id: string): Promise<CardDoc | null> {
  const snap = await getDoc(doc(db, COL, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as CardDoc) : null;
}

export async function getCardsBySet(setId: string): Promise<CardDoc[]> {
  const snap = await getDocs(query(collection(db, COL), where('setId', '==', setId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as CardDoc));
}

export async function addCard(data: Omit<CardDoc, 'id' | 'addedAt' | 'updatedAt'>): Promise<string> {
  const ref = await addDoc(collection(db, COL), {
    ...data,
    addedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return ref.id;
}

export async function updateCard(id: string, data: Partial<CardDoc>): Promise<void> {
  await updateDoc(doc(db, COL, id), { ...data, updatedAt: Timestamp.now() });
}

export async function deleteCard(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}

export async function getCardsByTcgId(tcgId: string): Promise<CardDoc[]> {
  const snap = await getDocs(query(collection(db, COL), where('tcgId', '==', tcgId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as CardDoc));
}

export async function getReviewCount(): Promise<number> {
  const snap = await getDocs(query(collection(db, COL), where('needsReview', '==', true)));
  return snap.size;
}

export async function markReviewed(id: string): Promise<void> {
  await updateDoc(doc(db, COL, id), { needsReview: false, updatedAt: Timestamp.now() });
}
