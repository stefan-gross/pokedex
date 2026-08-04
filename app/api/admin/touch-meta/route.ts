import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { touchSyncMeta } from '@/lib/sync-catalog';

async function verifySession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return !!(await verifySessionToken(token));
}

// Stempelt das Ende eines "Daten aktualisieren"-Laufs (lastChecked immer,
// lastSynced nur bei `changed:true`).
export async function POST(req: NextRequest) {
  if (!(await verifySession(req))) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  await touchSyncMeta(body?.changed === true);
  return NextResponse.json({ ok: true });
}
