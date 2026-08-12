import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { enrichDeMechanics } from '@/lib/sync-catalog';

// Pro Aufruf werden Karten einzeln gegen /de/cards/{id} geholt → etwas langsamer,
// daher kleinere Batches + volle Zeitbudget-Ausschöpfung.
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
    return NextResponse.json(await enrichDeMechanics(150));
  } catch (e) {
    console.error('[enrich-de-text]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
