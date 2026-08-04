import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { syncNewCards } from '@/lib/sync-catalog';

// Gezieltes Nachziehen kann bei größeren Deltas etwas dauern (Set-Scan + Fetch).
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
    return NextResponse.json(await syncNewCards());
  } catch (err) {
    console.error('[sync-new POST]', err);
    return NextResponse.json({ status: 'error', added: 0, done: true, message: `Fehler: ${String(err)}` }, { status: 500 });
  }
}
