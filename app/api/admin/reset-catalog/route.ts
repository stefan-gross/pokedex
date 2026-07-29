import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Firestore } from 'firebase-admin/firestore';

export const maxDuration = 60;

async function verifySession(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return !!(await verifySessionToken(token));
}

/** Löscht eine Collection gebatcht bis leer ODER Zeitbudget erreicht. */
async function deleteCollection(db: Firestore, name: string, budgetEndMs: number): Promise<{ deleted: number; remaining: boolean }> {
  let deleted = 0;
  while (Date.now() < budgetEndMs) {
    const snap = await db.collection(name).limit(400).get();
    if (snap.empty) return { deleted, remaining: false };
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < 400) return { deleted, remaining: false };
  }
  return { deleted, remaining: true };
}

/**
 * TCGdex-Migration / Go-Live-Reset. Leert den Katalog (`tcg_catalog`,
 * `tcg_sets`, `tcg_catalog_meta`) für den Neu-Import. Mit `?scope=all`
 * ZUSÄTZLICH die Nutzerdaten (`cards`, `binders`, `wishlists`) — destruktiv,
 * deshalb hinter einem expliziten Parameter. Resumierbar: wiederholt aufrufen,
 * bis `done: true` (bei sehr großen Collections greift das Zeitbudget).
 */
export async function POST(req: NextRequest) {
  if (!(await verifySession(req))) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  }
  const all = req.nextUrl.searchParams.get('scope') === 'all';
  const cols = all
    ? ['cards', 'binders', 'wishlists', 'tcg_catalog', 'tcg_sets', 'tcg_catalog_meta']
    : ['tcg_catalog', 'tcg_sets', 'tcg_catalog_meta'];

  try {
    const db = getAdminDb();
    const budgetEnd = Date.now() + 50_000;
    const deleted: Record<string, number> = {};
    let remaining = false;
    for (const c of cols) {
      if (Date.now() >= budgetEnd) { remaining = true; break; }
      const r = await deleteCollection(db, c, budgetEnd);
      deleted[c] = r.deleted;
      if (r.remaining) remaining = true;
    }
    return NextResponse.json({ deleted, done: !remaining });
  } catch (err) {
    console.error('[reset-catalog]', err);
    return NextResponse.json({ error: String(err), done: false }, { status: 500 });
  }
}
