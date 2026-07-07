import { NextRequest, NextResponse } from 'next/server';
import { ensureFreshPrice } from '@/lib/prices/cache';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tcgId = url.searchParams.get('tcgId');
  const force = url.searchParams.get('force') === '1';
  if (!tcgId) {
    return NextResponse.json({ error: 'tcgId required' }, { status: 400 });
  }

  const result = await ensureFreshPrice(tcgId, force);
  if (!result) {
    return NextResponse.json({ error: 'No price data available' }, { status: 404 });
  }
  return NextResponse.json(result);
}
