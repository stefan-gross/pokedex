import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { enrichSpeciesData } from '@/lib/sync-catalog';

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
    const result = await enrichSpeciesData(500);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[enrich-species]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
