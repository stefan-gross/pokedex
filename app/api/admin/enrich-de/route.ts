import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { enrichDeData } from '@/lib/sync-catalog';

// Set-weiser DE-Backfill (ein /de/sets-Call pro Set) kann pro Aufruf etwas dauern.
export const maxDuration = 60;


export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await enrichDeData(12));
  } catch (e) {
    console.error('[enrich-de]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
