import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { enrichSpeciesData } from '@/lib/sync-catalog';


export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await enrichSpeciesData(500);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[enrich-species]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
