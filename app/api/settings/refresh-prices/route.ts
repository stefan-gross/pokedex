import { NextResponse } from 'next/server';
import { refreshOwnedPrices } from '@/lib/prices/cache';

export const maxDuration = 60;

/** Manueller Trigger aus den Settings — Auth läuft via Session-Cookie
 *  (proxy.ts schützt /api/*). Nur die eigene Sammlung (gebündelt pro Set),
 *  damit der Request nicht ins Timeout läuft; der katalogweite Sweep bleibt
 *  dem nächtlichen Cron (`refreshAllOwnedAndStale`). */
export async function POST() {
  const result = await refreshOwnedPrices();
  return NextResponse.json(result);
}
