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
  {
    id: 'victini-ex-battle-deck',
    name: 'Victini ex',
    product: 'ex Battle Deck',
    year: 2024,
    types: ['Fire'],
    format: 'expanded',
    ptcgl: `Pokémon: 20
1 Victini ex SVP 142
3 Magmortar PAF 010
3 Magmar PAF 009
2 Skeledirge SVI 038
3 Crocalor PAL 036
4 Fuecoco PAL 034
2 Paldean Tauros PAL 028
2 Cyclizar SVI 164

Trainer: 22
4 Nemona SVI 180
3 Youngster SVI 198
2 Rika PAR 172
1 Jacq SVI 175
4 Great Ball PAL 183
3 Nest Ball SVI 181
3 Switch SVI 194
2 Energy Sticker MEW 159

Energy: 18
18 Basic Fire Energy SVE 002`,
  },
  {
    id: 'dragapult-ex-league-battle-deck',
    name: 'Dragapult ex',
    product: 'League Battle Deck',
    year: 2024,
    types: ['Psychic', 'Fire'],
    format: 'expanded',
    ptcgl: `Pokémon: 21
4 Dragapult ex TWM 130
4 Drakloak TWM 129
4 Dreepy TWM 128
3 Xatu PAR 072
3 Natu PAR 073
2 Tatsugiri TWM 131
1 Fezandipiti ex SFA 038

Trainer: 29
3 Iono PAL 185
3 Arven SVI 166
1 Boss's Orders PAL 172
1 Mela PAR 167
1 Professor Turo's Scenario PAR 171
4 Buddy-Buddy Poffin TEF 144
4 Ultra Ball SVI 196
2 Earthen Vessel PAR 163
2 Rare Candy SVI 191
1 Counter Catcher PAR 160
1 Super Rod PAL 188
1 Switch SVI 194
1 Unfair Stamp TWM 165
2 Rescue Board TEF 159
1 Technical Machine: Devolution PAR 177
1 Technical Machine: Evolution PAR 178

Energy: 10
6 Basic Psychic Energy SVE 013
4 Basic Fire Energy SVE 010`,
  },
  {
    id: 'gardevoir-ex-league-battle-deck',
    name: 'Gardevoir ex',
    product: 'League Battle Deck',
    year: 2023,
    types: ['Psychic'],
    format: 'expanded',
    ptcgl: `Pokémon: 18
3 Gardevoir ex SVI 086
4 Ralts SIT 067
4 Kirlia SIT 068
3 Drifloon SVI 089
1 Cresselia LOR 074
1 Lumineon V BRS 040
1 Mew ex MEW 151
1 Radiant Greninja ASR 046

Trainer: 29
4 Iono PAL 185
3 Professor's Research SVI 189
2 Arven SVI 166
2 Boss's Orders PAL 172
1 Jacq SVI 175
2 Artazon PAL 171
4 Nest Ball SVI 181
4 Ultra Ball SVI 196
3 Rare Candy SVI 191
1 Super Rod PAL 188
3 Bravery Charm PAL 173

Energy: 13
13 Basic Psychic Energy SVE 005`,
  },
  {
    id: 'miraidon-ex-league-battle-deck',
    name: 'Miraidon ex',
    product: 'League Battle Deck',
    year: 2023,
    types: ['Lightning'],
    format: 'expanded',
    ptcgl: `Pokémon: 14
2 Miraidon ex SVI 081
2 Regieleki VMAX SIT 058
2 Regieleki V SIT 057
2 Regieleki ASR 051
2 Zeraora SIT 056
2 Bibarel BRS 121
2 Bidoof BRS 120

Trainer: 31
4 Arven SVI 166
4 Boss's Orders PAL 172
4 Professor's Research SVI 190
4 Electric Generator SVI 170
3 Nest Ball SVI 181
2 Switch SVI 194
4 Ultra Ball SVI 196
1 Forest Seal Stone SIT 156
1 Leafy Camo Poncho SIT 160
2 Vitality Band SVI 197
2 Beach Court SVI 167

Energy: 15
15 Basic Lightning Energy SVE 004`,
  },
];
