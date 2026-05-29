import { NextRequest, NextResponse } from 'next/server';

// Vercel Cron: täglich 3:00 Uhr
// - Ist der initiale Sync noch nicht fertig: holt die nächsten 19.000 Karten
// - Ist er fertig: prüft ob neue Karten da sind und holt nur den Unterschied

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://pokedex.smartfamilyzone.de';

    // Erst Status prüfen
    const statusRes = await fetch(`${baseUrl}/api/admin/sync`, {
      headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
    });
    const statusData = await statusRes.json();

    // Modus wählen: falls nicht vollständig → initial, sonst → nur neue Karten
    const mode = (statusData.newCards > 0 && statusData.syncedTotal < statusData.currentTotal)
      ? 'auto'    // Initialer Sync noch nicht fertig
      : 'update'; // Nur neue Karten prüfen

    const syncRes = await fetch(`${baseUrl}/api/admin/sync?mode=${mode}`, {
      method: 'POST',
      headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
    });
    const result = await syncRes.json();

    console.log(`[cron] sync-catalog (${mode}):`, result.message);
    return NextResponse.json({ mode, ...result });
  } catch (err) {
    console.error('[cron] sync-catalog error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
