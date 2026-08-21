# Typ-/Energiesymbole

Die Symbole in diesem Ordner sind die **offiziellen Pokémon-Typsymbole**
(Generation IX, Scarlet/Violet), bezogen über die **PokéAPI-Sprites**
(https://github.com/PokeAPI/sprites, `sprites/types/generation-ix/scarlet-violet/small/`).

Verarbeitung: Aus dem offiziellen farbigen Badge wurde per Skript nur das
**weiße Symbol** freigestellt (Freistellung über den Abstand zur bekannten
Hintergrundfarbe) und auf die Symbolgrenzen zugeschnitten. In der App
(`components/ui/EnergyIcon.tsx`) wird das PNG als SVG-Maske auf eine runde
Scheibe in der **offiziellen Typfarbe** gelegt.

| Datei (TCG-Energie) | Spiel-Typ | Offizielle Farbe |
|---------------------|-----------|------------------|
| fire.png            | Fire      | #E62829 |
| water.png           | Water     | #2980EF |
| grass.png           | Grass     | #3FA129 |
| lightning.png       | Electric  | #FAC000 |
| psychic.png         | Psychic   | #EF4179 |
| fighting.png        | Fighting  | #FF8000 |
| darkness.png        | Dark      | #50413F |
| metal.png           | Steel     | #60A1B8 |
| dragon.png          | Dragon    | #5060E1 |
| fairy.png           | Fairy     | #EF70EF |
| colorless.png       | Normal    | #9FA19F |

Pokémon und die Typsymbole sind Eigentum von Nintendo/Creatures Inc./GAME FREAK.
Nutzung hier nur für die private Sammlungs-App.
