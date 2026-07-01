import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { enrichDeImages } from '@/lib/sync-catalog';

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
    const body = await req.json().catch(() => ({}));
    const reset = body?.reset === true;
    const result = await enrichDeImages(500, reset);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[enrich-de-images]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
