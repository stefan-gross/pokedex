import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');

  try {
    const db = getAdminDb();

    if (id) {
      const snap = await db.collection('tcg_sets').doc(id).get();
      if (!snap.exists) return NextResponse.json({ error: 'Set not found' }, { status: 404 });
      return NextResponse.json({ data: snap.data() });
    }

    const snap = await db.collection('tcg_sets').orderBy('releaseDate', 'desc').get();
    const sets = snap.docs.map(d => d.data());
    return NextResponse.json({ data: sets });

  } catch (e) {
    console.error('[api/sets]', e);
    return NextResponse.json({ error: 'Failed to fetch set(s)' }, { status: 500 });
  }
}
