/** REST-Variante von getWishlists() (wishlists.ts) — siehe rest-shared.ts. */
import type { WishlistDoc } from '@/types';
import { runFirestoreQuery } from './rest-shared';

export async function getWishlistsRest(): Promise<WishlistDoc[]> {
  return runFirestoreQuery<WishlistDoc>({
    from: [{ collectionId: 'wishlists' }],
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
  });
}
