/** REST-Variante von getCards() (cards.ts) — siehe rest-shared.ts für den
 *  Hintergrund. Rule `cards: allow read if request.auth != null` — das per
 *  getAuthHeader() geholte ID-Token macht den authentifizierten REST-Call
 *  möglich, ganz ohne Firestore-Web-SDK-Verbindung. */
import type { CardDoc } from '@/types';
import { runFirestoreQuery } from './rest-shared';

export async function getCardsRest(): Promise<CardDoc[]> {
  return runFirestoreQuery<CardDoc>({
    from: [{ collectionId: 'cards' }],
    orderBy: [{ field: { fieldPath: 'addedAt' }, direction: 'DESCENDING' }],
  });
}
