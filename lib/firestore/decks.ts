import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  where, query, Timestamp, writeBatch, runTransaction,
} from 'firebase/firestore';
import { db, currentUid, waitForUid } from '../firebase/client';
import { createUidCache } from './uid-cache';
import { getDecksRest } from './decks-rest';
import { deleteWishlistsForDeck } from './wishlists';
import type { DeckDoc, DeckCardRef } from '@/types';
import type { CardInfo } from '../card-info';

const COL = 'decks';

// A3/A4-Muster (wie binders/wishlists): einmal je uid lesen (REST-first, SDK-
// Fallback), danach aus dem Cache; nach JEDER Mutation `invalidateDecksCache()`.
const decksCache = createUidCache<DeckDoc[]>(async uid => {
  try {
    return await getDecksRest();
  } catch {
    const snap = await getDocs(query(collection(db, COL), where('ownerUid', '==', uid)));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as DeckDoc))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }
});

/** Leert den `decks`-Cache — nach JEDER Mutation an `decks` aufzurufen. */
export function invalidateDecksCache() { decksCache.invalidate(); }

export async function getDecks(): Promise<DeckDoc[]> {
  const uid = await waitForUid();
  if (!uid) return [];
  // Kopie zurückgeben, damit ein In-Place-Edit eines Aufrufers den Cache nicht korrumpiert.
  return [...(await decksCache.get(uid))];
}

/** Einzelnes Deck (aus dem Cache; nach Mutationen dank Invalidierung frisch). */
export async function getDeck(id: string): Promise<DeckDoc | null> {
  return (await getDecks()).find(d => d.id === id) ?? null;
}

export async function addDeck(data: Omit<DeckDoc, 'id' | 'createdAt' | 'cards'>): Promise<string> {
  const ref = await addDoc(collection(db, COL), {
    ...data,
    ownerUid: currentUid(),
    cards: [],
    createdAt: Timestamp.now(),
  });
  invalidateDecksCache();
  return ref.id;
}

export async function updateDeck(id: string, data: Partial<DeckDoc>): Promise<void> {
  await updateDoc(doc(db, COL, id), { ...data, updatedAt: Timestamp.now() });
  invalidateDecksCache();
}

export async function deleteDeck(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
  invalidateDecksCache();
}

/** Löscht das Deck UND seine gekoppelte automatische Wunschliste
 *  (WishlistDoc.deckId) — analog zu `deleteBinderCascade`. Aus der Overview
 *  aufzurufen, damit keine verwaiste Bedarfsliste zurückbleibt. */
export async function deleteDeckCascade(id: string): Promise<void> {
  await deleteWishlistsForDeck(id);
  await deleteDoc(doc(db, COL, id));
  invalidateDecksCache();
}

export async function reorderDecks(orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const batch = writeBatch(db);
  orderedIds.forEach((id, i) => batch.update(doc(db, COL, id), { sortOrder: i }));
  await batch.commit();
  invalidateDecksCache();
}

// ── Rezept-Mutationen (atomar via Transaktion) ───────────────────────────────
// Das `cards`-Array wird immer read-modify-write in einer Transaktion geändert,
// damit schnelle Stepper-Klicks (oder paralleles Hinzufügen) keine Updates
// verlieren. Denormalisierte Anzeigefelder kommen aus der übergebenen Karte
// (die UI hat sie ohnehin) — kein extra Katalog-Read.

function toDeckCardRef(card: CardInfo, count: number): DeckCardRef {
  return {
    catalogId: card.id,
    count,
    name: card.name,
    setId: card.setId,
    number: card.number,
    supertype: card.supertype ?? '',
  };
}

/** Karte ins Deck legen bzw. Anzahl erhöhen (Default +1). */
export async function addCardToDeck(deckId: string, card: CardInfo, add = 1): Promise<void> {
  const ref = doc(db, COL, deckId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const cards = [...((snap.data().cards ?? []) as DeckCardRef[])];
    const i = cards.findIndex(c => c.catalogId === card.id);
    if (i >= 0) cards[i] = { ...cards[i], count: cards[i].count + add };
    else cards.push(toDeckCardRef(card, add));
    tx.update(ref, { cards, updatedAt: Timestamp.now() });
  });
  invalidateDecksCache();
}

/** Anzahl eines Eintrags exakt setzen; count <= 0 entfernt ihn. */
export async function setDeckCardCount(deckId: string, catalogId: string, count: number): Promise<void> {
  const ref = doc(db, COL, deckId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    let cards = [...((snap.data().cards ?? []) as DeckCardRef[])];
    const i = cards.findIndex(c => c.catalogId === catalogId);
    if (i < 0) return;
    if (count <= 0) cards = cards.filter(c => c.catalogId !== catalogId);
    else cards[i] = { ...cards[i], count };
    tx.update(ref, { cards, updatedAt: Timestamp.now() });
  });
  invalidateDecksCache();
}

/** Eintrag komplett aus dem Deck entfernen. */
export async function removeDeckCard(deckId: string, catalogId: string): Promise<void> {
  return setDeckCardCount(deckId, catalogId, 0);
}

/** Das komplette Rezept überschreiben — für den Deck-Generator (D8), der einen
 *  fertigen Entwurf übernimmt. Kein Read-Modify-Write nötig (voller Ersatz). */
export async function setDeckCards(deckId: string, cards: DeckCardRef[]): Promise<void> {
  await updateDoc(doc(db, COL, deckId), { cards, updatedAt: Timestamp.now() });
  invalidateDecksCache();
}
