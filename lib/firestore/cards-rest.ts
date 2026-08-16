/** REST-Variante von getCards() (cards.ts) — siehe rest-shared.ts für den
 *  Hintergrund. Owner-scoped (ownerUid == eigene uid), damit die neuen Rules
 *  (IDOR-Härtung) die Query zulassen. Nur ein Gleichheitsfilter + In-Memory-
 *  Sortierung → kein Composite-Index nötig. */
import type { CardDoc } from '@/types';
import { runFirestoreQuery, restOwnerUid } from './rest-shared';

export async function getCardsRest(): Promise<CardDoc[]> {
  const uid = await restOwnerUid();
  if (!uid) return [];
  const rows = await runFirestoreQuery<CardDoc>({
    from: [{ collectionId: 'cards' }],
    where: { fieldFilter: { field: { fieldPath: 'ownerUid' }, op: 'EQUAL', value: { stringValue: uid } } },
  });
  return rows.sort((a, b) => (b.addedAt?.seconds ?? 0) - (a.addedAt?.seconds ?? 0));
}
