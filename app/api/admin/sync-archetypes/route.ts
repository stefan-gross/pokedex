/**
 * Admin-Route: Turnier-Archetypen von Limitless synchronisieren (→ deck_archetypes).
 * Geschützt via requireAdmin (ADMIN_UIDS-Session oder x-cron-secret). Lokal
 * ausführen (Vercel fehlen Admin-Env-Vars). Optional: ?limit= / ?top= / ?min=.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { syncArchetypes } from '@/lib/sync-archetypes';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const num = (k: string) => { const v = sp.get(k); return v ? Number(v) : undefined; };
  try {
    const result = await syncArchetypes({
      tournamentLimit: num('limit'),
      topPerTournament: num('top'),
      minPlayers: num('min'),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'sync failed' }, { status: 500 });
  }
}
