import { NextRequest, NextResponse } from 'next/server';

// Vercel ruft diesen Cron täglich auf — er triggert einen Sync-Schritt (1 Seite = 250 Karten)
// Nach ~82 Tagen sind alle Karten einmalig synchronisiert.
// Danach hält der Cron die Daten aktuell (neue Sets werden automatisch nachgezogen).

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://pokedex.smartfamilyzone.de';
    const res = await fetch(`${baseUrl}/api/admin/sync`, {
      method: 'POST',
      headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
    });
    const result = await res.json();
    console.log('[cron] sync-catalog:', result.message);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
