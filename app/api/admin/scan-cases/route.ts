import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { getAdminDb } from '@/lib/firebase/admin';

export const maxDuration = 30;

/**
 * Listet den Fehler-/Melde-Korpus (`scan_cases`, alle Nutzer) für die
 * Batch-Analyse. Standardmäßig OHNE die großen base64-Bilder (nur Metadaten +
 * Debug); mit `?withImages=1` inkl. Bilder. Read-only, Admin-geschützt.
 *
 * GET /api/admin/scan-cases[?withImages=1][&limit=200]
 */
export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const db = getAdminDb();
    const withImages = req.nextUrl.searchParams.get('withImages') === '1';
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 200, 1), 1000);

    const snap = await db.collection('scan_cases').get();
    const cases = snap.docs
      .map(d => {
        const c = d.data() as Record<string, unknown>;
        if (!withImages) { delete c.warpedCropBase64; delete c.originalFrameBase64; }
        return { id: d.id, ...c };
      })
      .sort((a, b) => (((b as Record<string, unknown>).ts as number) ?? 0) - (((a as Record<string, unknown>).ts as number) ?? 0))
      .slice(0, limit);

    return NextResponse.json({ count: cases.length, withImages, cases });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
