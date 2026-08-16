import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { syncSets } from '@/lib/sync-catalog';


export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await syncSets();
    return NextResponse.json(result);
  } catch (e) {
    console.error('[sync-sets]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
