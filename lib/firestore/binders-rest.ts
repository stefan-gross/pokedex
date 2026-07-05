/** REST-Variante von getBinders() (binders.ts) — siehe rest-shared.ts. */
import type { BinderDoc } from '@/types';
import { runFirestoreQuery } from './rest-shared';

export async function getBindersRest(): Promise<BinderDoc[]> {
  return runFirestoreQuery<BinderDoc>({
    from: [{ collectionId: 'binders' }],
    orderBy: [{ field: { fieldPath: 'sortOrder' }, direction: 'ASCENDING' }],
  });
}
