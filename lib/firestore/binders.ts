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

/** „Unsortiert" (früher „Meine Sammlung"): Standard-Ablage für alle Karten
 *  ohne gezielte Binder-Zuordnung. Icon 'cards' + Farbe Weiß — siehe
 *  Migration in `app/(app)/binders/page.tsx`, die Bestandsdaten einmalig
 *  auf Name/Icon/Farbe anhebt. */
export async function ensureDefaultBinder(): Promise<string> {
  const binders = await getBinders();
  const byFlag = binders.find(b => b.isDefault);
  if (byFlag) return byFlag.id;
  // Existierenden Binder gleichen Namens übernehmen statt Duplikat anlegen
  const byName = binders.find(b => b.name === 'Meine Sammlung' || b.name === 'Unsortiert');
  if (byName) {
    await updateBinder(byName.id, { isDefault: true, sortOrder: -1, collectionType: 'box', name: 'Unsortiert', color: '#ffffff', icon: 'cards' });
    return byName.id;
  }
  return addBinder({ name: 'Unsortiert', isDefault: true, sortOrder: -1, collectionType: 'box', color: '#ffffff', icon: 'cards' });
}

/** „Eingang"-Inbox (früher „Neue Karten"): Sammelt ungespeicherte Karten beim
 *  Verlassen des Scanners. Persistent — wird NICHT auto-gelöscht wenn leer
 *  (UI blendet ihn dann aus). Icon 'alert' + Farbe Weiß, siehe Migration in
 *  `app/(app)/binders/page.tsx`. */
export async function ensureInboxBinder(): Promise<string> {
  const binders = await getBinders();
  const byFlag = binders.find(b => b.isInbox);
  if (byFlag) {
    // Alte, noch nicht umbenannte Bestandsdaten migrieren.
    if (byFlag.name === 'Neue Karten') await updateBinder(byFlag.id, { name: 'Eingang' });
    return byFlag.id;
  }
  const byName = binders.find(b => b.name === 'Neue Karten' || b.name === 'Eingang');
  if (byName) {
    await updateBinder(byName.id, { isInbox: true, sortOrder: -2, collectionType: 'box', name: 'Eingang', color: '#ffffff', icon: 'alert' });
    return byName.id;
  }
  return addBinder({ name: 'Eingang', isInbox: true, sortOrder: -2, collectionType: 'box', color: '#ffffff', icon: 'alert' });
}

/** Entfernt eine Karte aus einem Binder und löscht den Default-Binder automatisch wenn er danach leer ist. */
export async function removeCardFromBinderAndCleanup(binderId: string, cardId: string): Promise<void> {
  await removeCardFromBinder(binderId, cardId);
  const binder = await getBinder(binderId);
  if (binder?.isDefault && binder.cardIds.length === 0) {
    await deleteBinder(binderId);
  }
}

/** Löscht einen ganzen Binder sicher: enthaltene Karten werden zuerst zurück
 *  nach „Meine Sammlung" verschoben (wie beim Sheet-Löschen auf der
 *  Detailseite), statt beim Löschen des Binder-Dokuments verwaist zu
 *  bleiben (cardIds referenzieren die Karten nur einseitig — ohne diesen
 *  Schritt wären sie in keinem Binder mehr sichtbar). Von der
 *  Sammlungsübersicht UND der Detailseite gemeinsam genutzt. */
export async function deleteBinderCascade(binder: BinderDoc): Promise<void> {
  if (binder.cardIds.length > 0) {
    const defaultId = await ensureDefaultBinder();
    if (defaultId !== binder.id) {
      for (const cid of binder.cardIds) {
        await addCardToBinder(defaultId, cid);
      }
    }
  }
  await deleteBinder(binder.id);
}
