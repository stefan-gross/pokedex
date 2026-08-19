/**
 * EnergyIcon — Pokémon TCG Energietyp-Symbole als inline SVG.
 * Angelehnt an die offiziellen Pokémon-Typ-Icons (Spiele + TCG).
 * Dunkle Symbole auf farbigem Kreis-Hintergrund.
 */

import { normalizeEnergy } from '@/lib/energy';
import { readableTextColor } from '@/lib/color-utils';

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

function InnerSymbol({ type, sym, accent }: { type: EnergyType; sym: string; accent: string }) {
  // `sym`   = Farbe des eigentlichen Symbols (weiß auf dunkler Scheibe, dunkel
  //           auf heller — vom Aufrufer via readableTextColor bestimmt; im
  //           „geprägt wie Text"-Modus die Prägefarbe).
  // `accent` = Füllung der ausgesparten Innenformen (Auge-Iris, Unlicht-Sichel,
  //           Mutter-Loch, Fee-Herz): im Default die Scheibenfarbe (wirkt
  //           durchbrochen), im Prägemodus dieselbe Prägefarbe (Vollform).
  switch (type) {

    case 'Colorless':
      // 4-zackiger Stern (Normal-Typ)
      return (
        <path fill={sym} d="
          M12 5.5 L13.6 10.4 L18.5 12 L13.6 13.6
          L12 18.5 L10.4 13.6 L5.5 12 L10.4 10.4 Z
        " />
      );

    case 'Fire':
      // Flamme mit Zunge
      return (
        <path fill={sym} d="
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
        <path fill={sym} d="
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
        <path fill={sym} d="
          M15 5 L9 13 L13 13 L9 19 L18.5 10.5 L14.5 10.5 Z
        " />
      );

    case 'Grass':
      // Blatt
      return (
        <path fill={sym} d="
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
          <path fill={sym} d="
            M12 8
            C7 8 4 12 4 12
            C4 12 7 16 12 16
            C17 16 20 12 20 12
            C20 12 17 8 12 8 Z
          " />
          <circle cx="12" cy="12" r="3.5" fill={accent} />
          <circle cx="12" cy="12" r="2"   fill={sym} />
          <circle cx="11" cy="11" r="0.7" fill="white" opacity="0.6" />
        </g>
      );

    case 'Fighting':
      // Faust von vorn: kompakter Handblock mit vier Knöchel-Kuppen oben und
      // angedeutetem Daumen links — klarer lesbar als die frühere Blob-Form.
      return (
        <g fill={sym}>
          {/* Handfläche/Faustblock */}
          <path d="M8 12.5 C8 11.6 8.7 11 9.6 11 L15.4 11 C16.3 11 17 11.6 17 12.5 L17 15 C17 17.2 15.2 19 13 19 L11.7 19 C9.7 19 8 17.3 8 15.3 Z" />
          {/* Vier Knöchel-Kuppen */}
          <circle cx="9.7"  cy="11" r="1.35" />
          <circle cx="12"   cy="10.7" r="1.5" />
          <circle cx="14.3" cy="11" r="1.35" />
          {/* Daumen */}
          <path d="M8 13.2 C7.1 13.2 6.6 13.8 6.6 14.5 C6.6 15.2 7.1 15.8 8 15.8 Z" />
        </g>
      );

    case 'Darkness':
      // Dunkler Kreis mit Mondform (Unlicht-Symbol)
      return (
        <>
          <circle cx="12" cy="12" r="5.5" fill={sym} />
          <circle cx="10" cy="10" r="4"   fill={accent} />
        </>
      );

    case 'Metal':
      // Sechskant-Mutter (Schraubmutter) — deutlich als „Metall/Stahl"
      // lesbar. Loch nimmt die Scheibenfarbe (default) → wirkt durchbrochen;
      // im color-Modus (accent = color) füllt es sich zu einer Vollmutter.
      return (
        <g fill={sym}>
          <path d="M12 4.2 L18.75 8.1 L18.75 15.9 L12 19.8 L5.25 15.9 L5.25 8.1 Z" />
          <circle cx="12" cy="12" r="3.6" fill={accent} />
        </g>
      );

    case 'Dragon':
      // Drachenschwinge
      return (
        <path fill={sym} d="M7 8 C7 8 5.5 11 7 14 C8 16 10 16.5 10 16.5 C10 16.5 9 18 10 18.5 C11 19 13 19 14 18.5 C15 18 14 16.5 14 16.5 C14 16.5 16 16 17 14 C18.5 11 17 8 17 8 C15 6 12 5.5 9 6.5 Z" />
      );

    case 'Fairy':
      // 4-Blüten Blume mit Herz-Mitte
      return (
        <g fill={sym}>
          <ellipse cx="12" cy="8"  rx="2.8" ry="4" />
          <ellipse cx="12" cy="8"  rx="2.8" ry="4" transform="rotate(90 12 12)" />
          <ellipse cx="12" cy="8"  rx="2.8" ry="4" transform="rotate(180 12 12)" />
          <ellipse cx="12" cy="8"  rx="2.8" ry="4" transform="rotate(270 12 12)" />
          {/* Herz in der Mitte */}
          <path d="M12 14.5 C11 13.5 9.5 13 9.5 11.5 C9.5 10.5 10.5 10 12 11.5 C13.5 10 14.5 10.5 14.5 11.5 C14.5 13 13 13.5 12 14.5Z"
            fill={accent} />
        </g>
      );
  }
}

interface Props {
  type: EnergyType;
  size?: number;
  className?: string;
  /** Erzwingt eine einheitliche Farbe statt der Typ-eigenen Kreis-/Akzent-
   *  farben — Kreis-Hintergrund entfällt dann, nur das Symbol wird in dieser
   *  Farbe gezeichnet (wie ein einfarbiges Glyph, z.B. für "geprägt wie
   *  Text"-Kontexte auf BinderCover). */
  color?: string;
}

export function EnergyIcon({ type, size = 24, className = '', color }: Props) {
  // Gespeicherte Mechanik kann deutsche Energienamen enthalten (z.B. „Unlicht")
  // → auf EN normalisieren; unbekannte Werte → kein Icon (kein Crash).
  const t = normalizeEnergy(type) as EnergyType;
  const meta = ENERGY_META[t];
  if (!meta) return null;
  const { bg } = meta;
  // Eigene, TCG-Stil Inline-Glyphen (Pflanze = Blatt, Feuer = Flamme …) auf
  // farbiger Scheibe. Symbol WEISS auf dunklen Scheiben (Pflanze/Feuer/…),
  // dunkel auf hellen (Elektro-Gelb, Farblos-Grau, Metall) — via
  // readableTextColor, damit es überall lesbar bleibt (offizieller Look).
  // `color` (BinderCover-Prägung) → monochromes Glyph ohne Scheibe.
  const sym = color ?? readableTextColor(bg, '#ffffff');
  const accent = color ?? bg; // Aussparungen zeigen im Default die Scheibenfarbe
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-label={meta.de}>
      {!color && <circle cx="12" cy="12" r="11.5" fill={bg} />}
      <InnerSymbol type={t} sym={sym} accent={accent} />
    </svg>
  );
}
