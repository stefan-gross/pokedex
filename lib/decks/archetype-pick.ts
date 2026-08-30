/**
 * Wählt aus den gespeicherten Turnier-Archetypen (deck_archetypes) das beste
 * passende Deck und löst es gegen den Katalog auf — Grundlage für „Bestes Deck"
 * (echtes Turnierdeck statt KI-Bau) und für den Soll/Bedarf-Abgleich.
 */
import { getArchetypes } from '@/lib/firestore/archetypes';
import { resolvePtcglDeck } from '@/lib/decks/ptcgl';
import { decklistToPtcglText } from '@/lib/decks/limitless';
import type { DeckCardRef } from '@/types';

export interface ArchetypePick {
  name: string;
  popularity: number;
  bestPlacing: number;
  sourceLabel: string;
  refs: DeckCardRef[];
  unresolved: number;
  total: number;
}

/** Passenden Archetyp nach Typ (und optional Namensfilter) wählen — der
 *  populärste — und auf konkrete Katalog-Karten auflösen. */
export async function pickArchetypeDeck(opts: { type?: string; coreName?: string }): Promise<ArchetypePick | null> {
  let pool = await getArchetypes(opts.type ? { type: opts.type } : {});
  if (opts.coreName) {
    const q = opts.coreName.trim().toLowerCase();
    const named = pool.filter(a => a.name.toLowerCase().includes(q));
    if (named.length) pool = named;
  }
  // Archetypen, deren PRIMÄR-Typ (Featured-Pokémon) dem Wunsch entspricht,
  // bevorzugen — sonst gewönne ein populäres Multi-Typ-Toolbox-Deck (z.B. Mega
  // Kangaskhan), das den Typ nur unter vielen Energien führt, über das echte
  // Mono-Typ-Deck. Innerhalb dessen nach Popularität (Pool ist schon so sortiert).
  if (opts.type) {
    const t = opts.type;
    pool = [...pool].sort((a, b) => (Number(b.types[0] === t) - Number(a.types[0] === t)));
  }
  const best = pool[0];
  if (!best) return null;

  const res = await resolvePtcglDeck(decklistToPtcglText(best.decklist));
  const refs: DeckCardRef[] = res.resolved.map(r => ({
    catalogId: r.card.id, count: r.count,
    name: r.card.nameDe ?? r.card.name, setId: r.card.setId, number: r.card.number, supertype: r.card.supertype,
  }));
  return {
    name: best.name,
    popularity: best.popularity,
    bestPlacing: best.bestPlacing,
    sourceLabel: `${best.source.player} @ ${best.source.tournamentName}`,
    refs,
    unresolved: res.unresolved.length,
    total: refs.reduce((s, r) => s + r.count, 0),
  };
}
