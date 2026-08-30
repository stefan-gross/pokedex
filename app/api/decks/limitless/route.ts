/**
 * PoC-Route: holt eine echte Turnier-Deckliste von Limitless (keyless, Standard)
 * und liefert sie als PTCGL-Text + strukturiert zurück. Auflösung gegen den
 * Katalog passiert CLIENT-seitig (resolvePtcglDeck). Nutzt die geteilten
 * Fetch-Helfer aus lib/decks/limitless.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  fetchTournaments, fetchTournamentDetails, fetchStandings,
  standingPlayer, decklistCardCount, decklistToPtcglText,
  type LtTournament,
} from '@/lib/decks/limitless';

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || undefined;
  try {
    const tournaments: LtTournament[] = id
      ? [{ id, ...(await fetchTournamentDetails(id).catch(() => ({}))) }]
      : await fetchTournaments({ format: 'STANDARD', limit: 25 });

    for (const t of tournaments) {
      if (!id && (t.players ?? 0) < 8) continue;
      let standings;
      try { standings = await fetchStandings(t.id); }
      catch { continue; }

      const top = standings.find(p => p?.decklist && ((p.decklist.pokemon?.length ?? 0) + (p.decklist.trainer?.length ?? 0) > 0));
      if (!top) continue;

      const dl = top.decklist!;
      return NextResponse.json({
        tournament: { id: t.id, name: t.name ?? '—', date: t.date, players: t.players, format: t.format },
        player: { name: standingPlayer(top), placing: top.placing ?? 1 },
        structured: { pokemon: dl.pokemon ?? [], trainer: dl.trainer ?? [], energy: dl.energy ?? [] },
        totalCards: decklistCardCount(dl),
        ptcglText: decklistToPtcglText(dl),
      });
    }
    return NextResponse.json({ error: 'Kein Turnier mit Deckliste gefunden.' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fetch failed' }, { status: 502 });
  }
}
