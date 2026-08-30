/**
 * Client-Reads für Turnier-Archetypen (`deck_archetypes`). Läuft über die
 * Server-Route /api/decks/archetypes (Admin SDK), damit die Collection keine
 * öffentliche Firestore-Read-Rule braucht.
 */
import type { ArchetypeDeck } from '@/lib/decks/archetypes';

export async function getArchetypes(filter: { type?: string; format?: string } = {}): Promise<ArchetypeDeck[]> {
  const params = new URLSearchParams();
  if (filter.type) params.set('type', filter.type);
  if (filter.format) params.set('format', filter.format);
  const r = await fetch(`/api/decks/archetypes${params.toString() ? `?${params}` : ''}`);
  if (!r.ok) throw new Error(`Archetypen-Read fehlgeschlagen (${r.status})`);
  const data = await r.json();
  return Array.isArray(data.archetypes) ? data.archetypes : [];
}
