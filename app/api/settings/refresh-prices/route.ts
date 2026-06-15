import { NextResponse } from 'next/server';
import { refreshAllOwnedAndStale } from '@/lib/prices/cache';

export const maxDuration = 60;

/** Manueller Trigger aus den Settings — Auth läuft via Session-Cookie (proxy.ts schützt /api/*). */
export async function POST() {
  const result = await refreshAllOwnedAndStale();
  return NextResponse.json(result);
}
