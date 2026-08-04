import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { refreshAllOwnedAndStale } from '@/lib/prices/cache';

// Sammlung + rollierender Katalog-Preis-Sweep (zeitbudgetiert, siehe cache.ts).
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
    return NextResponse.json(await refreshAllOwnedAndStale());
  } catch (e) {
    console.error('[admin/refresh-prices]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
