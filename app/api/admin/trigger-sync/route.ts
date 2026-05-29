import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { runSync, getSyncStatus } from '@/lib/sync-catalog';

async function verifySession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return !!(await verifySessionToken(token));
}

export async function GET(req: NextRequest) {
  if (!(await verifySession(req))) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  }
  try {
    return NextResponse.json(await getSyncStatus());
  } catch (err) {
    console.error('[trigger-sync GET]', err);
    return NextResponse.json({ error: String(err), syncedTotal: 0, currentTotal: 0, newCards: 0 }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await verifySession(req))) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  }
  try {
    const mode = (req.nextUrl.searchParams.get('mode') ?? 'auto') as 'auto' | 'update';
    const result = await runSync(mode);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[trigger-sync POST]', err);
    return NextResponse.json({ error: String(err), message: `Fehler: ${String(err)}` }, { status: 500 });
  }
}
