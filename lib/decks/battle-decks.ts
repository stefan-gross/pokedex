/**
 * Kuratierte „Fertige Decks" (im Handel gekaufte Kampfdecks: Battle Decks /
 * League Battle Decks). Statische Referenzdaten (versioniert, kein Sync) — die
 * Jungs wählen ihr gekauftes Deck und legen es in einem Schritt an. Jede Liste
 * im PTCGL-Format (`Anzahl Name SET Nummer`), aufgelöst über resolvePtcglDeck.
 *
 * Quellen: offizielle Produktinhalte (Bulbapedia u.a.). Anzahlen auf 60 geprüft.
 * Neue Decks hinzufügen: siehe Kurations-Workflow (auf 60 prüfen, Set-Kürzel
 * mappen, /xxx-Suffix entfernen, dann im Sheet die Trefferquote verifizieren).
 */
import type { DeckFormat } from '@/types';

export interface BattleDeck {
  id: string;
  /** Englischer Name (Namensgeber-Pokémon). */
  name: string;
  /** Deutscher Name (Anzeige). */
  nameDe: string;
  /** Produktreihe (englisch, intern). */
  product: 'League Battle Deck' | 'ex Battle Deck' | 'Battle Deck';
  /** Play Level (1 = Einsteiger … 3 = kompetitiv/Liga). */
  level: number;
  year: number;
  /** Deck-Typen (für Icons/Filter). */
  types: string[];
  /** Tatsächliches Format des Produkts (ältere Precons sind heute Expanded). */
  format: DeckFormat;
  /** PTCGL-Deckcode. */
  ptcgl: string;
}

/** Deutsche Produktbezeichnung. */
export const PRODUCT_DE: Record<BattleDeck['product'], string> = {
  'League Battle Deck': 'Liga-Kampfdeck',
  'ex Battle Deck': 'ex-Kampfdeck',
  'Battle Deck': 'Kampfdeck',
};

