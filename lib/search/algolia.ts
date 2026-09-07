/**
 * Algolia-Anbindung (Prototyp). Firestore bleibt Quelle der Wahrheit; Algolia ist
 * nur ein abgeleiteter Such-Index (wie `meta/suggest_index`, aber extern + viel
 * mächtiger: Volltext, Tippfehler, Facetten über die GANZE Treffermenge, echte
 * Sortierung/Pagination).
 *
 * Dieses Modul ist CLIENT-SICHER: es nutzt nur die öffentlichen `NEXT_PUBLIC_*`-
 * Variablen (App-ID + Search-Only-Key). Der Admin-Key lebt ausschließlich in der
 * Backfill-Route (server-seitig) und taucht hier bewusst NICHT auf.
 */
import { algoliasearch, type SearchClient } from 'algoliasearch';

export const ALGOLIA_INDEX = 'tcg_catalog';

const APP_ID = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID;
const SEARCH_KEY = process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY;

/** True, wenn App-ID + Search-Key gesetzt sind (Feature-Flag für den Adapter). */
export function isAlgoliaConfigured(): boolean {
  return !!(APP_ID && SEARCH_KEY);
}

let _client: SearchClient | null = null;
/** Such-Client (Search-Only-Key) — im Browser wie im Server nutzbar. */
export function getAlgoliaSearchClient(): SearchClient | null {
  if (!isAlgoliaConfigured()) return null;
  if (!_client) _client = algoliasearch(APP_ID!, SEARCH_KEY!);
  return _client;
}
