/**
 * Liefert den Suggest-Index (meta/suggest_index) serverseitig (Admin SDK) an den
 * Client — so braucht die Collection keine öffentliche Firestore-Read-Rule.
 * Durch proxy.ts nur mit gültiger Session erreichbar. Client cacht das Ergebnis.
 */
import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import type { SuggestIndex } from '@/lib/build-search-index';

export async function GET() {
  try {
    const doc = await getAdminDb().collection('meta').doc('suggest_index').get();
    if (!doc.exists) return NextResponse.json({ names: [], artists: [], sets: [], count: 0, updatedAt: 0 } as SuggestIndex);
    return NextResponse.json(doc.data() as SuggestIndex, {
      headers: { 'Cache-Control': 'private, max-age=3600' },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'read failed' }, { status: 500 });
  }
}
