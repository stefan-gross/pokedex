/**
 * Aggregiert je Pokémon-Region die Karten- UND Artenzahl (verschiedene
 * Pokédex-Nummern) aus `tcg_catalog` in EIN Firestore-Doc (`meta/region_stats`).
 * Firestore kann „distinct" nicht zählen → einmalige Vorberechnung (Admin/Lokal,
 * wie der Katalog-Sync). Der Client liest nur dieses eine Doc.
 */
import { getAdminDb } from './firebase/admin';

export interface RegionStat { cards: number; species: number }
export interface RegionStats {
  /** region → { cards, species } */
  byRegion: Record<string, RegionStat>;
  updatedAt: number;
}

export async function buildRegionStats(): Promise<RegionStats> {
  const db = getAdminDb();

  const cards: Record<string, number> = {};
  const dex: Record<string, Set<number>> = {};

  const col = db.collection('tcg_catalog').select('region', 'nationalDexNumber').orderBy('__name__');
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = col.limit(5000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const c = d.data() as { region?: string; nationalDexNumber?: number };
      const r = c.region;
      if (!r) continue;
      cards[r] = (cards[r] ?? 0) + 1;
      if (typeof c.nationalDexNumber === 'number') {
        (dex[r] ??= new Set()).add(c.nationalDexNumber);
      }
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 5000) break;
  }

  const byRegion: Record<string, RegionStat> = {};
  for (const r of Object.keys(cards)) {
    byRegion[r] = { cards: cards[r], species: dex[r]?.size ?? 0 };
  }

  const stats: RegionStats = { byRegion, updatedAt: Date.now() };
  await db.collection('meta').doc('region_stats').set(stats);
  return stats;
}
