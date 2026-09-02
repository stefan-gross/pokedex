/**
 * Admin-Route: Suggest-Index bauen (→ meta/suggest_index). Geschützt via
 * requireAdmin. Lokal ausführen (Vercel fehlen Admin-Env-Vars).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { buildSearchIndex } from '@/lib/build-search-index';

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const result = await buildSearchIndex();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'build failed' }, { status: 500 });
  }
}
