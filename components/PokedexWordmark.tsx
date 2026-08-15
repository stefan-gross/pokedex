'use client';

/**
 * „Pokédex"-Schriftzug im Logo-Look. Erste Fassung rein per CSS (gelb-blaue
 * Anmutung des Pokémon-Logos, kein externer Font, self-contained). Kann später
 * durch eine eingebettete Fan-Font (`woff2`, z.B. „Pokémon Solid") ersetzt
 * werden — dann nur `fontFamily` hier tauschen.
 *
 * Hinweis: Der echte Pokémon-Schriftzug ist markenrechtlich geschützt; dies ist
 * eine eigene, angenäherte Darstellung für die private App.
 */
export function PokedexWordmark({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span
      className={`inline-block select-none ${className}`}
      style={{
        fontFamily: '"Pokemon", "Plus Jakarta Sans", system-ui, sans-serif',
        color: '#FFCB05',
        WebkitTextStroke: '0.045em #2A75BB',
        // Blaue „Prägung" + weicher Tiefenschatten.
        textShadow: '0.04em 0.045em 0 #2A75BB, 0.08em 0.1em 0.03em rgba(0,0,0,0.35)',
        paintOrder: 'stroke fill',
        ...style,
      }}
    >
      Pokédex
    </span>
  );
}
