/**
 * Admin-Route: Region-Statistik bauen (→ meta/region_stats: Karten + Arten je
 * Region). Geschützt via requireAdmin. Lokal ausführen (Vercel fehlen Admin-Env).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { buildRegionStats } from '@/lib/build-region-stats';

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const result = await buildRegionStats();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'build failed' }, { status: 500 });
  }
}
