import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { computeDeckDemand } from './demand';
import { demandToWishlistItems } from './sync';
import type { DeckDoc, WishlistDoc, CardDoc } from '@/types';
import type { CatalogCard } from '../firestore/catalog';

export interface DeckSyncResult { synced: number; errored: number }

/** Admin-SDK-Variante von `syncDeckWishlists` — für den Cron-Job
 *  (`app/api/cron/sync-decks/route.ts`). `decks`/`cards`/`wishlists` verlangen
 *  laut `firestore.rules` `request.auth != null`; ein Server-Cron hat keinen
 *  Firebase-Auth-Kontext → bewusst Admin SDK (umgeht Rules) statt der Client-
 *  Funktionen. Die Rechen-Logik (`computeDeckDemand`/`demandToWishlistItems`)
 *  ist mit der Client-Variante geteilt, nur das Firestore-I/O ist dupliziert. */
export async function syncDecksAdmin(opts?: { deckIds?: string[] }): Promise<DeckSyncResult> {
  const result: DeckSyncResult = { synced: 0, errored: 0 };
  const db = getAdminDb();

  const decksSnap = await db.collection('decks').get();
  const decks = decksSnap.docs
    .map(d => ({ id: d.id, ...d.data() }) as DeckDoc)
    .filter(d => !opts?.deckIds || opts.deckIds.includes(d.id));
  if (decks.length === 0) return result;

  const [cardsSnap, wishlistsSnap] = await Promise.all([
    db.collection('cards').get(),
    db.collection('wishlists').get(),
  ]);
  const ownedCards = cardsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as CardDoc);
  const allWishlists = wishlistsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as WishlistDoc);

  // Katalog-Karten der Deckrezepte laden (nur für den Basis-Energie-Test in
  // computeDeckDemand nötig). getAll akzeptiert beliebig viele DocRefs.
  const catIds = [...new Set(decks.flatMap(d => d.cards.map(c => c.catalogId)))];
  const byId = new Map<string, CatalogCard>();
  if (catIds.length) {
    const refs = catIds.map(id => db.collection('tcg_catalog').doc(id));
    const docs = await db.getAll(...refs);
    for (const d of docs) if (d.exists) byId.set(d.id, { id: d.id, ...d.data() } as CatalogCard);
  }

  for (const deck of decks) {
    try {
      let wl = allWishlists.find(w => w.deckId === deck.id);
      if (!wl) {
        const ref = await db.collection('wishlists').add({
          name: deck.name, description: '', items: [], deckId: deck.id,
          ownerUid: deck.ownerUid ?? null, createdAt: Timestamp.now(),
        });
        wl = { id: ref.id, name: deck.name, items: [], deckId: deck.id } as unknown as WishlistDoc;
        allWishlists.push(wl);
      }

      const demand = computeDeckDemand(deck.cards, byId, ownedCards);
      const items = demandToWishlistItems(demand, wl.items ?? []);
      if (JSON.stringify(items) !== JSON.stringify(wl.items ?? [])) {
        await db.collection('wishlists').doc(wl.id).update({ items });
      }
      result.synced++;
    } catch (e) {
      console.error('[decks] admin sync error', deck.id, e);
      result.errored++;
    }
  }
  return result;
}
