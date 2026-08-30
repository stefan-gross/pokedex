/**
 * Liest die gespeicherten Turnier-Archetypen (deck_archetypes) serverseitig über
 * das Admin SDK und liefert sie gefiltert (type/format) zurück. Bewusst über eine
 * Route statt Client-SDK: die Collection braucht so keine öffentliche Firestore-
 * Read-Rule. Durch proxy.ts nur mit gültiger Session erreichbar.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import type { ArchetypeDeck } from '@/lib/decks/archetypes';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') || undefined;
  const format = sp.get('format') || undefined;
  try {
    const snap = await getAdminDb().collection('deck_archetypes').orderBy('popularity', 'desc').get();
    let out = snap.docs.map(d => d.data() as ArchetypeDeck);
    if (format) out = out.filter(a => a.format === format);
    if (type) out = out.filter(a => a.types.includes(type));
    return NextResponse.json({ archetypes: out });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'read failed' }, { status: 500 });
  }
}
