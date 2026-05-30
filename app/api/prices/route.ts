import { NextRequest, NextResponse } from 'next/server';
import { activeProvider } from '@/lib/prices';

export async function GET(req: NextRequest) {
  const tcgId = new URL(req.url).searchParams.get('tcgId');
  if (!tcgId) {
    return NextResponse.json({ error: 'tcgId required' }, { status: 400 });
  }

  const result = await activeProvider.fetchPrices(tcgId);
  if (!result) {
    return NextResponse.json({ error: 'No price data available' }, { status: 404 });
  }

  return NextResponse.json(result);
}
