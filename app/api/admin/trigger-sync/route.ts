import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { runSync, getSyncStatus } from '@/lib/sync-catalog';

async function verifySession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return !!(await verifySessionToken(token));
}

// GET → Status abfragen
export async function GET(req: NextRequest) {
  if (!(await verifySession(req))) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  }
  return NextResponse.json(await getSyncStatus());
}

// POST → Sync auslösen
export async function POST(req: NextRequest) {
  if (!(await verifySession(req))) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  }
  const mode = (req.nextUrl.searchParams.get('mode') ?? 'auto') as 'auto' | 'update';
  const result = await runSync(mode);
  return NextResponse.json(result);
}
