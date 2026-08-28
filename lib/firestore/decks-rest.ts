/** REST-Variante von getDecks() (decks.ts) — siehe rest-shared.ts für den
 *  Hintergrund (WebChannel-Cold-Start-Workaround). Owner-scoped (ownerUid ==
 *  eigene uid), damit die Rules die Query zulassen. Nur ein Gleichheitsfilter
 *  + In-Memory-Sortierung → kein Composite-Index nötig. */
import type { DeckDoc } from '@/types';
import { runFirestoreQuery, restOwnerUid } from './rest-shared';

export async function getDecksRest(): Promise<DeckDoc[]> {
  const uid = await restOwnerUid();
  if (!uid) return [];
  const rows = await runFirestoreQuery<DeckDoc>({
    from: [{ collectionId: 'decks' }],
    where: { fieldFilter: { field: { fieldPath: 'ownerUid' }, op: 'EQUAL', value: { stringValue: uid } } },
  });
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}
