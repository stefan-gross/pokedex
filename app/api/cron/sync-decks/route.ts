import { NextRequest, NextResponse } from 'next/server';
import { syncDecksAdmin } from '@/lib/decks/sync-admin';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await syncDecksAdmin();
  console.log(`[cron/sync-decks] synced=${result.synced} errored=${result.errored}`);
  return NextResponse.json(result);
}
