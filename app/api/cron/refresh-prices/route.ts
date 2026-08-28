import { NextRequest, NextResponse } from 'next/server';
import { refreshAllOwnedAndStale } from '@/lib/prices/cache';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await refreshAllOwnedAndStale();
  console.log(`[cron/refresh-prices] refreshed=${result.refreshed} upgraded=${result.upgraded} errored=${result.errored} total=${result.total}`);
  return NextResponse.json(result);
}
