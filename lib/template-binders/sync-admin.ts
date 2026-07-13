import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { computeBinderSyncPlan } from './plan';
import type { BinderDoc, WishlistDoc, CardDoc } from '@/types';
import type { SyncResult } from './sync';

/** Admin-SDK-Variante von `syncTemplateBinders` — für den Cron-Job
 *  (`app/api/cron/sync-template-binders/route.ts`). `binders`/`cards`/
 *  `wishlists` verlangen laut `firestore.rules` `request.auth != null`,
 *  ein Server-Cron hat aber keinen Firebase-Auth-Kontext — daher hier
 *  bewusst Admin SDK (umgeht Security Rules) statt der Client-SDK-
 *  Funktionen aus `lib/firestore/*.ts`. Die eigentliche Sync-Logik
 *  (`computeBinderSyncPlan`) ist mit der Client-Variante (`sync.ts`)
 *  geteilt, nur das Firestore-I/O ist dupliziert. */
export async function syncTemplateBindersAdmin(opts?: { binderIds?: string[] }): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, moved: 0, errored: 0, changedCardEvents: [] };
  const db = getAdminDb();

  const bindersSnap = await db.collection('binders').get();
  const allBinders = bindersSnap.docs.map(d => ({ id: d.id, ...d.data() }) as BinderDoc);
  const templateBinders = allBinders.filter(
    b => b.template != null && (!opts?.binderIds || opts.binderIds.includes(b.id)),
  );
  if (templateBinders.length === 0) return result;

  const [cardsSnap, wishlistsSnap] = await Promise.all([
    db.collection('cards').get(),
    db.collection('wishlists').get(),
  ]);
  const ownedCards = cardsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as CardDoc);
  const allWishlists = wishlistsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as WishlistDoc);

  // Default-Binder auflösen — dieselbe Logik wie `ensureDefaultBinder`
  // (lib/firestore/binders.ts), hier gegen Admin SDK dupliziert.
  let defaultBinderId = allBinders.find(b => b.isDefault)?.id;
  if (!defaultBinderId) {
    const byName = allBinders.find(b => b.name === 'Meine Sammlung');
    if (byName) {
      await db.collection('binders').doc(byName.id).update({ isDefault: true, sortOrder: -1, collectionType: 'box' });
      defaultBinderId = byName.id;
    } else {
      const ref = await db.collection('binders').add({
        name: 'Meine Sammlung', isDefault: true, sortOrder: -1, collectionType: 'box',
        cardIds: [], wishlistCardIds: [], createdAt: Timestamp.now(),
      });
      defaultBinderId = ref.id;
    }
  }

  for (const binder of templateBinders) {
    try {
      let wl = allWishlists.find(w => w.templateBinderId === binder.id);
      if (!wl) {
        const ref = await db.collection('wishlists').add({
          name: binder.name, description: '', items: [], templateBinderId: binder.id, createdAt: Timestamp.now(),
        });
        wl = { id: ref.id, name: binder.name, description: '', items: [], templateBinderId: binder.id } as unknown as WishlistDoc;
        allWishlists.push(wl);
      }
      const wishlist = wl;

      const plan = await computeBinderSyncPlan(binder, ownedCards, wishlist.items);

      if (plan.pagesChanged) {
        await db.collection('binders').doc(binder.id).update({
          pages: plan.pages,
          cardIds: plan.pages.flatMap(p => p.slots).filter((id): id is string => id !== null),
        });
      }

      let moved = 0;
      if (defaultBinderId !== binder.id) {
        for (const id of plan.winnerCardIds) {
          await db.collection('binders').doc(defaultBinderId).update({ cardIds: FieldValue.arrayRemove(id) });
        }
        for (const id of plan.loserCardIds) {
          await db.collection('binders').doc(defaultBinderId).update({ cardIds: FieldValue.arrayUnion(id) });
          moved++;
        }
      }

      if (JSON.stringify(plan.wishlistItems) !== JSON.stringify(wishlist.items)) {
        await db.collection('wishlists').doc(wishlist.id).update({ items: plan.wishlistItems });
      }

      result.synced++;
      result.moved += moved;
      result.changedCardEvents.push(
        ...plan.changedCardEvents.map(e => ({ ...e, binderId: binder.id, binderName: binder.name })),
      );
    } catch (e) {
      console.error('[template-binders] admin sync error', binder.id, e);
      result.errored++;
    }
  }
  return result;
}
