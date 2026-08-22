import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { getAdminDb } from '@/lib/firebase/admin';

export const maxDuration = 60;

/**
 * Löscht ein einzelnes Katalog-Set (`tcg_sets/{setId}` + alle `tcg_catalog`-
 * Karten mit diesem `setId`). Gedacht zum Bereinigen VERALTETER Sets, die es in
 * TCGdex nicht (mehr) gibt — der reguläre Sync legt sie nur an/aktualisiert sie,
 * entfernt aber nie verwaiste Alt-Sets.
 *
 * Sicherheit:
 *  - Nur Admin (isAdminRequest: x-cron-secret ODER ADMIN_UIDS-Session).
 *  - Standardmäßig NUR löschen, wenn das Set in TCGdex **nicht** existiert
 *    (HTTP 404) → verhindert versehentliches Löschen echter Sets. Mit `?force=1`
 *    lässt sich das überschreiben.
 *
 * POST /api/admin/delete-set?setId=swsh12.5tg[&force=1]
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const setId = req.nextUrl.searchParams.get('setId')?.trim();
  if (!setId) {
    return NextResponse.json({ error: 'setId erforderlich' }, { status: 400 });
  }
  const force = req.nextUrl.searchParams.get('force') === '1';

  // Sicherheitscheck: existiert das Set in TCGdex? Dann NICHT löschen (außer force).
  if (!force) {
    try {
      const r = await fetch(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(setId)}`);
      if (r.ok) {
        return NextResponse.json(
          { error: `Set "${setId}" existiert in TCGdex — nicht gelöscht. Mit ?force=1 erzwingen.` },
          { status: 409 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'TCGdex-Prüfung fehlgeschlagen — Abbruch (mit ?force=1 überspringbar).' },
        { status: 502 },
      );
    }
  }

  try {
    const db = getAdminDb();
    let deletedCards = 0;
    // Karten gebatcht löschen (bis leer).
    for (;;) {
      const snap = await db.collection('tcg_catalog').where('setId', '==', setId).limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      deletedCards += snap.size;
      if (snap.size < 400) break;
    }
    const setDoc = await db.collection('tcg_sets').doc(setId).get();
    const setExisted = setDoc.exists;
    if (setExisted) await db.collection('tcg_sets').doc(setId).delete();
    return NextResponse.json({ setId, deletedCards, setDeleted: setExisted, done: true });
  } catch (err) {
    console.error('[delete-set]', err);
    return NextResponse.json({ error: String(err), done: false }, { status: 500 });
  }
}
