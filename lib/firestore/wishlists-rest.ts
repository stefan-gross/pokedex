/** REST-Variante von getWishlists() (wishlists.ts) — siehe rest-shared.ts.
 *  Owner-scoped; die manuell-vor-automatisch-Sortierung passiert beim Aufrufer
 *  bzw. im SDK-Pfad — hier nur nach createdAt (in-memory, kein Index). */
import type { WishlistDoc } from '@/types';
import { runFirestoreQuery, restOwnerUid } from './rest-shared';

export async function getWishlistsRest(): Promise<WishlistDoc[]> {
  const uid = await restOwnerUid();
  if (!uid) return [];
  const rows = await runFirestoreQuery<WishlistDoc>({
    from: [{ collectionId: 'wishlists' }],
    where: { fieldFilter: { field: { fieldPath: 'ownerUid' }, op: 'EQUAL', value: { stringValue: uid } } },
  });
  return rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
}
