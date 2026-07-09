'use client';

import { useId } from 'react';
import { BinderIcon } from '@/lib/binder-icons';
import { readableTextColor } from '@/lib/color-utils';

/** Geprägter Look NUR für den Titel-Text — Licht kommt gedanklich von oben
 *  links: Schatten oben links (dort, wo die gestanzte Kante vom Licht
 *  abgewandt ist), Schein unten rechts (dort, wo die Kante das Licht
 *  reflektiert). Icon/Logo bleiben ohne Prägung, siehe readableTextColor. */
const EMBOSS_TEXT_SHADOW = '-1px -1px 1px rgba(0,0,0,.4), 1px 1px 1px rgba(255,255,255,.35)';

/** Prägeeffekt braucht dennoch etwas Farbabstand zur Fläche, sonst ist der
 *  Titel trotz Schatten/Schein kaum lesbar (getestet: bei exakter
 *  Flächenfarbe nur bei Schwarz/Weiß noch lesbar, bei bunten Farben nicht
 *  mehr). Deshalb: Text = Flächenfarbe, aber um ~35-45% Richtung
 *  Schwarz/Weiß verschoben (helle Fläche → dunklerer Text, dunkle Fläche →
 *  hellerer Text) — bleibt in der Farbfamilie, ist aber klar lesbar. */
