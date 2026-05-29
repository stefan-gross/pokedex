import { NextRequest, NextResponse } from 'next/server';
import { runSync, getSyncStatus } from '@/lib/sync-catalog';

function authCheck(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret');
  return secret === process.env.CRON_SECRET;
}

export async function POST(req: NextRequest) {
  if (!authCheck(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const mode = (req.nextUrl.searchParams.get('mode') ?? 'auto') as 'auto' | 'update';
  return NextResponse.json(await runSync(mode));
}

export async function GET(req: NextRequest) {
  if (!authCheck(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getSyncStatus());
}
