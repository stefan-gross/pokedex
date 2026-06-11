import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { activeProvider } from '@/lib/prices';
import { getAdminDb } from '@/lib/firebase/admin';
import type { PriceResult } from '@/lib/prices/types';

/** TTL: nach 24 h gilt der gecachte Preis als stale → Live-Refresh. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Shape von `tcg_catalog.{tcgId}.cardmarket`. */
interface CachedCardmarket {
  cachedAt: Timestamp;
  updatedAt?: string;
  variants?: PriceResult['variants'];
  /** Wenn der Provider `null` zurückgibt (z. B. keine Cardmarket-Daten),
   *  speichern wir trotzdem cachedAt, damit der TTL-Check greift und
   *  nicht jede Anzeige erneut probiert. */
  empty?: boolean;
}

function isFresh(c: CachedCardmarket | undefined): boolean {
  if (!c?.cachedAt) return false;
  const age = Date.now() - c.cachedAt.toMillis();
  return age < CACHE_TTL_MS;
}

function toResult(c: CachedCardmarket): PriceResult | null {
  if (c.empty || !c.variants || c.variants.length === 0) return null;
  return {
    provider: 'cardmarket',
    currency: 'EUR',
    updatedAt: c.updatedAt,
    variants: c.variants,
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tcgId = url.searchParams.get('tcgId');
  const force = url.searchParams.get('force') === '1';
  if (!tcgId) {
    return NextResponse.json({ error: 'tcgId required' }, { status: 400 });
  }

  const db = getAdminDb();
  const docRef = db.collection('tcg_catalog').doc(tcgId);

  // 1) Cache-Lookup
  if (!force) {
    try {
      const snap = await docRef.get();
      const cached = snap.data()?.cardmarket as CachedCardmarket | undefined;
      if (cached && isFresh(cached)) {
        const result = toResult(cached);
        if (result) return NextResponse.json(result);
        return NextResponse.json({ error: 'No price data available' }, { status: 404 });
      }
    } catch (e) {
      console.warn('[prices] cache read error', e);
    }
  }

  // 2) Live-Fetch
  const live = await activeProvider.fetchPrices(tcgId);

  // 3) Cache-Write (auch bei null → empty:true, damit TTL greift)
  try {
    const cachedAt = Timestamp.now();
    if (live) {
      await docRef.set({
        cardmarket: {
          cachedAt,
          updatedAt: live.updatedAt ?? null,
          variants: live.variants,
          empty: false,
        },
      }, { merge: true });
    } else {
      await docRef.set({
        cardmarket: {
          cachedAt,
          empty: true,
        },
      }, { merge: true });
    }
  } catch (e) {
    console.warn('[prices] cache write error', e);
  }

  if (!live) {
    return NextResponse.json({ error: 'No price data available' }, { status: 404 });
  }
  return NextResponse.json(live);
}
