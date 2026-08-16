/** REST-Variante von getBinders() (binders.ts) — siehe rest-shared.ts.
 *  Owner-scoped + In-Memory-Sortierung (kein Composite-Index). */
import type { BinderDoc } from '@/types';
import { runFirestoreQuery, restOwnerUid } from './rest-shared';

export async function getBindersRest(): Promise<BinderDoc[]> {
  const uid = await restOwnerUid();
  if (!uid) return [];
  const rows = await runFirestoreQuery<BinderDoc>({
    from: [{ collectionId: 'binders' }],
    where: { fieldFilter: { field: { fieldPath: 'ownerUid' }, op: 'EQUAL', value: { stringValue: uid } } },
  });
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}
