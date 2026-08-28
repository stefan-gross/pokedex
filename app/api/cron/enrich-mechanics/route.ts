import { NextRequest, NextResponse } from 'next/server';
import { enrichCardMechanics } from '@/lib/sync-catalog';

// Cron-artiger Endpoint (Middleware lässt /api/cron durch, siehe proxy.ts):
// TCG-Mechanik pro Karte (REST /de/cards, Fallback /en/). Per Bearer
// CRON_SECRET geschützt — so auch lokal per curl fahrbar, unabhängig von der
// (kurzlebigen) Browser-Session.
export const maxDuration = 60;

// Innerhalb eines Aufrufs mehrere Batches durchlaufen (bereits angereicherte
// Karten werden übersprungen → schnell), bis „complete" ODER das Zeitbudget
// erreicht ist. Der persistente Cursor setzt beim nächsten Cron-Lauf fort, sodass
// nach neuen Sets die frisch importierten Karten über ein paar Läufe Mechanik
// bekommen. `?once=1` erzwingt einen Einzel-Batch (für manuelles Schrittweise).
const TIME_BUDGET_MS = 50_000;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const once = req.nextUrl.searchParams.get('once') === '1';
  const deadline = Date.now() + TIME_BUDGET_MS;
  let last = await enrichCardMechanics(150);
  let calls = 1;
  let enriched = last.enriched;
  while (!once && last.status !== 'complete' && Date.now() < deadline) {
    last = await enrichCardMechanics(150);
    calls++;
    enriched += last.enriched;
  }
  console.log(`[cron] enrich-mechanics: ${calls} Batches, ${enriched} angereichert (${last.status})`);
  return NextResponse.json({ calls, enriched, status: last.status });
}
