'use client';

/**
 * EnergyIcon — offizielle Pokémon-Typsymbole (Scarlet/Violet), bezogen über die
 * PokéAPI-Sprites. Aus dem offiziellen Badge ist nur das weiße Symbol
 * freigestellt (public/type-icons/<typ>.png); es wird hier per SVG-Maske auf
 * eine runde Scheibe in der offiziellen Typfarbe gelegt. Quelle/Lizenz:
 * public/type-icons/ATTRIBUTION.md.
 */

import { useId } from 'react';
import { normalizeEnergy } from '@/lib/energy';

export type EnergyType =
  | 'Fire' | 'Water' | 'Grass' | 'Lightning' | 'Psychic'
  | 'Fighting' | 'Darkness' | 'Metal' | 'Dragon' | 'Fairy' | 'Colorless';

// Offizielle Typfarben (Scarlet/Violet). Werden app-weit auch für Pills/Chips,
// Karten-Platzhalter-Tönung usw. genutzt (nicht nur für das Icon selbst).
export const ENERGY_META: Record<EnergyType, { bg: string; de: string }> = {
  Colorless: { bg: '#9FA19F', de: 'Farblos'    },
  Fire:      { bg: '#E62829', de: 'Feuer'      },
  Water:     { bg: '#2980EF', de: 'Wasser'     },
  Lightning: { bg: '#FAC000', de: 'Elektro'    },
  Grass:     { bg: '#3FA129', de: 'Pflanze'    },
  Psychic:   { bg: '#EF4179', de: 'Psycho'     },
  Fighting:  { bg: '#FF8000', de: 'Kampf'      },
  Darkness:  { bg: '#50413F', de: 'Finsternis' },
  Metal:     { bg: '#60A1B8', de: 'Stahl'      },
  Dragon:    { bg: '#5060E1', de: 'Drache'     },
  Fairy:     { bg: '#EF70EF', de: 'Fee'        },
};

interface Props {
  type: EnergyType;
  size?: number;
  className?: string;
  /** Erzwingt eine einheitliche Farbe statt der Typ-eigenen Scheibe — die
   *  Scheibe entfällt dann, nur das Symbol wird in dieser Farbe gezeichnet
   *  (z.B. „geprägt wie Text" auf BinderCover). */
  color?: string;
}

export function EnergyIcon({ type, size = 24, className = '', color }: Props) {
  // Eindeutige Masken-ID je Instanz (Rules of Hooks: immer aufrufen).
  const uid = useId();
  // Gespeicherte Mechanik kann deutsche Energienamen enthalten (z.B. „Unlicht")
  // → auf EN normalisieren; unbekannte Werte → kein Icon (kein Crash).
  const t = normalizeEnergy(type) as EnergyType;
  const meta = ENERGY_META[t];
  if (!meta) return null;
  const maskId = `energy-mask-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-label={meta.de}>
      <defs>
        {/* Freigestelltes weißes Symbol als Maske: sichtbar, wo das Symbol ist
            (Alpha), sonst transparent. Zentriert, füllt ~73% der Scheibe. */}
        <mask id={maskId}>
          <image
            href={`/type-icons/${t.toLowerCase()}.png`}
            x="3.2" y="3.2" width="17.6" height="17.6"
            preserveAspectRatio="xMidYMid meet"
          />
        </mask>
      </defs>
      {!color && <circle cx="12" cy="12" r="11.5" fill={meta.bg} />}
      <rect x="0" y="0" width="24" height="24" fill={color ?? '#ffffff'} mask={`url(#${maskId})`} />
    </svg>
  );
}
