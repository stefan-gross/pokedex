import { NextRequest, NextResponse } from 'next/server';
import { runSync, getSyncStatus } from '@/lib/sync-catalog';

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const status = await getSyncStatus();
  const mode = status.syncedTotal < status.currentTotal ? 'auto' : 'update';
  const result = await runSync(mode);
  console.log(`[cron] sync-catalog (${mode}):`, result.message);
  return NextResponse.json({ mode, ...result });
}
