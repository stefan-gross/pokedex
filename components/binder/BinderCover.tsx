'use client';

import { useId, type CSSProperties, type ReactNode } from 'react';
import { BinderIcon } from '@/lib/binder-icons';

function hexToRgba(hex: string, alpha: number): string {
  const full = hex.replace('#', '');
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Prägeeffekt braucht dennoch etwas Farbabstand zur Fläche, sonst ist der
 *  Titel trotz Schatten/Schein kaum lesbar. Richtung ist bewusst FEST
 *  vorgegeben (nicht mehr per 50%-Helligkeits-Schwelle automatisch bestimmt)
 *  — bei nahe an der Schwelle liegenden Farben (z.B. Rot 44% vs. Blau 53%)
 *  kippte die Richtung sonst uneinheitlich zwischen "heller"/"dunkler", was
 *  sich willkürlich anfühlte. Standard: immer Richtung Schwarz abgedunkelt;
 *  nur der Anthrazit-Sonderfall (siehe coverAccentColor) hellt auf, da er
 *  selbst schon nahe Schwarz ist. */
function embossTextColor(bg: string, amount = 0.32, target: 0 | 255 = 0): string {
  if (!bg?.startsWith('#')) return '#ffffff';
  const hex = bg.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (target - c) * amount);
  return `#${[r, g, b].map(mix).map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Reines Schwarz (#1a1a1a) wirkt mit Leder-Körnung/Glanz-Overlays eher grau
 *  als geplant — für die Deckel-Fläche selbst auf ein dezentes Anthrazit
 *  angehoben. Nur die Darstellung, der in Firestore gespeicherte Farbwert
 *  bleibt unverändert. */
function coverFillColor(bg: string): string {
  return bg?.toLowerCase() === '#1a1a1a' ? '#2c2e33' : bg;
}

/** Text-/Icon-Farbe auf dem Deckel: EIN Stil für alle Farben — Prägeeffekt
 *  durch Abdunkeln Richtung Schwarz. Einziger Sonderfall: Anthrazit (die
 *  Schwarz-Darstellung, siehe coverFillColor) kann nicht weiter abgedunkelt
 *  werden, hellt stattdessen dezent auf. */
function coverAccentColor(bg: string, amount?: number): string {
  if (bg?.toLowerCase() === '#2c2e33') return embossTextColor(bg, amount ?? 0.21, 255);
  return embossTextColor(bg, amount ?? 0.26, 0);
}

interface CoverProps {
  /** Sammlungsfarbe (Hex/CSS) — bestimmt die Lederfläche der Grafik. */
  color?: string;
  /** Name der Sammlung — wird als Beschriftung auf dem Deckel platziert. */
  name?: string;
  /** BinderIcon-Schlüssel (Lucide/EnergyIcon/Set-Logo). */
  icon?: string;
  className?: string;
  /** Optionaler Badge-Slot (z.B. `CollectionTypeCornerBadge`), oben links in
   *  die Ecke eingenistet — positioniert sich selbst absolut. Liegt INNERHALB
   *  des `overflow-hidden`-Deckels, daher nur für eingerückte Ecken-Badges
   *  gedacht (nicht für aus der Ecke ragende Elemente). */
  badge?: ReactNode;
}

/** Eckenrundung je Form — die BEIDEN Cover-Komponenten unten nutzen jeweils
 *  ihren eigenen Eintrag. Wird auch von `CollectionTypeCornerBadge` (shape)
 *  genutzt, damit der Badge-Eckradius zur Kachelecke passt (flush nesten). */
export const COVER_ROUNDING = {
  folder: 'rounded-tl-[4px] rounded-bl-[4px] rounded-tr-[20px] rounded-br-[20px]',
  box:    'rounded-[4px]',
};
/** Tatsächlicher Radius der oberen LINKEN Ecke je Form (px) — dort sitzt das
 *  Ecken-Badge; sein `cornerRadius` wird darauf angeglichen. */
export const COVER_TL_RADIUS = { folder: 4, box: 4 } as const;

// ── Ordner ───────────────────────────────────────────────────────────────
const FOLDER_STITCH_INSET = 5;
const FOLDER_STITCH_RIGHT_RADIUS = 31;
const FOLDER_STITCH_LEFT_X = 6;
const FOLDER_STITCH_PATH = (() => {
  const i = FOLDER_STITCH_INSET;
  const r = FOLDER_STITCH_RIGHT_RADIUS;
  const x = FOLDER_STITCH_LEFT_X;
  return `M${x} ${i} L${300 - i - r} ${i} Q${300 - i} ${i} ${300 - i} ${i + r} `
       + `L${300 - i} ${400 - i - r} Q${300 - i} ${400 - i} ${300 - i - r} ${400 - i} L${x} ${400 - i}`;
})();

// ── Box ──────────────────────────────────────────────────────────────────
const BOX_LID_HEIGHT = 131;
const BOX_BODY_INSET = 4;
const BOX_BODY_LEFT = 3 + BOX_BODY_INSET;
const BOX_BODY_RIGHT = 297 - BOX_BODY_INSET;
const BOX_LID_DIP = 24;
const BOX_LID_PATH  = `M9 0 L291 0 Q297 0 297 6 L297 ${BOX_LID_HEIGHT} `
  + `C297 ${BOX_LID_HEIGHT + BOX_LID_DIP} 3 ${BOX_LID_HEIGHT + BOX_LID_DIP} 3 ${BOX_LID_HEIGHT} L3 6 Q3 0 9 0 Z`;
const BOX_BODY_PATH = `M${BOX_BODY_LEFT} ${BOX_LID_HEIGHT} C${BOX_BODY_LEFT} ${BOX_LID_HEIGHT + BOX_LID_DIP} ${BOX_BODY_RIGHT} ${BOX_LID_HEIGHT + BOX_LID_DIP} ${BOX_BODY_RIGHT} ${BOX_LID_HEIGHT} `
  + `L${BOX_BODY_RIGHT} 394 Q${BOX_BODY_RIGHT} 400 ${BOX_BODY_RIGHT - 6} 400 L${BOX_BODY_LEFT + 6} 400 Q${BOX_BODY_LEFT} 400 ${BOX_BODY_LEFT} 394 Z`;
const BOX_SHADOW_BAND = 11;
const BOX_SHADOW_PATH = `M${BOX_BODY_LEFT} ${BOX_LID_HEIGHT} C${BOX_BODY_LEFT} ${BOX_LID_HEIGHT + BOX_LID_DIP} ${BOX_BODY_RIGHT} ${BOX_LID_HEIGHT + BOX_LID_DIP} ${BOX_BODY_RIGHT} ${BOX_LID_HEIGHT} `
  + `L${BOX_BODY_RIGHT} ${BOX_LID_HEIGHT + BOX_SHADOW_BAND} `
  + `C${BOX_BODY_RIGHT} ${BOX_LID_HEIGHT + BOX_LID_DIP + BOX_SHADOW_BAND} ${BOX_BODY_LEFT} ${BOX_LID_HEIGHT + BOX_LID_DIP + BOX_SHADOW_BAND} ${BOX_BODY_LEFT} ${BOX_LID_HEIGHT + BOX_SHADOW_BAND} Z`;
const BOX_STITCH_INSET = 5;
const BOX_STITCH_RADIUS = 5;
const BOX_STITCH_PATH = (() => {
  const i = BOX_STITCH_INSET;
  const r = BOX_STITCH_RADIUS;
  const top = BOX_LID_HEIGHT + i;
  const bottom = 400 - i;
  const left = BOX_BODY_LEFT + i;
  const right = BOX_BODY_RIGHT - i;
  return `M${left} ${top} L${left} ${bottom - r} Q${left} ${bottom} ${left + r} ${bottom} `
       + `L${right - r} ${bottom} Q${right} ${bottom} ${right} ${bottom - r} L${right} ${top}`;
})();

const ICON_SIZE_MULTIPLIER: Record<string, number> = { cards: 1.35 };

/** Geteilte Deckel-Optik (Farbe/Prägung/Icon-Stil + Körnungs-Filter) für BEIDE
 *  Cover-Komponenten — vorher inline im einzigen `BinderCover`, jetzt einmal
 *  hier, damit Ordner und Box sich nichts duplizieren. */
function useCoverChrome(color: string, icon?: string) {
  const uid = useId().replace(/:/g, '');
  const fill = coverFillColor(color);
  const isAnthracite = fill?.toLowerCase() === '#2c2e33';
  const isColorableIcon = !!icon && !icon.startsWith('type:') && !icon.startsWith('set:');
  const iconSize = 56;
  const iconStrokeWidth = isColorableIcon ? 2.75 : undefined;
  const isPokemonIcon = icon?.startsWith('pokemon:') ?? false;
  const iconRenderSize = isPokemonIcon
    ? iconSize * 2.4
    : iconSize * (ICON_SIZE_MULTIPLIER[icon ?? ''] ?? 1);
  const textBgColor = coverAccentColor(fill, isAnthracite ? 0.15 : 0.4);
  const textShineColor = hexToRgba(embossTextColor(fill, isAnthracite ? 0.6 : 0.55, 255), isAnthracite ? 0.4 : 0.28);
  const engravedTextStyle: CSSProperties = {
    color: textBgColor,
    textShadow: isAnthracite
      ? `${hexToRgba(embossTextColor(fill, 0.6, 0), 0.35)} -0.5px -0.8px 0.4px, ${textShineColor} 0.5px 0.8px 0.4px`
      : `${textShineColor} 0.5px 0.8px 0.4px`,
    filter: `url(#icon-grain-${uid})`,
    opacity: 0.7,
  };
  const iconShineColor = hexToRgba(embossTextColor(fill, isAnthracite ? 0.6 : 0.55, 255), 0.5);
  const iconShadowColor = hexToRgba(embossTextColor(fill, 0.7, 0), 0.65);
  const iconShadowFilter = `url(#icon-grain-${uid}) drop-shadow(${iconShadowColor} -1.3px -1.6px 0.6px) drop-shadow(${iconShineColor} 1px 1.3px 0.6px)`;
  const iconColor = isColorableIcon ? textBgColor : undefined;

  const grainFilter = (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <filter id={`icon-grain-${uid}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.18 0.18 0.18 0 0" result="grain" />
          <feComposite in="grain" in2="SourceAlpha" operator="in" result="grainClipped" />
          <feBlend in="SourceGraphic" in2="grainClipped" mode="multiply" />
        </filter>
      </defs>
    </svg>
  );

  const renderIcon = () => icon && (
    <BinderIcon
      name={icon}
      size={iconRenderSize}
      strokeWidth={iconStrokeWidth}
      style={{ color: iconColor, filter: iconShadowFilter, opacity: isColorableIcon ? 0.7 : 0.88, maxWidth: '100%', width: 'auto', height: 'auto', maxHeight: iconRenderSize }}
    />
  );

  return { uid, fill, engravedTextStyle, grainFilter, renderIcon };
}

/**
 * Ringbuch-Deckel (Leder-Optik, umlaufende Naht die links flach ausläuft +
 * vertikaler Schatten dort statt Rundung), Logo + Name mittig. Farbe/Name/Logo
 * frei parametrisiert; optionaler `badge`-Slot oben links.
 */
export function BinderCover({ color = 'var(--pokedex-red)', name, icon, className = '', badge }: CoverProps) {
  const c = useCoverChrome(color, icon);
  return (
    <div className={`relative aspect-[3/4] overflow-hidden ${COVER_ROUNDING.folder} ${className}`}>
      {c.grainFilter}
      <div className="absolute inset-0" style={{ background: c.fill }} />
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
          <filter id={`leather-${c.uid}`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.1 0.1 0.1 0 0" />
          </filter>
        </defs>
        {/* Ganz feine Leder-Körnung */}
        <rect x="0" y="0" width="300" height="400" filter={`url(#leather-${c.uid})`} />
        {/* Umlaufende gesteppte Naht — läuft links flach aus statt zu runden */}
        <path d={FOLDER_STITCH_PATH} stroke="rgba(0,0,0,.22)" strokeWidth="1.8" strokeDasharray="5 4" strokeLinecap="round" />
        <path d={FOLDER_STITCH_PATH} stroke="rgba(255,255,255,.18)" strokeWidth="1" strokeDasharray="5 4" strokeDashoffset="1.5" strokeLinecap="round" />
      </svg>

      {/* Logo + Name mittig */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        {icon && <div className="flex justify-center w-full px-[10px]">{c.renderIcon()}</div>}
        {name && (
          <span className="font-extrabold text-[19px] text-center leading-tight line-clamp-3 px-[10px]" style={c.engravedTextStyle}>
            {name}
          </span>
        )}
      </div>

      {badge}
    </div>
  );
}

/**
 * Karton (Deckel mit diagonalem Glanz, Körper mit vertikalem Schatten von
 * oben, Naht nur am Körper). Name im Deckel, Logo unten. Optionaler
 * `badge`-Slot oben links.
 */
export function BoxCover({ color = 'var(--pokedex-red)', name, icon, className = '', badge }: CoverProps) {
  const c = useCoverChrome(color, icon);
  return (
    <div className={`relative aspect-[3/4] overflow-hidden ${COVER_ROUNDING.box} ${className}`}>
      {c.grainFilter}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 300 400" fill="none" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`lidsheen-${c.uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".38" />
            <stop offset=".2" stopColor="#fff" stopOpacity=".1" />
            <stop offset=".42" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`lidclip-${c.uid}`}><path d={BOX_LID_PATH} /></clipPath>
          <clipPath id={`bodyclip-${c.uid}`}><path d={BOX_BODY_PATH} /></clipPath>
          <filter id={`leatherbox-${c.uid}`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.1 0.1 0.1 0 0" />
          </filter>
          <filter id={`boxshadowblur-${c.uid}`} x="-20%" y="-60%" width="140%" height="240%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* Deckel */}
        <g clipPath={`url(#lidclip-${c.uid})`}>
          <rect x="0" y="0" width="300" height={BOX_LID_HEIGHT + BOX_LID_DIP} fill={c.fill} />
          <rect x="0" y="0" width="300" height={BOX_LID_HEIGHT + BOX_LID_DIP} fill={`url(#lidsheen-${c.uid})`} />
          <rect x="0" y="0" width="300" height={BOX_LID_HEIGHT + BOX_LID_DIP} filter={`url(#leatherbox-${c.uid})`} />
        </g>
        {/* Körper */}
        <g clipPath={`url(#bodyclip-${c.uid})`}>
          <rect x="0" y={BOX_LID_HEIGHT} width="300" height={400 - BOX_LID_HEIGHT} fill={c.fill} />
          <rect x="0" y={BOX_LID_HEIGHT} width="300" height={400 - BOX_LID_HEIGHT} filter={`url(#leatherbox-${c.uid})`} />
          <path d={BOX_SHADOW_PATH} fill="#000" fillOpacity=".18" filter={`url(#boxshadowblur-${c.uid})`} />
        </g>

        {/* Feine Trennlinie an der Deckel-Unterkante */}
        <path d={`M3 ${BOX_LID_HEIGHT} C3 ${BOX_LID_HEIGHT + BOX_LID_DIP} 297 ${BOX_LID_HEIGHT + BOX_LID_DIP} 297 ${BOX_LID_HEIGHT}`} stroke="#000" strokeOpacity=".22" strokeWidth="2.5" />
        {/* Daumenkerbe zum Aufklappen */}
        <ellipse cx="150" cy="6" rx="26" ry="15" fill="#000" fillOpacity=".28" />
        <ellipse cx="150" cy="3" rx="20" ry="9" fill="#fff" fillOpacity=".12" />
        {/* Naht am Körper — läuft oben offen (dort sitzt bereits die Trennlinie) */}
        <path d={BOX_STITCH_PATH} stroke="rgba(0,0,0,.22)" strokeWidth="1.8" strokeDasharray="5 4" strokeLinecap="round" />
        <path d={BOX_STITCH_PATH} stroke="rgba(255,255,255,.18)" strokeWidth="1" strokeDasharray="5 4" strokeDashoffset="1.5" strokeLinecap="round" />
      </svg>

      {/* Name im oberen Bereich (Deckel), oberhalb der Naht */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-center px-[10px]" style={{ height: '30%' }}>
        {name && (
          <span className="font-extrabold text-[17px] text-center leading-tight line-clamp-2" style={c.engravedTextStyle}>
            {name}
          </span>
        )}
      </div>
      {/* Logo auf der Box, unterhalb der Naht */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center px-[10px]" style={{ top: '33%' }}>
        {icon && c.renderIcon()}
      </div>

      {badge}
    </div>
  );
}
