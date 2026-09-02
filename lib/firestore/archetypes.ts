/**
 * Client-Reads für Turnier-Archetypen (`deck_archetypes`). Liest direkt via
 * Client-SDK (öffentliche Read-Rule) — funktioniert auch in Produktion, wo dem
 * Admin-SDK die Env-Vars fehlen. Kleine Collection → alles laden, clientseitig
 * filtern (kein Composite-Index nötig).
 */
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { ArchetypeDeck } from '@/lib/decks/archetypes';

export async function getArchetypes(filter: { type?: string; format?: string } = {}): Promise<ArchetypeDeck[]> {
  try {
    const snap = await getDocs(query(collection(db, 'deck_archetypes'), orderBy('popularity', 'desc')));
    let out = snap.docs.map(d => d.data() as ArchetypeDeck);
    if (filter.format) out = out.filter(a => a.format === filter.format);
    if (filter.type) out = out.filter(a => a.types.includes(filter.type!));
    return out;
  } catch (e) {
    console.error('[archetypes] read failed', e);
    return [];
  }
}
