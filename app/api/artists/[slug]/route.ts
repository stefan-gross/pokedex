import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { ARTISTS_COL, type ArtistProfile } from '@/lib/firestore/artists';

/** Gecachtes Illustrator-Profil lesen (read-only; hinter der App-Auth via proxy). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const snap = await getAdminDb().collection(ARTISTS_COL).doc(slug).get();
    if (!snap.exists) return NextResponse.json({ profile: null }, { status: 404 });
    return NextResponse.json({ profile: snap.data() as ArtistProfile });
  } catch (e) {
    console.error('[api/artists]', slug, e);
    return NextResponse.json({ profile: null }, { status: 500 });
  }
}
