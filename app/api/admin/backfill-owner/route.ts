import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Firestore } from 'firebase-admin/firestore';

export const maxDuration = 60;

const USER_COLLECTIONS = ['cards', 'binders', 'wishlists', 'scan_history'];

/** Setzt `ownerUid` auf allen Docs einer Collection, die es noch nicht haben. */
async function backfill(db: Firestore, name: string, uid: string, budgetEndMs: number): Promise<{ updated: number; skipped: number; remaining: boolean }> {
  let updated = 0, skipped = 0;
  const snap = await db.collection(name).get();
  let batch = db.batch();
  let inBatch = 0;
  for (const d of snap.docs) {
    if (Date.now() >= budgetEndMs) return { updated, skipped, remaining: true };
    if (d.get('ownerUid')) { skipped++; continue; }
    batch.update(d.ref, { ownerUid: uid });
    updated++; inBatch++;
    if (inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
  }
  if (inBatch > 0) await batch.commit();
  return { updated, skipped, remaining: false };
}

/**
 * Einmalige IDOR-Migration (Phase 1): stempelt `ownerUid` auf alle bestehenden
 * Nutzer-Dokumente (cards/binders/wishlists/scan_history), die noch keinen
 * Besitzer haben. Ziel-uid via `?uid=` oder erster Eintrag aus `ADMIN_UIDS`.
 * Idempotent (bereits gesetzte Docs werden übersprungen) und resumierbar
 * (erneut aufrufen bei `done: false`). Danach kann Phase 2 (Reads nach ownerUid
 * filtern + Rules) sicher live gehen.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const uid = req.nextUrl.searchParams.get('uid')
    ?? (process.env.ADMIN_UIDS ?? '').split(',').map(s => s.trim()).filter(Boolean)[0];
  if (!uid) {
    return NextResponse.json({ error: 'uid fehlt (?uid= oder ADMIN_UIDS setzen)' }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const budgetEnd = Date.now() + 50_000;
    const result: Record<string, { updated: number; skipped: number }> = {};
    let remaining = false;
    for (const c of USER_COLLECTIONS) {
      if (Date.now() >= budgetEnd) { remaining = true; break; }
      const r = await backfill(db, c, uid, budgetEnd);
      result[c] = { updated: r.updated, skipped: r.skipped };
      if (r.remaining) remaining = true;
    }
    return NextResponse.json({ uid, result, done: !remaining });
  } catch (err) {
    console.error('[backfill-owner]', err);
    return NextResponse.json({ error: String(err), done: false }, { status: 500 });
  }
}
