import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { syncNewCards } from '@/lib/sync-catalog';

// Gezieltes Nachziehen kann bei größeren Deltas etwas dauern (Set-Scan + Fetch).
export const maxDuration = 60;


export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await syncNewCards());
  } catch (err) {
    console.error('[sync-new POST]', err);
    return NextResponse.json({ status: 'error', added: 0, done: true, message: `Fehler: ${String(err)}` }, { status: 500 });
  }
}
