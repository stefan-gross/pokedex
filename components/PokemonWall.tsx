'use client';

// Lokale, vorab optimierte Sprites (public/wall/<dex>.webp, je ~96px, ~4KB) —
// bewusst NICHT das große GitHub-Artwork (pokemonArtworkUrl), das ~6–12 MB auf
// den Login-/Splash-Pfad zog. Erzeugt mit scripts (siehe Commit).
const wallSprite = (dex: number) => `/wall/${dex}.webp`;

/** Kuratierte, quer über alle Generationen bekannte Pokémon (nationale
 *  Dex-Nummern) für die Hintergrund-Wand von Startbildschirm/Splash. Bewusst
 *  ikonische Motive, damit die Wand sofort „Pokémon" sagt. */
const WALL_DEX = [
  1, 4, 7, 25, 6, 9, 3, 133, 143, 94, 131, 130, 149, 150, 151,
  448, 445, 282, 384, 483, 484, 487, 359, 396, 654, 658, 778, 887, 892, 155,
];

const COLS = 7;
const ROWS = 20;

/**
 * Halbtransparente Hintergrund-Wand aus offiziellem Pokémon-Artwork
 * (PokéAPI-Sprites, kein Key). Rein dekorativ (`aria-hidden`). Die Pokémon
 * sind **versetzt** angeordnet (jede zweite Spalte um eine halbe Kachel nach
 * oben verschoben → Brick-/Wabenmuster). Ein radialer Scrim dunkelt die Mitte
 * ab, damit Schriftzug/Login lesbar bleiben — theme-abhängig hell/dunkel.
 * Wiederverwendbar für Login-Seite und Cold-Start-Splash.
 */
export function PokemonWall({ className = '' }: { className?: string }) {
  // Feste, wiederholte Sprite-Matrix; in Spalten aufteilen, damit wir jede
  // zweite Spalte versetzen können (mit CSS-Grid nicht sauber machbar).
  const flat = Array.from({ length: COLS * ROWS }, (_, i) => WALL_DEX[i % WALL_DEX.length]);
  const columns = Array.from({ length: COLS }, (_, c) => flat.filter((_, i) => i % COLS === c));

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      {/* Volle Breite füllend: 7 gleich breite Spalten (flex-1), jede zweite
          um eine halbe Kachel nach oben versetzt → Brick-/Wabenmuster. */}
      <div className="absolute inset-x-0 -top-10 bottom-0 flex opacity-[0.7] dark:opacity-[0.9]">
        {columns.map((col, ci) => (
          <div
            key={ci}
            className="flex-1 flex flex-col"
            style={{ transform: ci % 2 ? 'translateY(-2.2rem)' : undefined }}
          >
            {col.map((dex, ri) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={ri}
                src={wallSprite(dex)}
                alt=""
                loading="lazy"
                // Im Dark Mode aufhellen + sättigen: ein schwarzer Scrim (unten)
                // lässt die dunkel umrandeten Sprites sonst mit dem dunklen
                // Hintergrund verschmelzen (anders als der weiße Light-Scrim, unter
                // dem farbige Sprites als Pastell-Tint sichtbar bleiben).
                className="w-full aspect-square object-contain p-1.5 select-none dark:brightness-[1.35] dark:saturate-[1.2]"
                draggable={false}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Scrim hell (Light-Mode): außen fast klar, Mitte hell abgedeckt */}
      <div
        className="absolute inset-0 dark:hidden"
        style={{
          background:
            'radial-gradient(95% 62% at 50% 46%, rgba(244,246,251,0.90) 0%, rgba(244,246,251,0.70) 42%, rgba(244,246,251,0.20) 100%)',
        }}
      />
      {/* Scrim dunkel (Dark-Mode) */}
      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          background:
            'radial-gradient(95% 62% at 50% 46%, rgba(15,17,23,0.80) 0%, rgba(15,17,23,0.55) 42%, rgba(15,17,23,0.12) 100%)',
        }}
      />
    </div>
  );
}