export const BATTLE_DECKS: BattleDeck[] = [
  {
    id: 'charizard-ex-league-battle-deck',
    name: 'Charizard ex', nameDe: 'Glurak-ex',
    product: 'League Battle Deck', level: 3, year: 2024, types: ['Fire'], format: 'expanded',
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
    id: 'dragapult-ex-league-battle-deck',
    name: 'Dragapult ex', nameDe: 'Kapuno-ex',
    product: 'League Battle Deck', level: 3, year: 2024, types: ['Psychic', 'Fire'], format: 'expanded',
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
    name: 'Gardevoir ex', nameDe: 'Guardevoir-ex',
    product: 'League Battle Deck', level: 3, year: 2023, types: ['Psychic'], format: 'expanded',
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
    name: 'Miraidon ex', nameDe: 'Miraidon-ex',
    product: 'League Battle Deck', level: 3, year: 2023, types: ['Lightning'], format: 'expanded',
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
  {
    id: 'mega-lucario-ex-league-battle-deck',
    name: 'Mega Lucario ex', nameDe: 'Mega-Lucario-ex',
    product: 'League Battle Deck', level: 3, year: 2026, types: ['Fighting'], format: 'standard',
    ptcgl: `Pokémon: 18
3 Mega Lucario ex MEG 077
4 Riolu MEG 076
2 Hariyama MEG 073
3 Makuhita MEG 072
2 Solrock MEG 075
2 Lunatone MEG 074
1 Fezandipiti ex SFA 038
1 Bloodmoon Ursaluna ex TWM 141

Trainer: 30
4 Fighting Gong MEG 116
4 Lillie's Determination MEG 119
3 Iris's Fighting Spirit JTG 149
2 Boss's Orders MEG 114
1 Surfer SSP 187
2 Gravity Mountain SSP 177
4 Premium Power Pro MEG 124
4 Ultra Ball MEG 131
2 Night Stretcher SFA 061
1 Secret Box TWM 163
1 Switch MEG 130
2 Air Balloon BLK 079

Energy: 12
12 Basic Fighting Energy MEE 006`,
  },
  {
    id: 'victini-ex-battle-deck',
    name: 'Victini ex', nameDe: 'Victini-ex',
    product: 'ex Battle Deck', level: 1, year: 2024, types: ['Fire'], format: 'expanded',
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
    id: 'miraidon-ex-battle-deck',
    name: 'Miraidon ex', nameDe: 'Miraidon-ex',
    product: 'ex Battle Deck', level: 1, year: 2024, types: ['Lightning'], format: 'expanded',
    ptcgl: `Pokémon: 20
1 Miraidon ex SVP 143
3 Electrode PAL 067
4 Voltorb PAL 066
2 Raichu PAF 019
3 Pikachu MEW 025
2 Kilowattrel SVI 079
3 Wattrel SVI 077
2 Cyclizar SVI 164

Trainer: 22
4 Nemona SVI 180
3 Youngster SVI 198
2 Rika PAR 172
1 Jacq SVI 175
4 Great Ball PAL 183
3 Nest Ball SVI 181
3 Switch SVI 194
2 Electric Generator SVI 170

Energy: 18
18 Basic Lightning Energy SVE 004`,
  },
  {
    id: 'ampharos-ex-battle-deck',
    name: 'Ampharos ex', nameDe: 'Ampharos-ex',
    product: 'ex Battle Deck', level: 1, year: 2023, types: ['Lightning'], format: 'expanded',
    ptcgl: `Pokémon: 22
1 Ampharos ex SVP 016
2 Flaaffy SVP 015
3 Mareep SVI 066
3 Kilowattrel SVI 079
3 Wattrel SVI 077
1 Staraptor SVI 150
2 Staravia SVI 149
3 Starly SVI 148
1 Miraidon SVI 080
2 Rotom SVI 069
1 Flamigo SVI 165

Trainer: 20
4 Nemona SVI 180
4 Youngster SVI 198
1 Jacq SVI 175
2 Energy Retrieval SVI 171
2 Nest Ball SVI 181
2 Potion SVI 188
2 Switch SVI 194
2 Ultra Ball SVI 196
1 Pokégear 3.0 SVI 186

Energy: 18
18 Basic Lightning Energy SVE 004`,
  },
  {
    id: 'lucario-ex-battle-deck',
    name: 'Lucario ex', nameDe: 'Lucario-ex',
    product: 'ex Battle Deck', level: 1, year: 2023, types: ['Fighting'], format: 'expanded',
    ptcgl: `Pokémon: 22
1 Lucario ex SVP 017
3 Riolu SVI 112
2 Oinkologne SVI 157
2 Lechonk SVI 155
1 Annihilape SVI 109
2 Primeape SVI 108
3 Mankey SVI 107
1 Medicham SVI 111
2 Meditite SVI 110
1 Koraidon SVI 124
3 Squawkabilly SVI 162
1 Cyclizar SVI 164

Trainer: 20
4 Nemona SVI 180
4 Youngster SVI 198
1 Jacq SVI 175
2 Energy Retrieval SVI 171
2 Nest Ball SVI 181
2 Potion SVI 188
2 Switch SVI 194
2 Ultra Ball SVI 196
1 Pokégear 3.0 SVI 186

Energy: 18
18 Basic Fighting Energy SVE 006`,
  },
  {
    id: 'chien-pao-ex-battle-deck',
    name: 'Chien-Pao ex', nameDe: 'Chionabyss-ex',
    product: 'ex Battle Deck', level: 1, year: 2024, types: ['Water'], format: 'expanded',
    ptcgl: `Pokémon: 22
1 Chien-Pao ex SVP 030
2 Baxcalibur PAL 060
3 Arctibax PAL 059
3 Frigibax PAL 058
2 Floatzel SVI 047
3 Buizel SVI 046
2 Azumarill PAL 045
3 Marill PAL 044
2 Delibird PAL 046
1 Bruxish SVI 051

Trainer: 20
4 Nemona SVI 180
2 Youngster SVI 198
1 Jacq SVI 175
4 Great Ball PAL 183
2 Energy Retrieval SVI 171
2 Nest Ball SVI 181
2 Pokégear 3.0 SVI 186
2 Switch SVI 194
1 Pal Pad SVI 182

Energy: 18
18 Basic Water Energy SVE 003`,
  },
  {
    id: 'tinkaton-ex-battle-deck',
    name: 'Tinkaton ex', nameDe: 'Granforgita-ex',
    product: 'ex Battle Deck', level: 1, year: 2024, types: ['Psychic'], format: 'expanded',
    ptcgl: `Pokémon: 22
1 Tinkaton ex
3 Tinkatuff PAL 103
4 Tinkatink PAL 100
3 Drifblim SVI 090
4 Drifloon SVI 089
3 Espathra SVI 103
3 Flittle SVI 101
1 Squawkabilly SVI 162

Trainer: 20
4 Nemona SVI 180
2 Youngster SVI 198
1 Jacq SVI 175
4 Great Ball PAL 183
2 Nest Ball SVI 181
2 Pal Pad SVI 182
2 Pokégear 3.0 SVI 186
2 Switch SVI 194
1 Energy Retrieval SVI 171

Energy: 18
18 Basic Psychic Energy SVE 005`,
  },
  {
    id: 'tapu-koko-ex-battle-deck',
    name: 'Tapu Koko ex', nameDe: 'Kapu-Riki-ex',
    product: 'ex Battle Deck', level: 1, year: 2024, types: ['Lightning'], format: 'expanded',
    ptcgl: `Pokémon: 21
1 Tapu Koko ex PAR 068
2 Eelektross OBF 069
3 Eelektrik OBF 068
4 Tynamo OBF 067
2 Bellibolt TWM 074
3 Tadbulb PAL 078
2 Boltund TEF 059
2 Yamper TEF 058
1 Plusle PAR 060
1 Zeraora TEF 057

Trainer: 21
4 Nemona SVI 180
3 Youngster SVI 198
2 Rika PAR 172
1 Jacq SVI 175
4 Great Ball PAL 183
3 Nest Ball SVI 181
2 Electric Generator SVI 170
2 Switch SVI 194

Energy: 18
18 Basic Lightning Energy SVE 004`,
  },
  {
    id: 'iron-leaves-ex-battle-deck',
    name: 'Iron Leaves ex', nameDe: 'Eisenblatt-ex',
    product: 'ex Battle Deck', level: 1, year: 2024, types: ['Grass'], format: 'expanded',
    ptcgl: `Pokémon: 21
1 Iron Leaves ex TEF 025
2 Vileplume MEW 045
3 Gloom OBF 002
4 Oddish OBF 001
2 Tangrowth TWM 002
3 Tangela TWM 001
2 Trevenant TWM 013
2 Phantump TWM 012
1 Maractus PAF 003
1 Tropius PAL 007

Trainer: 21
3 Nemona SVI 180
2 Rika PAR 172
4 Youngster SVI 198
2 Professor Turo's Scenario PAR 171
1 Jacq SVI 175
4 Great Ball PAL 183
3 Poké Ball SVI 185
2 Switch SVI 194

Energy: 18
18 Basic Grass Energy SVE 001`,
  },
];