function embossTextColor(bg: string): string {
  if (!bg?.startsWith('#')) return '#ffffff';
  const hex = bg.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const target = luminance > 0.5 ? 0 : 255;
  const amount = luminance > 0.5 ? 0.35 : 0.45;
  const mix = (c: number) => Math.round(c + (target - c) * amount);
  return `#${[r, g, b].map(mix).map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

interface Props {
  /** Sammlungsfarbe (Hex/CSS) — bestimmt die Lederfläche der Grafik. */
  color?: string;
  /** Name der Sammlung — wird als Beschriftung auf dem Deckel platziert. */
  name?: string;
  /** BinderIcon-Schlüssel (Lucide/EnergyIcon/Set-Logo) — großes Logo mittig
   *  (Ordner) bzw. im unteren Bereich (Box). */
  icon?: string;
  /** 'folder' = Ringbuch mit umlaufender Naht, die links flach ausläuft.
   *  'box' = Karton mit Deckel + Körper als zwei eigenständigen Rechtecken,
   *  die exakt an der Deckel-Unterkante zusammenschließen. */
  shape?: 'folder' | 'box';
  className?: string;
}

const ROUNDING = {
  folder: 'rounded-tl-[4px] rounded-bl-[4px] rounded-tr-[20px] rounded-br-[20px]',
  box:    'rounded-[4px]',
};

// ── Ordner ───────────────────────────────────────────────────────────────
// Naht läuft oben/rechts/unten umlaufend, endet links flach (keine Rundung,
// kein Bruch) — dort sitzt statt der Naht ein leichter vertikaler Schatten.
// Rechter Eckradius konzentrisch zur Kachel-Rundung (20px CSS) berechnet:
// gemessener Skalierungsfaktor 300/211 ≈ 1.42 → Außenradius ≈ 28.4 Einheiten,
// abzüglich des Naht-Insets (5) ergibt den Naht-eigenen Radius von 23.
const FOLDER_STITCH_INSET = 5;
const FOLDER_STITCH_RIGHT_RADIUS = 23;
const FOLDER_STITCH_LEFT_X = 6;
const FOLDER_STITCH_PATH = (() => {
  const i = FOLDER_STITCH_INSET;
  const r = FOLDER_STITCH_RIGHT_RADIUS;
  const x = FOLDER_STITCH_LEFT_X;
  return `M${x} ${i} L${300 - i - r} ${i} Q${300 - i} ${i} ${300 - i} ${i + r} `
       + `L${300 - i} ${400 - i - r} Q${300 - i} ${400 - i} ${300 - i - r} ${400 - i} L${x} ${400 - i}`;
})();

// ── Box ──────────────────────────────────────────────────────────────────
// Deckel (oben, Kanten berühren die Kachel-Ecken) und Körper (unten, an den
// Seiten leicht eingezogen) sind zwei eigenständige Rechtecke, die exakt an
// der Deckel-Unterkante zusammenschließen — kein Diagonal-Knick.
const BOX_LID_HEIGHT = 131;
const BOX_LID_PATH  = 'M9 0 L291 0 Q297 0 297 6 L297 131 L3 131 L3 6 Q3 0 9 0 Z';
const BOX_BODY_PATH = 'M6 131 L294 131 L294 394 Q294 400 288 400 L12 400 Q6 400 6 394 Z';
const BOX_STITCH_PATH = 'M11 134 L11 386 Q11 394 19 394 L281 394 Q289 394 289 386 L289 134';

/**
 * Bindergrafik — Ringbuch-Deckel (Leder-Optik, umlaufende Naht die links
 * flach ausläuft + vertikaler Schatten dort statt Rundung) oder Karton
 * (Deckel mit diagonalem Glanz, Körper mit vertikalem Schatten von oben,
 * Naht nur am Körper). Farbe/Name/Logo sind frei parametrisiert, damit jede
 * Sammlung ihre eigene Deckel-Ansicht bekommt.
 */
export function BinderCover({ color = 'var(--pokedex-red)', name, icon, shape = 'folder', className = '' }: Props) {
  const isBox = shape === 'box';
  const rounding = ROUNDING[shape];
  const uid = useId().replace(/:/g, '');

  const outerShadow = isBox ? '0 3px 8px rgba(0,0,0,.10)' : '0 6px 18px rgba(0,0,0,.18)';
  // Icon/Logo: voller Kontrast, keine Prägung. Titel-Text: dezenter
  // Farbversatz + Prägeschatten (siehe embossTextColor-Kommentar oben).
  const iconColor = readableTextColor(color);
  const textColor = embossTextColor(color);

  return (
    <div
      className={`relative aspect-[3/4] overflow-hidden ${rounding} ${className}`}
      style={{ boxShadow: outerShadow }}
    >
      {isBox ? (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 300 400" fill="none" preserveAspectRatio="none">
          <defs>
            <filter id={`lidblur-${uid}`} x="-10%" y="-100%" width="120%" height="300%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
            <linearGradient id={`lidsheen-${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".38" />
              <stop offset=".2" stopColor="#fff" stopOpacity=".1" />
              <stop offset=".42" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`bodyshadow-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#000" stopOpacity=".14" />
              <stop offset=".16" stopColor="#000" stopOpacity="0" />
            </linearGradient>
            <clipPath id={`lidclip-${uid}`}><path d={BOX_LID_PATH} /></clipPath>
            <clipPath id={`bodyclip-${uid}`}><path d={BOX_BODY_PATH} /></clipPath>
          </defs>

          {/* Deckel — eigenes Rechteck mit diagonalem Leder-Glanz */}
          <g clipPath={`url(#lidclip-${uid})`}>
            <rect x="0" y="0" width="300" height={BOX_LID_HEIGHT} fill={color} />
            <rect x="0" y="0" width="300" height={BOX_LID_HEIGHT} fill={`url(#lidsheen-${uid})`} />
          </g>
          {/* Körper — eigenes Rechteck mit leichtem Schatten von oben (fällt unter dem Deckel aus) */}
          <g clipPath={`url(#bodyclip-${uid})`}>
            <rect x="0" y={BOX_LID_HEIGHT} width="300" height={400 - BOX_LID_HEIGHT} fill={color} />
            <rect x="0" y={BOX_LID_HEIGHT} width="300" height={400 - BOX_LID_HEIGHT} fill={`url(#bodyshadow-${uid})`} />
          </g>

          {/* Schlagschatten + gerade Trennlinie an der Deckel-Unterkante */}
          <path d="M3 129 L297 129" stroke="#000" strokeOpacity=".7" strokeWidth="16" transform="translate(0,6)" filter={`url(#lidblur-${uid})`} />
          <path d="M3 131 L297 131" stroke="#000" strokeOpacity=".22" strokeWidth="2.5" />
          {/* Daumenkerbe zum Aufklappen */}
          <ellipse cx="150" cy="6" rx="26" ry="15" fill="#000" fillOpacity=".28" />
          <ellipse cx="150" cy="3" rx="20" ry="9" fill="#fff" fillOpacity=".12" />

          {/* Gesteppte Naht — nur am Körper (links unten, unten, rechts unten), Deckel bleibt nahtlos */}
          <path d={BOX_STITCH_PATH} stroke="#000" strokeOpacity=".22" strokeWidth="1.8" strokeDasharray="5 4" strokeLinecap="round" />
          <path d={BOX_STITCH_PATH} stroke="#fff" strokeOpacity=".18" strokeWidth="1" strokeDasharray="5 4" strokeDashoffset="1.5" strokeLinecap="round" />
        </svg>
      ) : (
        <>
          <div className="absolute inset-0" style={{ background: color }} />
          {/* Leder-/Vinyl-Glanzlicht — diagonaler heller Verlauf oben links */}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,.38) 0%, rgba(255,255,255,.10) 20%, rgba(255,255,255,0) 42%)' }}
          />
          {/* Abdunklung unten für Tiefe/Rundung */}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(0deg, rgba(0,0,0,.20) 0%, rgba(0,0,0,0) 32%)' }}
          />
          {/* Leichter vertikaler Schatten links — dort, wo die Naht flach ausläuft statt zu runden */}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(90deg, rgba(0,0,0,.3) 0%, rgba(0,0,0,0) 9%)' }}
          />

          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 300 400" fill="none" preserveAspectRatio="none">
            <defs>
              <filter id={`leather-${uid}`}>
                <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" result="noise" />
                <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.1 0.1 0.1 0 0" />
              </filter>
            </defs>
            {/* Ganz feine Leder-Körnung */}
            <rect x="0" y="0" width="300" height="400" filter={`url(#leather-${uid})`} />

            {/* Umlaufende gesteppte Naht — läuft links flach aus statt zu runden */}
            <path d={FOLDER_STITCH_PATH} stroke="rgba(0,0,0,.22)" strokeWidth="1.8" strokeDasharray="5 4" strokeLinecap="round" />
            <path d={FOLDER_STITCH_PATH} stroke="rgba(255,255,255,.18)" strokeWidth="1" strokeDasharray="5 4" strokeDashoffset="1.5" strokeLinecap="round" />
          </svg>
        </>
      )}

      {isBox ? (
        <>
          {/* Name im oberen Bereich (Deckel), oberhalb der Naht */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-center px-6" style={{ height: '30%' }}>
            {name && (
              <span
                className="font-bold text-sm text-center leading-tight line-clamp-2"
                style={{ color: textColor, textShadow: EMBOSS_TEXT_SHADOW }}
              >
                {name}
              </span>
            )}
          </div>
          {/* Logo auf der Box, unterhalb der Naht — nur 5px Rand links/rechts */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center px-[10px]" style={{ top: '33%' }}>
            {icon && (
              <BinderIcon
                name={icon}
                size={56}
                style={{ color: iconColor, filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.35))', maxWidth: '100%', width: 'auto', height: 'auto', maxHeight: 56 }}
              />
            )}
          </div>
        </>
      ) : (
        /* Logo + Name mittig — Logo nur 5px Rand links/rechts (eigener
           Wrapper, damit der Name weiterhin mehr Innenabstand behält) */
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          {icon && (
            <div className="flex justify-center w-full px-[10px]">
              <BinderIcon
                name={icon}
                size={56}
                style={{ color: iconColor, filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.35))', maxWidth: '100%', width: 'auto', height: 'auto', maxHeight: 56 }}
              />
            </div>
          )}
          {name && (
            <span
              className="font-bold text-base text-center leading-tight line-clamp-3 px-6"
              style={{ color: textColor, textShadow: EMBOSS_TEXT_SHADOW }}
            >
              {name}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
