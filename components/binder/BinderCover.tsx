'use client';

import { useId } from 'react';
import { BinderIcon } from '@/lib/binder-icons';

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
const FOLDER_STITCH_INSET = 5;
const FOLDER_STITCH_RIGHT_RADIUS = 22;
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
              <stop offset="0" stopColor="#000" stopOpacity=".22" />
              <stop offset=".35" stopColor="#000" stopOpacity="0" />
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

            {/* Reißverschluss-Griff links, sitzt auf der Naht */}
            <rect x="9" y="14" width="18" height="28" rx="9" fill="rgba(0,0,0,.20)" />
            <rect x="12.5" y="18" width="11" height="16" rx="5.5" fill="rgba(255,255,255,.20)" />

            {/* Umlaufende gesteppte Naht — läuft links flach aus statt zu runden */}
            <path d={FOLDER_STITCH_PATH} stroke="rgba(0,0,0,.22)" strokeWidth="1.8" strokeDasharray="5 4" strokeLinecap="round" />
            <path d={FOLDER_STITCH_PATH} stroke="rgba(255,255,255,.18)" strokeWidth="1" strokeDasharray="5 4" strokeDashoffset="1.5" strokeLinecap="round" />
          </svg>
        </>
      )}

      {/* Feiner Rahmen für einen sauberen Deckel-Kantenabschluss */}
      <div className={`absolute inset-0 ${rounding}`} style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.14)' }} />

      {isBox ? (
        <>
          {/* Name im oberen Bereich (Deckel), oberhalb der Naht */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-center px-4" style={{ height: '30%' }}>
            {name && (
              <span className="text-white font-bold text-sm text-center leading-tight line-clamp-2 drop-shadow-[0_1px_3px_rgba(0,0,0,.35)]">
                {name}
              </span>
            )}
          </div>
          {/* Logo auf der Box, unterhalb der Naht */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center" style={{ top: '33%' }}>
            {icon && (
              <BinderIcon
                name={icon}
                size={56}
                className="drop-shadow-[0_1px_3px_rgba(0,0,0,.35)]"
                style={{ color: '#fff' }}
              />
            )}
          </div>
        </>
      ) : (
        /* Logo + Name mittig */
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
          {icon && (
            <BinderIcon
              name={icon}
              size={56}
              className="drop-shadow-[0_1px_3px_rgba(0,0,0,.35)]"
              style={{ color: '#fff' }}
            />
          )}
          {name && (
            <span className="text-white font-bold text-base text-center leading-tight line-clamp-3 drop-shadow-[0_1px_3px_rgba(0,0,0,.35)]">
              {name}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
