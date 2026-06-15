import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { CachedPrices, isFresh, toResult, refreshAndCache } from '@/lib/prices/cache';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tcgId = url.searchParams.get('tcgId');
  const force = url.searchParams.get('force') === '1';
  if (!tcgId) {
    return NextResponse.json({ error: 'tcgId required' }, { status: 400 });
  }

  const db = getAdminDb();
  const docRef = db.collection('tcg_catalog').doc(tcgId);

  if (!force) {
    try {
      const snap = await docRef.get();
      const cached = snap.data()?.prices as CachedPrices | undefined;
      if (cached && isFresh(cached)) {
        const result = toResult(cached);
        if (result) return NextResponse.json(result);
        return NextResponse.json({ error: 'No price data available' }, { status: 404 });
      }
    } catch (e) {
      console.warn('[prices] cache read error', e);
    }
  }

  const live = await refreshAndCache(tcgId);
  if (!live) {
    return NextResponse.json({ error: 'No price data available' }, { status: 404 });
  }
  return NextResponse.json(live);
}
