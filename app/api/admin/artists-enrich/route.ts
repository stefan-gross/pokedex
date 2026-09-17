import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { enrichArtist } from '@/lib/artists/enrich';

export const maxDuration = 60;

/**
 * Illustrator-Profile anreichern (PokéWiki + Bulbapedia → Gemini → `artists/<slug>`).
 * POST { names: string[] } — sequenziell (Wiki-/Gemini-Rate-Limits schonen).
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const names: string[] = Array.isArray(body?.names) ? body.names.filter((x: unknown) => typeof x === 'string' && x.trim()) : [];
  if (names.length === 0) return NextResponse.json({ error: 'names[] required' }, { status: 400 });

  const results: { name: string; ok: boolean; hasPhoto?: boolean }[] = [];
  for (const name of names.slice(0, 25)) {
    try {
      const p = await enrichArtist(name);
      results.push({ name, ok: !!p, hasPhoto: !!p?.photoUrl });
    } catch (e) {
      console.error('[artists-enrich]', name, e);
      results.push({ name, ok: false });
    }
  }
  return NextResponse.json({ enriched: results.filter(r => r.ok).length, total: names.length, results });
}
