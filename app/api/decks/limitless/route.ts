/**
 * PoC-Route: holt eine echte Turnier-Deckliste von der Limitless-Platform-API
 * (keyless, Standard-Format) und liefert sie als PTCGL-Text + strukturiert
 * zurück. Die Auflösung gegen unseren Katalog passiert CLIENT-seitig
 * (resolvePtcglDeck) auf der PoC-Seite — hier wird nur proxied (kein CORS,
 * kein Key). Rein zur Machbarkeits-/Trefferquoten-Messung.
 */
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;
const BASE = 'https://play.limitlesstcg.com/api';

interface LtCard { count: number; set?: string; number?: string; name: string }
interface LtDecklist { pokemon?: LtCard[]; trainer?: LtCard[]; energy?: LtCard[] }

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} bei ${url}`);
  return r.json() as Promise<T>;
}

/** Strukturierte Limitless-Liste → PTCGL-Deckcode (unser Resolver erwartet Text). */
function toPtcglText(dl: LtDecklist): string {
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

interface LtTournament { id: string; name?: string; date?: string; players?: number; format?: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LtStanding = { placing?: number; decklist?: LtDecklist } & Record<string, any>;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || undefined;
  try {
    const tournaments: LtTournament[] = id
      ? [{ id, ...(await jget<Partial<LtTournament>>(`${BASE}/tournaments/${id}/details`).catch(() => ({}))) }]
      : await jget<LtTournament[]>(`${BASE}/tournaments?game=PTCG&format=STANDARD&limit=25`);

    for (const t of tournaments) {
      if (!id && (t.players ?? 0) < 8) continue;   // Mini-Events überspringen
      let standings: LtStanding[];
      try { standings = await jget<LtStanding[]>(`${BASE}/tournaments/${t.id}/standings`); }
      catch { continue; }

      const top = standings.find(p => p?.decklist && ((p.decklist.pokemon?.length ?? 0) + (p.decklist.trainer?.length ?? 0) > 0));
      if (!top) continue;

      const dl = top.decklist!;
      const structured = { pokemon: dl.pokemon ?? [], trainer: dl.trainer ?? [], energy: dl.energy ?? [] };
      const totalCards = [...structured.pokemon, ...structured.trainer, ...structured.energy].reduce((s, c) => s + c.count, 0);

      return NextResponse.json({
        tournament: { id: t.id, name: t.name ?? '—', date: t.date, players: t.players, format: t.format },
        player: { name: top.name ?? top.player ?? top.username ?? '—', placing: top.placing ?? 1 },
        structured,
        totalCards,
        ptcglText: toPtcglText(dl),
      });
    }
    return NextResponse.json({ error: 'Kein Turnier mit Deckliste gefunden.' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fetch failed' }, { status: 502 });
  }
}
