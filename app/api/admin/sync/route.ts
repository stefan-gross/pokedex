import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { runSync, getSyncStatus } from '@/lib/sync-catalog';


export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const mode = (req.nextUrl.searchParams.get('mode') ?? 'auto') as 'auto' | 'update';
  return NextResponse.json(await runSync(mode));
}

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getSyncStatus());
}
