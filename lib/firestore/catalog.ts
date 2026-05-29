import {
  collection, doc, getDocs, setDoc, getDoc,
  query, where, limit, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/client';

export interface CatalogCard {
  id: string;
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

export interface SyncMeta {
  lastPage: number;
  totalPages: number;
  syncedTotal: number;   // wie viele Karten wir in Firestore haben
  currentTotal: number;  // wie viele Karten pokemontcg.io hat
  lastSynced: string;
}

const COL = 'tcg_catalog';

// Prefix-Suche nach Name (case-insensitive) — liest nur Treffer, nicht die gesamte Collection
export async function searchCatalog(q: string, setId = '', maxResults = 80): Promise<CatalogCard[]> {
  const lower = q.toLowerCase();
  const end = lower + ''; // Unicode-Trick für Prefix-Range

  const constraints = setId
    ? [where('setId', '==', setId), where('nameLower', '>=', lower), where('nameLower', '<=', end), limit(maxResults)]
    : [where('nameLower', '>=', lower), where('nameLower', '<=', end), limit(maxResults)];

  const snap = await getDocs(query(collection(db, COL), ...constraints));
  return snap.docs.map(d => d.data() as CatalogCard);
}

// Batch-Upsert (Firestore max 500 pro Batch)
export async function upsertCatalogBatch(cards: CatalogCard[]): Promise<void> {
  const chunks = [];
  for (let i = 0; i < cards.length; i += 500) chunks.push(cards.slice(i, i + 500));
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach(card => batch.set(doc(db, COL, card.id), card, { merge: true }));
    await batch.commit();
  }
}

// Sync-Metadaten
export async function getSyncMeta(): Promise<SyncMeta | null> {
  const snap = await getDoc(doc(db, 'tcg_catalog_meta', 'sync'));
  return snap.exists() ? (snap.data() as SyncMeta) : null;
}

export async function setSyncMeta(data: Partial<SyncMeta>): Promise<void> {
  await setDoc(doc(db, 'tcg_catalog_meta', 'sync'), data, { merge: true });
}

// Wie viele Karten sind bereits gecacht?
export async function getCatalogCount(): Promise<number> {
  const meta = await getSyncMeta();
  return meta?.syncedTotal ?? 0;
}
