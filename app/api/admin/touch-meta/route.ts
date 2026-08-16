import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { touchSyncMeta } from '@/lib/sync-catalog';


// Stempelt das Ende eines "Daten aktualisieren"-Laufs (lastChecked immer,
// lastSynced nur bei `changed:true`).
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  await touchSyncMeta(body?.changed === true);
  return NextResponse.json({ ok: true });
}
