/**
 * Baut den Suggest-Index für Autosuggest + Fuzzy-Fallback: distinct Kartennamen
 * (DE+EN), Illustratoren und Sets aus `tcg_catalog`/`tcg_sets` in EIN Firestore-
 * Doc (`meta/suggest_index`). Der Client liest nur dieses eine Doc (gecacht) —
 * keine 23k-Reads pro Suche. Admin-/Lokal-Job (wie der Katalog-Sync).
 */
import { getAdminDb } from './firebase/admin';

export interface SuggestIndex {
  names: string[];     // distinct Anzeigenamen (DE + EN), gemischt
  artists: string[];   // distinct Illustratoren
  sets: { id: string; name: string; code: string }[];
  count: number;
  updatedAt: number;
}

export interface BuildResult {
  names: number;
  artists: number;
  sets: number;
  cardsScanned: number;
}

export async function buildSearchIndex(): Promise<BuildResult> {
  const db = getAdminDb();

  const names = new Set<string>();
  const artists = new Set<string>();
  let scanned = 0;

  // Paginierter Scan (nur benötigte Felder) über den ganzen Katalog.
  const col = db.collection('tcg_catalog').select('name', 'nameDe', 'artist').orderBy('__name__');
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = col.limit(5000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const c = d.data() as { name?: string; nameDe?: string; artist?: string };
      if (c.name) names.add(c.name.trim());
      if (c.nameDe) names.add(c.nameDe.trim());
      if (c.artist) artists.add(c.artist.trim());
    }
    scanned += snap.size;
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 5000) break;
  }

  // Sets (Name + Kürzel).
  const setsSnap = await db.collection('tcg_sets').select('name', 'nameDe', 'ptcgoCode').get();
  const sets = setsSnap.docs.map(d => {
    const s = d.data() as { name?: string; nameDe?: string; ptcgoCode?: string };
    return { id: d.id, name: (s.nameDe || s.name || d.id).trim(), code: (s.ptcgoCode || '').trim() };
  }).filter(s => s.name);

  const index: SuggestIndex = {
    names: [...names].sort((a, b) => a.localeCompare(b, 'de')),
    artists: [...artists].sort((a, b) => a.localeCompare(b, 'de')),
    sets: sets.sort((a, b) => a.name.localeCompare(b.name, 'de')),
    count: scanned,
    updatedAt: Date.now(),
  };

  await db.collection('meta').doc('suggest_index').set(index);

  return { names: index.names.length, artists: index.artists.length, sets: index.sets.length, cardsScanned: scanned };
}
