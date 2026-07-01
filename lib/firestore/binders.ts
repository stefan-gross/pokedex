import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  orderBy, query, Timestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { db } from '../firebase/client';
import type { BinderDoc, BinderPage } from '@/types';

const COL = 'binders';

/** Schreibt das positionale Seitenlayout + synchronisiert `cardIds` (derived).
 *  cardIds bleibt für Dashboard/useTotalValue/Collection-Lookups die Source of Truth
 *  über "welche Karten sind in diesem Binder?"; pages liefert zusätzlich die Position. */
export async function setBinderPages(binderId: string, pages: BinderPage[]): Promise<void> {
  const cardIds = pagesToCardIds(pages);
  await updateDoc(doc(db, COL, binderId), { pages, cardIds });
}

/** Reine Helper-Funktionen — keine Firestore-Calls. */
export function pagesToCardIds(pages: BinderPage[]): string[] {
  return pages.flatMap(p => p.slots.filter((s): s is string => !!s));
}

/** Materialisiert ein flaches cardIds-Array in Seiten der vorgegebenen Größe.
 *  Wird beim ersten Edit eines Legacy-Binders genutzt. */
export function cardIdsToPages(cardIds: string[], size: number): BinderPage[] {
  if (cardIds.length === 0) return [{ slots: Array(size).fill(null) }];
  const pages: BinderPage[] = [];
  for (let i = 0; i < cardIds.length; i += size) {
    const chunk = cardIds.slice(i, i + size);
    const slots: (string | null)[] = [...chunk];
    while (slots.length < size) slots.push(null);
    pages.push({ slots });
  }
  return pages;
}

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

export async function ensureDefaultBinder(): Promise<string> {
  const binders = await getBinders();
  const byFlag = binders.find(b => b.isDefault);
  if (byFlag) return byFlag.id;
  // Existierenden Binder gleichen Namens übernehmen statt Duplikat anlegen
  const byName = binders.find(b => b.name === 'Meine Sammlung');
  if (byName) {
    await updateBinder(byName.id, { isDefault: true, sortOrder: -1, collectionType: 'box' });
    return byName.id;
  }
  return addBinder({ name: 'Meine Sammlung', isDefault: true, sortOrder: -1, collectionType: 'box' });
}

/** „Neue Karten"-Inbox: Sammelt ungespeicherte Karten beim Verlassen des Scanners.
 *  Persistent — wird NICHT auto-gelöscht wenn leer (UI blendet ihn dann aus). */
export async function ensureInboxBinder(): Promise<string> {
  const binders = await getBinders();
  const byFlag = binders.find(b => b.isInbox);
  if (byFlag) return byFlag.id;
  const byName = binders.find(b => b.name === 'Neue Karten');
  if (byName) {
    await updateBinder(byName.id, { isInbox: true, sortOrder: -2, collectionType: 'box' });
    return byName.id;
  }
  return addBinder({ name: 'Neue Karten', isInbox: true, sortOrder: -2, collectionType: 'box' });
}

/** Entfernt eine Karte aus einem Binder und löscht den Default-Binder automatisch wenn er danach leer ist. */
export async function removeCardFromBinderAndCleanup(binderId: string, cardId: string): Promise<void> {
  await removeCardFromBinder(binderId, cardId);
  const binder = await getBinder(binderId);
  if (binder?.isDefault && binder.cardIds.length === 0) {
    await deleteBinder(binderId);
  }
}
