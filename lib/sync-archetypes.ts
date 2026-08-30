/**
 * Sync der Turnier-Archetypen: zieht neueste Standard-Turniere von Limitless,
 * sammelt die Top-Decklisten, clustert sie zu Archetypen und schreibt sie per
 * Admin SDK nach `deck_archetypes`. Wie der Katalog-Sync bewusst als Admin-/
 * Lokal-Job gedacht (Vercel fehlen Admin-Env-Vars).
 */
import { getAdminDb } from './firebase/admin';
import { fetchTournaments, fetchStandings, standingPlayer, type LtStanding } from './decks/limitless';
import { clusterArchetypes, type DecklistEntry, type ArchetypeDeck } from './decks/archetypes';

export interface SyncArchetypesOpts {
  /** Wie viele der neuesten Turniere ziehen (Default 25). */
  tournamentLimit?: number;
  /** Wie viele Top-Platzierte je Turnier berücksichtigen (Default 16). */
  topPerTournament?: number;
  /** Mindest-Teilnehmerzahl, damit ein Turnier zählt (Default 16). */
  minPlayers?: number;
}

export interface SyncArchetypesResult {
  tournamentsScanned: number;
  decklistsCollected: number;
  archetypes: number;
  top: { name: string; popularity: number; bestPlacing: number; types: string[] }[];
}

const COL = 'deck_archetypes';

export async function syncArchetypes(opts: SyncArchetypesOpts = {}): Promise<SyncArchetypesResult> {
  const tournamentLimit = opts.tournamentLimit ?? 25;
  const topPerTournament = opts.topPerTournament ?? 16;
  const minPlayers = opts.minPlayers ?? 16;

  const tournaments = await fetchTournaments({ format: 'STANDARD', limit: tournamentLimit });
  const entries: DecklistEntry[] = [];
  let scanned = 0;

  for (const t of tournaments) {
    if ((t.players ?? 0) < minPlayers) continue;
    let standings: LtStanding[];
    try { standings = await fetchStandings(t.id); }
    catch { continue; }
    scanned++;

    const withDeck = standings
      .filter(s => s.decklist && ((s.decklist.pokemon?.length ?? 0) + (s.decklist.trainer?.length ?? 0) > 0))
      .sort((a, b) => (a.placing ?? 999) - (b.placing ?? 999))
      .slice(0, topPerTournament);

    for (const s of withDeck) {
      entries.push({
        decklist: s.decklist!,
        placing: s.placing ?? 999,
        player: standingPlayer(s),
        tournament: { id: t.id, name: t.name ?? '—', date: t.date, format: t.format ?? 'STANDARD' },
      });
    }
  }

  const archetypes = clusterArchetypes(entries);

  // Schreiben (Batch, ≤500 Docs) — bestehende Archetypen werden überschrieben
  // (rollierendes Fenster der neuesten Turniere).
  const db = getAdminDb();
  const col = db.collection(COL);
  let batch = db.batch();
  let n = 0;
  for (const a of archetypes) {
    batch.set(col.doc(a.id), a as ArchetypeDeck);
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (n % 400 !== 0) await batch.commit();

  return {
    tournamentsScanned: scanned,
    decklistsCollected: entries.length,
    archetypes: archetypes.length,
    top: archetypes.slice(0, 15).map(a => ({ name: a.name, popularity: a.popularity, bestPlacing: a.bestPlacing, types: a.types })),
  };
}
