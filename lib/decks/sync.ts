/**
 * Deck-Bedarf → automatische Wunschliste (Client SDK). Pro Deck genau EINE
 * automatische Wunschliste (`WishlistDoc.deckId`), deren Items die fehlenden
 * Karten sind (computeDeckDemand). Gespiegelt von template-binders/sync.ts.
 * Aufgerufen nach Deck-Mutationen + beim Öffnen des Editors; zusätzlich per
 * Cron (sync-admin.ts), da serverseitig kein Firebase-Auth-Kontext besteht.
 */
import { Timestamp } from 'firebase/firestore';
import { getDecks } from '@/lib/firestore/decks';
import { getCards } from '@/lib/firestore/cards';
import { getWishlists, addWishlist, updateWishlist } from '@/lib/firestore/wishlists';
import { getCatalogCardsByIds, type CatalogCard } from '@/lib/firestore/catalog';
import { computeDeckDemand, type DeckDemand } from './demand';
import type { DeckDoc, WishlistDoc, WishlistItem, CardDoc } from '@/types';

/** DeckDemand.missing → WishlistItems (bestehende Felder priority/notes/acquired
 *  je Karte erhalten, damit der Cron/Sync sie nicht überschreibt). */
export function demandToWishlistItems(demand: DeckDemand, existing: WishlistItem[]): WishlistItem[] {
  const exByTcg = new Map(existing.filter(i => i.tcgId).map(i => [i.tcgId!, i]));
  return demand.missing.map(m => {
    const ex = exByTcg.get(m.catalogId);
    const item: WishlistItem = {
      id: ex?.id ?? m.catalogId,
      tcgId: m.catalogId,
      name: m.name,
      setId: m.setId,
      number: m.number,
      priority: ex?.priority ?? 2,
      acquired: ex?.acquired ?? false,
    };
    const notes = ex?.notes ?? (m.missing > 1 ? `${m.missing}× fürs Deck` : undefined);
    if (notes) item.notes = notes;
    return item;
  });
}

async function syncOneDeck(deck: DeckDoc, ownedCards: CardDoc[], allWishlists: WishlistDoc[], byId: Map<string, CatalogCard>): Promise<void> {
  let wl = allWishlists.find(w => w.deckId === deck.id);
  if (!wl) {
    const id = await addWishlist(deck.name);
    await updateWishlist(id, { deckId: deck.id });
    wl = { id, name: deck.name, items: [], deckId: deck.id, createdAt: Timestamp.now() };
    allWishlists.push(wl);
  }

  const demand = computeDeckDemand(deck.cards, byId, ownedCards);
  const items = demandToWishlistItems(demand, wl.items);
  if (JSON.stringify(items) !== JSON.stringify(wl.items)) {
    await updateWishlist(wl.id, { items });
    wl.items = items;
  }
}

/** Synct die Deck-Bedarfslisten. `opts.deckIds` grenzt ein (z.B. das gerade
 *  bearbeitete Deck), sonst alle Decks. */
export async function syncDeckWishlists(opts?: { deckIds?: string[] }): Promise<void> {
  const allDecks = await getDecks();
  const decks = opts?.deckIds ? allDecks.filter(d => opts.deckIds!.includes(d.id)) : allDecks;
  if (decks.length === 0) return;

  const [ownedCards, allWishlists] = await Promise.all([getCards(), getWishlists()]);
  const catIds = [...new Set(decks.flatMap(d => d.cards.map(c => c.catalogId)))];
  const byId = new Map((catIds.length ? await getCatalogCardsByIds(catIds) : []).map(c => [c.id, c]));

  for (const deck of decks) {
    try {
      await syncOneDeck(deck, ownedCards, allWishlists, byId);
    } catch (e) {
      console.error('[decks] wishlist sync error', deck.id, e);
    }
  }
}
