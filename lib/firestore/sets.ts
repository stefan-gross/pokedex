import { doc, getDoc, getDocs, collection, query, orderBy, where } from 'firebase/firestore';
import { db } from '../firebase/client';
import { getSetByIdRest, getAllSetsRest, getSetIdsByPrintedTotalRest } from './sets-rest';

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

// REST-first (kein WebChannel-Cold-Start); SDK nur als Fallback.
export async function getSetById(setId: string): Promise<TcgSet | null> {
  try {
    return await getSetByIdRest(setId);
  } catch {
    const snap = await getDoc(doc(db, COL, setId));
    return snap.exists() ? (snap.data() as TcgSet) : null;
  }
}

export async function getAllSets(): Promise<TcgSet[]> {
  try {
    return await getAllSetsRest();
  } catch {
    const snap = await getDocs(query(collection(db, COL), orderBy('releaseDate', 'desc')));
    return snap.docs.map(d => d.data() as TcgSet);
  }
}

/** Set-IDs mit exakt diesem gedruckten Gesamtumfang — für den Scanner-Pfad
 *  „printedTotal + Nummer → Set → Karte" (wenn kein Set-Kürzel gelesen wurde).
 *  `printedTotal` ist der Basis-Umfang eines Sets (z.B. Perfect Order = 88),
 *  also faktisch ein Set-Fingerabdruck — meist genau ein Set, selten mehrere. */
export async function getSetIdsByPrintedTotal(printedTotal: number): Promise<string[]> {
  try {
    return await getSetIdsByPrintedTotalRest(printedTotal);
  } catch {
    const snap = await getDocs(query(collection(db, COL), where('printedTotal', '==', printedTotal)));
    return snap.docs.map(d => d.id);
  }
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
