/**
 * Sync der Turnier-Archetypen: zieht neueste Standard-Turniere von Limitless,
 * sammelt die Top-Decklisten, clustert sie zu Archetypen und schreibt sie per
 * Admin SDK nach `deck_archetypes`. Wie der Katalog-Sync bewusst als Admin-/
 * Lokal-Job gedacht (Vercel fehlen Admin-Env-Vars).
 */
import { getAdminDb } from './firebase/admin';
import type { Firestore } from 'firebase-admin/firestore';
import { fetchTournaments, fetchStandings, standingPlayer, type LtStanding } from './decks/limitless';
import { clusterArchetypes, featuredPokemon, type DecklistEntry, type ArchetypeDeck } from './decks/archetypes';

/** Nummer-Varianten (mit/ohne führende Nullen) für den Katalog-Lookup. */
function numberVariants(n: string): string[] {
  const set = new Set<string>([n]);
  const stripped = String(parseInt(n, 10));
  if (!Number.isNaN(+stripped)) { set.add(stripped); set.add(stripped.padStart(3, '0')); }
  return [...set];
}

/** Typ des Featured-Pokémon aus dem Katalog (setCode+Nummer) — damit auch
 *  Decks mit reiner Spezial-Energie einen Deck-Typ bekommen. */
async function featuredType(db: Firestore, set: string, number: string): Promise<string | null> {
  for (const num of numberVariants(number)) {
    try {
      const snap = await db.collection('tcg_catalog')
        .where('setCode', '==', set).where('number', '==', num).limit(1).get();
      const types = snap.docs[0]?.data()?.types as string[] | undefined;
      if (types?.length) return types[0];
    } catch { /* skip */ }
  }
  return null;
}

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

  const db = getAdminDb();

  // Typ-Anreicherung: Featured-Pokémon-Typ aus dem Katalog voranstellen (deckt
  // Decks ab, die nur Spezial-Energie fahren und deshalb aus den Energien keinen
  // Typ ableiten ließen).
  for (const a of archetypes) {
    const feat = featuredPokemon(a.decklist);
    if (!feat?.set || !feat?.number) continue;
    const t = await featuredType(db, feat.set, feat.number);
    if (t) a.types = [t, ...a.types.filter(x => x !== t)];
  }

  // Schreiben (Batch, ≤500 Docs) — bestehende Archetypen werden überschrieben
  // (rollierendes Fenster der neuesten Turniere).
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
