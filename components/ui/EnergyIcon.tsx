/**
 * EnergyIcon — Pokémon TCG Energietyp-Symbole als inline SVG.
 * Angelehnt an die offiziellen Pokémon-Typ-Icons (Spiele + TCG).
 * Dunkle Symbole auf farbigem Kreis-Hintergrund.
 */

export type EnergyType =
  | 'Fire' | 'Water' | 'Grass' | 'Lightning' | 'Psychic'
  | 'Fighting' | 'Darkness' | 'Metal' | 'Dragon' | 'Fairy' | 'Colorless';

export const ENERGY_META: Record<EnergyType, { bg: string; de: string }> = {
  Colorless: { bg: '#C8C8C8', de: 'Farblos'    },
  Fire:      { bg: '#E8401A', de: 'Feuer'      },
  Water:     { bg: '#3898C8', de: 'Wasser'     },
  Lightning: { bg: '#F0D020', de: 'Elektro'    },
  Grass:     { bg: '#28A028', de: 'Pflanze'    },
  Psychic:   { bg: '#9040C0', de: 'Psycho'     },
  Fighting:  { bg: '#C04020', de: 'Kampf'      },
  Darkness:  { bg: '#282838', de: 'Finsternis' },
  Metal:     { bg: '#90A8C0', de: 'Stahl'      },
  Dragon:    { bg: '#A88000', de: 'Drache'     },
  Fairy:     { bg: '#E050A0', de: 'Fee'        },
};

const SYM = 'rgba(0,0,0,0.82)';

function InnerSymbol({ type }: { type: EnergyType }) {
  switch (type) {

    case 'Colorless':
      // 4-zackiger Stern (Normal-Typ)
      return (
        <path fill={SYM} d="
          M12 5.5 L13.6 10.4 L18.5 12 L13.6 13.6
          L12 18.5 L10.4 13.6 L5.5 12 L10.4 10.4 Z
        " />
      );

    case 'Fire':
      // Flamme mit Zunge
      return (
        <path fill={SYM} d="
          M12 5
          C12 5 9 8.5 9.5 11.5
          C9 11 8.5 10 8.5 10
          C7 12.5 8 16 10 17.5
          C9.5 16 9.8 14.5 11 14
          C10.5 16 11.5 18.5 14 18.5
          C17 18.5 18 15 16.5 12.5
          C16.5 12.5 16 14 15 14.5
          C16 12.5 15.5 9 12 5 Z
        " />
      );

    case 'Water':
      // Wassertropfen mit Schwung (wie im offiziellen Icon)
      return (
        <path fill={SYM} d="
          M14.5 6.5
          C14.5 6.5 9 11 8.5 13.5
          C8 16.5 9.8 19 12.5 19
          C15.2 19 17 16.5 16.5 13.5
          C16 11 14.5 6.5 14.5 6.5 Z
          M13 9.5
          C13 9.5 11 13 11.5 15
          C11 14.5 10.5 13 11 11.5 Z
        " />
      );

    case 'Lightning':
      // Blitz (dicker Pfeil)
      return (
        <path fill={SYM} d="
          M15 5 L9 13 L13 13 L9 19 L18.5 10.5 L14.5 10.5 Z
        " />
      );

    case 'Grass':
      // Blatt
      return (
        <path fill={SYM} d="
          M12 5.5
          C12 5.5 6 9 6.5 14.5
          C7 18 10 19 12 18.5
          C14 19 17 18 17.5 14.5
          C18 9 12 5.5 12 5.5 Z
        " />
      );

    case 'Psychic':
      // Auge (Pupille + Iris)
      return (
        <g>
          <path fill={SYM} d="
            M12 8
            C7 8 4 12 4 12
            C4 12 7 16 12 16
            C17 16 20 12 20 12
            C20 12 17 8 12 8 Z
          " />
          <circle cx="12" cy="12" r="3.5" fill={ENERGY_META['Psychic'].bg} />
          <circle cx="12" cy="12" r="2"   fill={SYM} />
          <circle cx="11" cy="11" r="0.7" fill="white" opacity="0.6" />
        </g>
      );

    case 'Fighting':
      // Faust (vereinfacht)
      return (
        <path fill={SYM} d="
          M8.5 10.5
          C8.5 9 9.5 8 10.5 8 L13.5 8
          C14.5 8 15.5 9 15.5 10.5 L15.5 12
          L16.5 12 C17.2 12 17.5 12.5 17.5 13
          L17.5 13.5 C17.5 14 17 14.5 16.5 14.5
          L15.5 14.5 L15.5 15.5
          C15.5 17 14.5 18 13 18
          L11.5 18
          C9.5 18 8 16.5 8 14.5
          L8 13.5
          C7.2 13.3 7 12.8 7 12.5
          C7 12 7.5 11.5 8 11.5 Z
        " />
      );

    case 'Darkness':
      // Dunkler Kreis mit Mondform (Unlicht-Symbol)
      return (
        <>
          <circle cx="12" cy="12" r="5.5" fill={SYM} />
          <circle cx="10" cy="10" r="4"   fill={ENERGY_META['Darkness'].bg} />
        </>
      );

    case 'Metal':
      // Stahl-Dreieck mit innerer Zeichnung
      return (
        <g fill={SYM}>
          <path d="M12 6 L18.5 17 L5.5 17 Z" />
          <path d="M12 9 L16.5 17 L7.5 17 Z" fill={ENERGY_META['Metal'].bg} />
          <line x1="10" y1="14" x2="14" y2="14" stroke={SYM} strokeWidth="1.5" />
          <line x1="10.8" y1="16" x2="13.2" y2="16" stroke={SYM} strokeWidth="1.5" />
        </g>
      );

    case 'Dragon':
      // Drachenschwinge
      return (
        <path fill={SYM} d="M7 8 C7 8 5.5 11 7 14 C8 16 10 16.5 10 16.5 C10 16.5 9 18 10 18.5 C11 19 13 19 14 18.5 C15 18 14 16.5 14 16.5 C14 16.5 16 16 17 14 C18.5 11 17 8 17 8 C15 6 12 5.5 9 6.5 Z" />
      );

    case 'Fairy':
      // 4-Blüten Blume mit Herz-Mitte
      return (
        <g fill={SYM}>
          <ellipse cx="12" cy="8"  rx="2.8" ry="4" />
          <ellipse cx="12" cy="8"  rx="2.8" ry="4" transform="rotate(90 12 12)" />
          <ellipse cx="12" cy="8"  rx="2.8" ry="4" transform="rotate(180 12 12)" />
          <ellipse cx="12" cy="8"  rx="2.8" ry="4" transform="rotate(270 12 12)" />
          {/* Herz in der Mitte */}
          <path d="M12 14.5 C11 13.5 9.5 13 9.5 11.5 C9.5 10.5 10.5 10 12 11.5 C13.5 10 14.5 10.5 14.5 11.5 C14.5 13 13 13.5 12 14.5Z"
            fill={ENERGY_META['Fairy'].bg} />
        </g>
      );
  }
}

interface Props {
  type: EnergyType;
  size?: number;
  className?: string;
}

export function EnergyIcon({ type, size = 24, className = '' }: Props) {
  const { bg } = ENERGY_META[type];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-label={ENERGY_META[type].de}
    >
      <circle cx="12" cy="12" r="11.5" fill={bg} />
      <InnerSymbol type={type} />
    </svg>
  );
}
