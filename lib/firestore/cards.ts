import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, where, Timestamp,
} from 'firebase/firestore';
import { db, currentUid, waitForUid } from '../firebase/client';
import { createUidCache } from './uid-cache';
import type { CardDoc } from '@/types';

const COL = 'cards';

// IDOR-Härtung (Phase 2): alle Reads nur auf die eigenen Docs (`ownerUid`).
// Bewusst NUR ein Gleichheitsfilter + In-Memory-Sortierung/-Filter, damit KEIN
// Firestore-Composite-Index nötig ist (Einzelfeld-Index auf ownerUid legt
// Firestore automatisch an). Ohne diesen Filter würden die neuen Rules
// (ownerUid == auth.uid) die ganze Query ablehnen.
const cardsCache = createUidCache<CardDoc[]>(async uid => {
  const snap = await getDocs(query(collection(db, COL), where('ownerUid', '==', uid)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as CardDoc))
    .sort((a, b) => (b.addedAt?.seconds ?? 0) - (a.addedAt?.seconds ?? 0));
});

/** Leert den `cards`-Cache — nach JEDER Mutation an `cards` aufzurufen (A3). */
export function invalidateCardsCache() { cardsCache.invalidate(); }

// A3: einmal je uid lesen, danach aus dem Cache (Re-Read bei jeder Navigation
// eliminiert). Kopie zurückgeben, damit ein In-Place-.sort() eines Aufrufers den
// Cache nicht korrumpiert.
export async function getCards(): Promise<CardDoc[]> {
  const uid = await waitForUid();
  if (!uid) return [];
  return [...(await cardsCache.get(uid))];
}

export async function getCard(id: string): Promise<CardDoc | null> {
  const snap = await getDoc(doc(db, COL, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as CardDoc) : null;
}

export async function getCardsBySet(setId: string): Promise<CardDoc[]> {
  return (await getCards()).filter(c => c.setId === setId);
}

export async function addCard(data: Omit<CardDoc, 'id' | 'addedAt' | 'updatedAt'>): Promise<string> {
  const ref = await addDoc(collection(db, COL), {
    ...data,
    ownerUid: currentUid(),
    addedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  invalidateCardsCache();
  return ref.id;
}

export async function updateCard(id: string, data: Partial<CardDoc>): Promise<void> {
  await updateDoc(doc(db, COL, id), { ...data, updatedAt: Timestamp.now() });
  invalidateCardsCache();
}

export async function deleteCard(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
  invalidateCardsCache();
}

export async function getCardsByTcgId(tcgId: string): Promise<CardDoc[]> {
  return (await getCards()).filter(c => c.tcgId === tcgId);
}

export async function getReviewCount(): Promise<number> {
  return (await getCards()).filter(c => c.needsReview).length;
}

export async function markReviewed(id: string): Promise<void> {
  await updateDoc(doc(db, COL, id), { needsReview: false, updatedAt: Timestamp.now() });
  invalidateCardsCache();
}
