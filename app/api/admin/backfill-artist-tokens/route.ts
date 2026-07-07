import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { backfillArtistTokens } from '@/lib/sync-catalog';

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
    const result = await backfillArtistTokens();
    return NextResponse.json(result);
  } catch (e) {
    console.error('[backfill-artist-tokens]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
