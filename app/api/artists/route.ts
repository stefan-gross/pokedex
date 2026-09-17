import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { ARTISTS_COL } from '@/lib/firestore/artists';

/** Leichte Illustrator-Liste (nur Name + Foto) für den „Illustrator"-Such-Scope
 *  in /collection. Read-only, hinter der App-Auth via proxy. */
export async function GET() {
  try {
    const snap = await getAdminDb().collection(ARTISTS_COL).select('name', 'photoUrl').get();
    const artists = snap.docs
      .map(d => ({ slug: d.id, name: (d.data().name as string) ?? d.id, photoUrl: (d.data().photoUrl as string | null) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return NextResponse.json({ artists });
  } catch (e) {
    console.error('[api/artists list]', e);
    return NextResponse.json({ artists: [] }, { status: 500 });
  }
}
