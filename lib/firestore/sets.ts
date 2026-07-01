import { doc, getDoc, getDocs, collection, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase/client';

export interface TcgSet {
  id: string;
  name: string;
  nameDe?: string;
  series: string;
  total: number;
  printedTotal: number;
  ptcgoCode?: string;
  logoUrl: string;
  logoUrlEn?: string;
  symbolUrl?: string;
  releaseDate?: string;
  tcgdexId?: string;
}

const COL = 'tcg_sets';

export async function getSetById(setId: string): Promise<TcgSet | null> {
  const snap = await getDoc(doc(db, COL, setId));
  return snap.exists() ? (snap.data() as TcgSet) : null;
}

export async function getAllSets(): Promise<TcgSet[]> {
  const snap = await getDocs(query(collection(db, COL), orderBy('releaseDate', 'desc')));
  return snap.docs.map(d => d.data() as TcgSet);
}

export function filterSets(sets: TcgSet[], q: string): TcgSet[] {
  const lower = q.toLowerCase().trim();
  if (!lower) return sets;
  return sets.filter(s =>
    s.name.toLowerCase().includes(lower) ||
    s.nameDe?.toLowerCase().includes(lower) ||
    s.ptcgoCode?.toLowerCase().startsWith(lower),
  );
}
