import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { backfillSetCodes } from '@/lib/sync-catalog';

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
    const result = await backfillSetCodes();
    return NextResponse.json(result);
  } catch (e) {
    console.error('[backfill-set-codes]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
