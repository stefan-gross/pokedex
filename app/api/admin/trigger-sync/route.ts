import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { runSync, getSyncStatus } from '@/lib/sync-catalog';


export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await getSyncStatus());
  } catch (err) {
    console.error('[trigger-sync GET]', err);
    return NextResponse.json({ error: String(err), syncedTotal: 0, currentTotal: 0, newCards: 0 }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const mode = (req.nextUrl.searchParams.get('mode') ?? 'auto') as 'auto' | 'update' | 'reset';
    const result = await runSync(mode);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[trigger-sync POST]', err);
    return NextResponse.json({ error: String(err), message: `Fehler: ${String(err)}` }, { status: 500 });
  }
}
