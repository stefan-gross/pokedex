import { Timestamp } from 'firebase/firestore';
import {
  getBinders, ensureDefaultBinder, addCardToBinder, removeCardFromBinder, setBinderPages,
} from '@/lib/firestore/binders';
import { getCards } from '@/lib/firestore/cards';
import { getWishlists, addWishlist, updateWishlist } from '@/lib/firestore/wishlists';
import { computeBinderSyncPlan, type SlotChangeEvent } from './plan';
import type { BinderDoc, WishlistDoc, CardDoc } from '@/types';

/** `SlotChangeEvent` + Binder-Kontext — genug, um dem Nutzer zu sagen,
 *  *welche* automatische Sammlung sich *wie* durch das Hinzufügen einer
 *  Karte verändert hat (siehe AddToCollectionModal/BulkAddToCollectionModal). */
export interface ChangedCardEvent extends SlotChangeEvent {
  binderId: string;
  binderName: string;
}

export interface SyncResult {
  synced: number;
  moved: number;
  errored: number;
  changedCardEvents: ChangedCardEvent[];
}

/** Synct einen einzelnen Vorlagen-Binder gegen den aktuellen Kartenbestand
 *  (Client SDK — läuft im Browser mit eingeloggtem Nutzer, siehe
 *  `sync-admin.ts` für die Cron-Variante). */
async function syncOneBinder(
  binder: BinderDoc, ownedCards: CardDoc[], allWishlists: WishlistDoc[], defaultBinderId: string,
): Promise<{ moved: number; changedCardEvents: ChangedCardEvent[] }> {
  if (!binder.template) return { moved: 0, changedCardEvents: [] };

  let wl = allWishlists.find(w => w.templateBinderId === binder.id);
  if (!wl) {
    const id = await addWishlist(binder.name);
    await updateWishlist(id, { templateBinderId: binder.id });
    wl = { id, name: binder.name, description: '', items: [], templateBinderId: binder.id, createdAt: Timestamp.now() };
    allWishlists.push(wl);
  }

  const plan = await computeBinderSyncPlan(binder, ownedCards, wl.items);

  if (plan.pagesChanged) await setBinderPages(binder.id, plan.pages);

  let moved = 0;
  if (defaultBinderId !== binder.id) {
    // Gewinner werden aus „Meine Sammlung" entfernt (arrayRemove ist ein
    // sicherer No-op, falls sie dort gar nicht lagen), Verlierer (z.B. die
    // verdrängte Normal-Karte) wandern dorthin. Einschränkung: andere,
    // nicht-Standard-Binder, in die eine Karte manuell gepackt wurde,
    // werden hier nicht angefasst.
    for (const id of plan.winnerCardIds) await removeCardFromBinder(defaultBinderId, id);
    for (const id of plan.loserCardIds) { await addCardToBinder(defaultBinderId, id); moved++; }
  }

  if (JSON.stringify(plan.wishlistItems) !== JSON.stringify(wl.items)) {
    await updateWishlist(wl.id, { items: plan.wishlistItems });
    wl.items = plan.wishlistItems;
  }

  return {
    moved,
    changedCardEvents: plan.changedCardEvents.map(e => ({ ...e, binderId: binder.id, binderName: binder.name })),
  };
}

/** Zentrale Sync-Funktion für alle Vorlagen-Binder — aufgerufen direkt nach
 *  Karten-Mutationen (hinzufügen/löschen) und zusätzlich per Cron
 *  (app/api/cron/sync-template-binders/route.ts → sync-admin.ts, da
 *  serverseitig kein Firebase-Auth-Kontext besteht und `binders`/`cards`/
 *  `wishlists` `request.auth != null` verlangen). Kein Live-Listener — die
 *  App nutzt app-weit nur einmalige Reads + expliziten Recompute, dieser
 *  Mechanismus bleibt konsistent dazu. `opts.binderIds` grenzt auf
 *  betroffene Binder ein (siehe `matchTemplateBinders` in match-hint.ts),
 *  sonst wird über alle Vorlagen-Binder gelaufen. */
export async function syncTemplateBinders(opts?: { binderIds?: string[] }): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, moved: 0, errored: 0, changedCardEvents: [] };

  const allBinders = await getBinders();
  const templateBinders = allBinders.filter(
    b => b.template != null && (!opts?.binderIds || opts.binderIds.includes(b.id)),
  );
  if (templateBinders.length === 0) return result;

  const [ownedCards, allWishlists, defaultBinderId] = await Promise.all([
    getCards(),
    getWishlists(),
    ensureDefaultBinder(),
  ]);

  for (const binder of templateBinders) {
    try {
      const { moved, changedCardEvents } = await syncOneBinder(binder, ownedCards, allWishlists, defaultBinderId);
      result.moved += moved;
      result.changedCardEvents.push(...changedCardEvents);
      result.synced++;
    } catch (e) {
      console.error('[template-binders] sync error', binder.id, e);
      result.errored++;
    }
  }
  return result;
}
