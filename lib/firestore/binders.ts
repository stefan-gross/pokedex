import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  orderBy, query, Timestamp, arrayUnion, arrayRemove, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/client';
import { deleteWishlistsForBinder } from './wishlists';
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

/** Schreibt die neue Reihenfolge der (nicht-Default-)Sammlungen: `sortOrder`
 *  = Position 0..n-1 in einem einzigen Batch-Write. „Unsortiert" (isDefault,
 *  sortOrder -1) wird NICHT übergeben und bleibt durch den Client-Sort vorn
 *  gepinnt; später erstellte Binder (`Date.now()`) sortieren dahinter. */
export async function reorderBinders(orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const batch = writeBatch(db);
  orderedIds.forEach((id, i) => batch.update(doc(db, COL, id), { sortOrder: i }));
  await batch.commit();
}

export async function deleteBinder(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}

export async function addCardToBinder(binderId: string, cardId: string): Promise<void> {
  await updateDoc(doc(db, COL, binderId), { cardIds: arrayUnion(cardId) });
}

/** Fügt mehrere Karten in EINEM Write hinzu (arrayUnion mit mehreren Werten) —
 *  für Bulk-Aktionen wie „passende Karten einsortieren", statt N Einzel-Writes. */
export async function addCardsToBinder(binderId: string, cardIds: string[]): Promise<void> {
  if (cardIds.length === 0) return;
  await updateDoc(doc(db, COL, binderId), { cardIds: arrayUnion(...cardIds) });
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

/** Entfernt eine Kopie aus ALLEN Bindern außer `keepBinderId` — setzt das
 *  Exklusivitäts-Prinzip durch (eine physische Kopie gehört zu genau EINER
 *  Sammlung). Bei Bindern mit positionalem Layout (`pages`, manuelle
 *  Sammlungen) wird die Karte aus den Slots entfernt (und `cardIds` daraus neu
 *  abgeleitet), sonst nur aus `cardIds`. */
export async function removeCardFromOtherBinders(cardId: string, keepBinderId: string | null): Promise<void> {
  const binders = await getBinders();
  for (const b of binders) {
    if (b.id === keepBinderId) continue;
    if (!b.cardIds.includes(cardId)) continue;
    if (b.pages?.some(p => p.slots.includes(cardId))) {
      const newPages = b.pages.map(p => ({ slots: p.slots.map(s => (s === cardId ? null : s)) }));
      await setBinderPages(b.id, newPages);
    } else {
      await removeCardFromBinder(b.id, cardId);
    }
  }
}

/** Exklusive Zuordnung einer Kopie zu genau einem (nicht-positionalen) Ziel-
 *  Binder — entfernt sie aus allen anderen Sammlungen und legt sie in den
 *  Ziel-Binder (z.B. „nach Unsortiert"). Für positionale manuelle Sammlungen
 *  wird stattdessen der Slot direkt geschrieben (`setBinderPages`) + separat
 *  `removeCardFromOtherBinders`. */
export async function setCardExclusiveBinder(cardId: string, targetBinderId: string): Promise<void> {
  await removeCardFromOtherBinders(cardId, targetBinderId);
  await addCardToBinder(targetBinderId, cardId);
}

/** Bulk-Variante von `setCardExclusiveBinder`: verschiebt MEHRERE Kopien
 *  exklusiv in den Ziel-Binder — entfernt sie aus allen anderen Sammlungen
 *  (positionale Slots werden geleert, `cardIds` daraus neu abgeleitet) und legt
 *  sie ins Ziel. Alles in EINEM `getBinders()`-Read + EINEM `writeBatch` statt
 *  N×(Read+2 Writes) — der entscheidende Unterschied beim Entfernen mehrerer
 *  Karten (vorher sekundenlang, sequenziell). Ziel wird nur über `cardIds`
 *  ergänzt (für nicht-positionale Ziele wie „Unsortiert"). */
export async function moveCardsToBinderExclusive(cardIds: string[], targetBinderId: string): Promise<void> {
  if (cardIds.length === 0) return;
  const idSet = new Set(cardIds);
  const binders = await getBinders();
  const batch = writeBatch(db);
  for (const b of binders) {
    if (b.id === targetBinderId) continue;
    if (!b.cardIds.some(id => idSet.has(id))) continue;
    if (b.pages?.some(p => p.slots.some(s => s != null && idSet.has(s)))) {
      const newPages = b.pages.map(p => ({ slots: p.slots.map(s => (s != null && idSet.has(s) ? null : s)) }));
      batch.update(doc(db, COL, b.id), { pages: newPages, cardIds: pagesToCardIds(newPages) });
    } else {
      batch.update(doc(db, COL, b.id), { cardIds: b.cardIds.filter(id => !idSet.has(id)) });
    }
  }
  batch.update(doc(db, COL, targetBinderId), { cardIds: arrayUnion(...cardIds) });
  await batch.commit();
}

/** Entfernt eine Karte aus einem Binder. „Unsortiert" (isDefault) ist der
 *  dauerhafte Hub und wird NICHT gelöscht, wenn er leer wird. */
export async function removeCardFromBinderAndCleanup(binderId: string, cardId: string): Promise<void> {
  await removeCardFromBinder(binderId, cardId);
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
  // Ist es eine automatische (Vorlagen-)Sammlung, auch ihre gekoppelte
  // Auto-Wunschliste entfernen — sonst bleibt sie als Waise in der
  // Wunschlisten-Übersicht zurück (Name/Icon/Farbe kann sie dann nicht mehr
  // von der gelöschten Sammlung erben).
  if (binder.template) await deleteWishlistsForBinder(binder.id);
  await deleteBinder(binder.id);
}
