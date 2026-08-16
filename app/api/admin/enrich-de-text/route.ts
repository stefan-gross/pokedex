import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { enrichCardMechanics } from '@/lib/sync-catalog';

// Pro Aufruf werden Karten einzeln gegen /de/cards/{id} geholt → etwas langsamer,
// daher kleinere Batches + volle Zeitbudget-Ausschöpfung.
export const maxDuration = 60;


export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await enrichCardMechanics(150));
  } catch (e) {
    console.error('[enrich-de-text]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
