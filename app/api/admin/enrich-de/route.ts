import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { enrichDeData } from '@/lib/sync-catalog';

// Set-weiser DE-Backfill (ein /de/sets-Call pro Set) kann pro Aufruf etwas dauern.
export const maxDuration = 60;

async function verifySession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return !!(await verifySessionToken(token));
}

export async function POST(req: NextRequest) {
  if (!(await verifySession(req))) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  }
  try {
    return NextResponse.json(await enrichDeData(12));
  } catch (e) {
    console.error('[enrich-de]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
