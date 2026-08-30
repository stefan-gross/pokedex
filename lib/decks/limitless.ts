/**
 * Limitless-Platform-API (play.limitlesstcg.com) — geteilte Fetch-Helfer.
 * Keyless für Turnier-/Standings-Daten (öffentliche Endpunkte). Nur SERVER-seitig
 * nutzen (CORS + damit die Basis-URL nicht im Client-Bundle landet).
 */
const BASE = 'https://play.limitlesstcg.com/api';

export interface LtCard { count: number; set?: string; number?: string; name: string }
export interface LtDecklist { pokemon?: LtCard[]; trainer?: LtCard[]; energy?: LtCard[] }
export interface LtTournament { id: string; name?: string; date?: string; players?: number; format?: string; game?: string }
export interface LtStanding {
  placing?: number;
  name?: string;
  player?: string;
  username?: string;
  country?: string;
  decklist?: LtDecklist;
}

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} bei ${url}`);
  return r.json() as Promise<T>;
}

/** Neueste Turniere eines Spiels/Formats (Standard: game=PTCG, format=STANDARD). */
export function fetchTournaments(opts: { format?: string; limit?: number } = {}): Promise<LtTournament[]> {
  const params = new URLSearchParams({ game: 'PTCG', limit: String(opts.limit ?? 25) });
  if (opts.format) params.set('format', opts.format);
  return jget<LtTournament[]>(`${BASE}/tournaments?${params.toString()}`);
}

export function fetchTournamentDetails(id: string): Promise<Partial<LtTournament>> {
  return jget<Partial<LtTournament>>(`${BASE}/tournaments/${id}/details`);
}

/** Platzierungen inkl. `decklist` je Spieler (falls veröffentlicht). */
export function fetchStandings(id: string): Promise<LtStanding[]> {
  return jget<LtStanding[]>(`${BASE}/tournaments/${id}/standings`);
}

/** Spielername aus einem Standing (Feldname variiert). */
export function standingPlayer(s: LtStanding): string {
  return s.name ?? s.player ?? s.username ?? '—';
}

export function decklistCardCount(dl: LtDecklist): number {
  return [...(dl.pokemon ?? []), ...(dl.trainer ?? []), ...(dl.energy ?? [])].reduce((s, c) => s + c.count, 0);
}

/** Strukturierte Limitless-Liste → PTCGL-Deckcode (unser resolvePtcglDeck erwartet Text). */
export function decklistToPtcglText(dl: LtDecklist): string {
  const sec = (label: string, arr?: LtCard[]): string[] => {
    if (!arr?.length) return [];
    const total = arr.reduce((s, c) => s + c.count, 0);
    const lines = arr.map(c => c.set && c.number
      ? `${c.count} ${c.name} ${c.set} ${c.number}`
      : `${c.count} ${c.name}${c.number ? ' ' + c.number : ''}`);
    return [`${label}: ${total}`, ...lines, ''];
  };
  return [...sec('Pokémon', dl.pokemon), ...sec('Trainer', dl.trainer), ...sec('Energy', dl.energy)].join('\n');
}
