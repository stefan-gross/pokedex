import { NextRequest, NextResponse } from 'next/server';
import { syncTemplateBindersAdmin } from '@/lib/template-binders/sync-admin';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await syncTemplateBindersAdmin();
  console.log(`[cron/sync-template-binders] synced=${result.synced} moved=${result.moved} errored=${result.errored}`);
  return NextResponse.json(result);
}
