import { NextRequest, NextResponse } from 'next/server';
import { enrichCardMechanics } from '@/lib/sync-catalog';

// Cron-artiger Endpoint (Middleware lässt /api/cron durch, siehe proxy.ts):
// pro Aufruf ein Batch TCG-Mechanik (REST /de/cards, Fallback /en/). Per
// Bearer CRON_SECRET geschützt — so lokal per curl-Schleife fahrbar,
// unabhängig von der (kurzlebigen) Browser-Session.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await enrichCardMechanics(150);
  console.log('[cron] enrich-mechanics:', result.message);
  return NextResponse.json(result);
}
