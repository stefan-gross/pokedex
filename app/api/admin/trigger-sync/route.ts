import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';

// Wird von der Admin-UI aufgerufen — nutzt Session-Auth statt CRON_SECRET
// CRON_SECRET bleibt server-seitig und wird nie ans Frontend geschickt

export async function POST(req: NextRequest) {
  // Session prüfen (User muss eingeloggt sein)
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  const payload = await verifySessionToken(token);
  if (!payload) return NextResponse.json({ error: 'Session abgelaufen' }, { status: 401 });

  const mode = req.nextUrl.searchParams.get('mode') ?? 'auto';
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://pokedex.smartfamilyzone.de';

  // Intern den echten Sync-Endpoint aufrufen (mit Server-seitigem CRON_SECRET)
  const res = await fetch(`${baseUrl}/api/admin/sync?mode=${mode}`, {
    method: 'POST',
    headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
  });

  return NextResponse.json(await res.json());
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  const payload = await verifySessionToken(token);
  if (!payload) return NextResponse.json({ error: 'Session abgelaufen' }, { status: 401 });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://pokedex.smartfamilyzone.de';
  const res = await fetch(`${baseUrl}/api/admin/sync`, {
    headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
  });
  return NextResponse.json(await res.json());
}
