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
  /** 'folder' = Ringbuch mit gerader Naht links (Standard).
   *  'box' = Karton mit ringsum kleiner Rundung + geschwungener Deckel-Naht bei 1/3 Höhe. */
  shape?: 'folder' | 'box';
  className?: string;
}

const ROUNDING = {
  folder: 'rounded-tl-[4px] rounded-bl-[4px] rounded-tr-[20px] rounded-br-[20px]',
  box:    'rounded-[4px]',
};

// Eckradien der umlaufenden gesteppten Kontur-Naht — links klein (Ordner-Bindung
// bzw. Karton-Ecke), rechts groß beim Ordner, ebenfalls klein bei der Box.
const STITCH_CORNER = {
  folder: { left: 6, right: 22 },
  box:    { left: 8, right: 8 },
};
const STITCH_INSET = 5;        // oben/rechts/unten — nah an der Kontur
const FOLDER_LEFT_INSET = 18;  // linke Bindungsnaht — deutlich größerer Abstand zur Kante

const BOX_LID_PATH = 'M0 128 Q 18 133.3 36 133.3 L 264 133.3 Q 282 133.3 300 128';

/** Umlaufende gesteppte Kontur-Naht (geschlossener Pfad) — folgt den Ecken des
 *  jeweiligen Formats. Beim Ordner liegt die linke Seite weiter von der Kante
 *  entfernt (FOLDER_LEFT_INSET) als oben/rechts/unten; die Eckenkurven gleichen
 *  den Versatz sanft aus, statt einen scharfen Knick zu erzeugen. */
function stitchPath(shape: 'folder' | 'box') {
  const { left: l, right: r } = STITCH_CORNER[shape];
  const i = STITCH_INSET;
  const L = shape === 'folder' ? FOLDER_LEFT_INSET : i;
  return `M${L} ${i + l} Q ${L} ${i} ${i + l} ${i} `
       + `L ${300 - i - r} ${i} Q ${300 - i} ${i} ${300 - i} ${i + r} `
       + `L ${300 - i} ${400 - i - r} Q ${300 - i} ${400 - i} ${300 - i - r} ${400 - i} `
       + `L ${i + l} ${400 - i} Q ${L} ${400 - i} ${L} ${400 - i - l} Z`;
}

/**
 * Bindergrafik — Ringbuch-Deckel (umlaufende gestrichelte Naht, links mit
 * größerem Abstand zur Kante) oder Karton (kleine Rundung ringsum, geschwungene
 * Deckel-Naht bei 1/3 Höhe mit dazu passendem, der Kurve folgendem Schlagschatten).
 * Farbe/Name/Logo sind frei parametrisiert, damit jede Sammlung ihre eigene
 * Deckel-Ansicht bekommt.
 */
export function BinderCover({ color = 'var(--pokedex-red)', name, icon, shape = 'folder', className = '' }: Props) {
  const isBox = shape === 'box';
  const rounding = ROUNDING[shape];
  const stitch = stitchPath(shape);
  const filterId = `lid-shadow-${useId().replace(/:/g, '')}`;

  return (
    <div
      className={`relative aspect-[3/4] overflow-hidden ${rounding} ${className}`}
      style={{ background: color, boxShadow: '0 6px 18px rgba(0,0,0,.18)' }}
    >
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

      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 300 400" fill="none" preserveAspectRatio="none">
        {isBox && (
          <>
            <defs>
              <filter id={filterId} x="-10%" y="-100%" width="120%" height="300%">
                <feGaussianBlur stdDeviation="2.5" />
              </filter>
            </defs>
            {/* Schlagschatten unter der Deckel-Naht — folgt exakt derselben
                Kurve wie die Naht selbst (statt eines starren Balkens), wirkt
                wie ein leicht überlappender Kartondeckel */}
            <path d={BOX_LID_PATH} stroke="rgba(0,0,0,.45)" strokeWidth="9" transform="translate(0,5)" filter={`url(#${filterId})`} />
            {/* Geschwungene Deckel-Naht bei 1/3 Höhe — an den Ecken leicht nach oben abgerundet */}
            <path d={BOX_LID_PATH} stroke="rgba(0,0,0,.16)" strokeWidth="2.5" />
            <path d="M0 129.5 Q 18 134.8 36 134.8 L 264 134.8 Q 282 134.8 300 129.5" stroke="rgba(255,255,255,.22)" strokeWidth="1" />
          </>
        )}
        {!isBox && (
          /* Reißverschluss-Griff links, sitzt auf der umlaufenden Naht */
          <>
            <rect x="9" y="14" width="18" height="28" rx="9" fill="rgba(0,0,0,.20)" />
            <rect x="12.5" y="18" width="11" height="16" rx="5.5" fill="rgba(255,255,255,.20)" />
          </>
        )}

        {/* Umlaufende gesteppte Kontur-Naht — beim Ordner links UND rechts/oben/unten
            als ein zusammenhängender gestrichelter Pfad */}
        <path d={stitch} stroke="rgba(0,0,0,.22)" strokeWidth="1.8" strokeDasharray="5 4" strokeLinecap="round" />
        <path d={stitch} stroke="rgba(255,255,255,.18)" strokeWidth="1" strokeDasharray="5 4" strokeDashoffset="1.5" strokeLinecap="round" />
      </svg>

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
