import {
  collection, doc, getDocs, setDoc, getDoc,
  query, where, orderBy, limit, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/client';

export interface CatalogCard {
  id: string;           // pokemontcg.io ID
  name: string;
  nameLower: string;    // für case-insensitive Prefix-Suche
  number: string;
  setId: string;
  setName: string;
  series: string;
  rarity: string;
  supertype: string;
  types: string[];
  imgSmall: string;
  imgLarge: string;
}

const COL = 'tcg_catalog';
const META_DOC = 'tcg_catalog_meta';

// Prefix-Suche nach Name (case-insensitive)
export async function searchCatalog(q: string, setId = '', maxResults = 60): Promise<CatalogCard[]> {
  const lower = q.toLowerCase();
  let qRef = query(
    collection(db, COL),
    where('nameLower', '>=', lower),
    where('nameLower', '<=', lower + ''),
    limit(maxResults)
  );
  if (setId) {
    qRef = query(
      collection(db, COL),
      where('setId', '==', setId),
      where('nameLower', '>=', lower),
      where('nameLower', '<=', lower + ''),
      limit(maxResults)
    );
  }
  const snap = await getDocs(qRef);
  return snap.docs.map(d => d.data() as CatalogCard);
}

// Batch-Upsert (max 500 pro Aufruf)
export async function upsertCatalogBatch(cards: CatalogCard[]): Promise<void> {
  const batch = writeBatch(db);
  for (const card of cards.slice(0, 500)) {
    const ref = doc(db, COL, card.id);
    batch.set(ref, card, { merge: true });
  }
  await batch.commit();
}

// Sync-Fortschritt lesen/schreiben
export async function getSyncMeta(): Promise<{ lastPage: number; totalPages: number; lastSynced: string } | null> {
  const snap = await getDoc(doc(db, 'tcg_catalog_meta', 'sync'));
  return snap.exists() ? snap.data() as { lastPage: number; totalPages: number; lastSynced: string } : null;
}

export async function setSyncMeta(data: { lastPage: number; totalPages: number; lastSynced: string }): Promise<void> {
  await setDoc(doc(db, 'tcg_catalog_meta', 'sync'), data, { merge: true });
}

export async function getCatalogCount(): Promise<number> {
  const meta = await getSyncMeta();
  return meta ? meta.lastPage * 250 : 0;
}
