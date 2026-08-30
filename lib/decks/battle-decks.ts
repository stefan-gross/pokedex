/**
 * Kuratierte „Fertige Decks" (im Handel gekaufte Kampfdecks: Battle Decks /
 * League Battle Decks). Statische Referenzdaten (versioniert, kein Sync) — die
 * Jungs wählen ihr gekauftes Deck und legen es in einem Schritt an. Jede Liste
 * im PTCGL-Format (`Anzahl Name SET Nummer`) und wird beim Verwenden über
 * resolvePtcglDeck gegen den Katalog aufgelöst (Trefferquote im Preview sichtbar).
 *
 * Quellen: offizielle Produktinhalte (Bulbapedia u.a.). Anzahlen auf 60 geprüft.
 */
import type { DeckFormat } from '@/types';

export interface BattleDeck {
  id: string;
  name: string;
  /** Produktreihe (z.B. „League Battle Deck"). */
  product: string;
  year: number;
  /** Deck-Typen (für Icons/Filter). */
  types: string[];
  /** Tatsächliches Format des Produkts (ältere Precons sind heute Expanded). */
  format: DeckFormat;
  /** PTCGL-Deckcode. */
  ptcgl: string;
}

export const BATTLE_DECKS: BattleDeck[] = [
  {
    id: 'charizard-ex-league-battle-deck',
    name: 'Glurak ex',
    product: 'League Battle Deck',
    year: 2024,
    types: ['Fire'],
    format: 'expanded',
    ptcgl: `Pokémon: 20
4 Charmander PAF 007
3 Charmeleon PAF 008
3 Charizard ex OBF 125
3 Pidgey MEW 016
2 Pidgeotto MEW 017
2 Pidgeot ex OBF 164
3 Moltres MEW 146

Trainer: 30
4 Iono PAL 185
2 Arven SVI 166
2 Boss's Orders PAL 172
2 Professor's Research SVI 189
2 Artazon PAL 171
4 Buddy-Buddy Poffin TEF 144
4 Rare Candy SVI 191
4 Ultra Ball SVI 196
1 Prime Catcher TEF 157
1 Super Rod PAL 188
1 Switch SVI 194
2 Technical Machine: Evolution PAR 178
1 Defiance Band SVI 169

Energy: 10
10 Basic Fire Energy SVE 002`,
  },
];
