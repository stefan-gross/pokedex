import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { getAdminDb } from '@/lib/firebase/admin';

export const maxDuration = 30;

/**
 * Aggregiert `scan_events` (alle Nutzer) für die periodische Scanner-Optimierung:
 * Erkennungsrate, Mittelwerte je Outcome (Schärfe/Glare/pHash/Gemini-Latenz),
 * Confidence-Verteilung. Read-only, Admin-geschützt.
 *
 * GET /api/admin/scan-stats
 */
export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const db = getAdminDb();
    const snap = await db.collection('scan_events').get();

    const outcomes: Record<string, { count: number; sharpness: number[]; glare: number[]; pHash: number[]; geminiMs: number[] }> = {};
    const confidence: Record<string, number> = {};
    let total = 0, reportedWrong = 0;

    for (const d of snap.docs) {
      const e = d.data();
      total++;
      const oc = String(e.outcome ?? 'unknown');
      const o = outcomes[oc] ?? (outcomes[oc] = { count: 0, sharpness: [], glare: [], pHash: [], geminiMs: [] });
      o.count++;
      const q = e.quality ?? {};
      if (typeof q.sharpness === 'number') o.sharpness.push(q.sharpness);
      if (typeof q.glare === 'number') o.glare.push(q.glare);
      if (typeof e.pHashDistance === 'number') o.pHash.push(e.pHashDistance);
      if (typeof e.gemini?.ms === 'number') o.geminiMs.push(e.gemini.ms);
      const conf = String(e.gemini?.confidence ?? 'none');
      confidence[conf] = (confidence[conf] ?? 0) + 1;
      if (e.reportedWrong) reportedWrong++;
    }

    const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : null);
    const byOutcome = Object.fromEntries(Object.entries(outcomes).map(([k, o]) => [k, {
      count: o.count,
      share: total ? Math.round((o.count / total) * 1000) / 10 : 0,
      avgSharpness: avg(o.sharpness), avgGlare: avg(o.glare), avgPHash: avg(o.pHash), avgGeminiMs: avg(o.geminiMs),
    }]));

    const recognized = outcomes['recognized']?.count ?? 0;
    return NextResponse.json({
      total,
      recognitionRate: total ? Math.round((recognized / total) * 1000) / 10 : 0,
      reportedWrong,
      byOutcome,
      confidence,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
