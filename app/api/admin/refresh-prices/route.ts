import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { refreshAllOwnedAndStale } from '@/lib/prices/cache';

// Sammlung + rollierender Katalog-Preis-Sweep (zeitbudgetiert, siehe cache.ts).
export const maxDuration = 60;


export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await refreshAllOwnedAndStale());
  } catch (e) {
    console.error('[admin/refresh-prices]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
