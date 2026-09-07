/** Liest die vorberechnete Region-Statistik (Karten + Arten je Region) aus
 *  `meta/region_stats` via Client-SDK (öffentliche Read-Rule). */
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { RegionStats } from '@/lib/build-region-stats';

export async function getRegionStats(): Promise<RegionStats['byRegion'] | null> {
  try {
    const snap = await getDoc(doc(db, 'meta', 'region_stats'));
    if (!snap.exists()) return null;
    const data = snap.data() as RegionStats;
    return data?.byRegion ?? null;
  } catch { return null; }
}
