'use client';

import { useId, type CSSProperties } from 'react';
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
 *  werden, hellt stattdessen dezent auf. Weiß bekommt bewusst KEINEN
 *  Sonderfall mehr (vorher reines Weiß) — läuft durch dieselbe Abdunkeln-
 *  Logik wie jede andere Paletten-Farbe. */
function coverAccentColor(bg: string, amount?: number): string {
  if (bg?.toLowerCase() === '#2c2e33') return embossTextColor(bg, amount ?? 0.21, 255);
  return embossTextColor(bg, amount ?? 0.26, 0);
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
// Rechter Eckradius konzentrisch zur tatsächlichen Kachel-Rundung (20px CSS)
// berechnet: gemessene Kachelbreite 165.5px → Skalierungsfaktor 300/165.5 ≈
// 1.813 → Außenradius ≈ 36.25 Einheiten, abzüglich des Naht-Insets (5)
// ergibt den Naht-eigenen Radius von ≈31.
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
// Deckel (oben, Kanten berühren die Kachel-Ecken) und Körper (unten, an den
// Seiten leicht eingezogen) sind zwei eigenständige Rechtecke, die exakt an
// der Deckel-Unterkante zusammenschließen — kein Diagonal-Knick.
const BOX_LID_HEIGHT = 131;
const BOX_LID_PATH  = 'M9 0 L291 0 Q297 0 297 6 L297 131 L3 131 L3 6 Q3 0 9 0 Z';
const BOX_BODY_PATH = 'M6 131 L294 131 L294 394 Q294 400 288 400 L12 400 Q6 400 6 394 Z';

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

  const fill = coverFillColor(color);
  const isAnthracite = fill?.toLowerCase() === '#2c2e33';
  // NUR Basis-Icons (Lucide, kein type:/set:-Präfix) werden wie der
  // Titel-Text eingefärbt. Typ-Icons (EnergyIcon) und Set-Logos behalten
  // ihre eigenen Farben (Detailgrafik bzw. Typ-Branding) — alle drei
  // Icon-Arten UND der Text teilen sich aber denselben Schatten/Körnung.
  const isColorableIcon = !!icon && !icon.startsWith('type:') && !icon.startsWith('set:');
  // Gleiche Ziel-/Originalgröße wie Typ-/Set-Icons (56px) — Lucide-Glyphen
  // (z.B. "folder") sind aber dünne Outline-Symbole (2px-Strich, viel
  // Leerraum im 24x24-Raster, füllen nur ~70% der Höhe) verglichen mit der
  // randfüllenden, VOLLFLÄCHIGEN Farbe der Typ-Icons (~96%) — deshalb nur
  // die Strichstärke kräftiger, nicht die Größe.
  const iconSize = 56;
  const iconStrokeWidth = isColorableIcon ? 2.75 : undefined;
  // ECHTE (deckende) Farbe, leicht dunkler als die Fläche (coverAccentColor,
  // 40%/15% Anthrazit) — der background-clip:text-Trick wurde verworfen,
  // weil der helle Schein bei unserer kleinen Schriftgröße (15-19px) breiter
  // als die Strichstärke selbst war und die dunklere Füllfarbe komplett
  // überdeckt hat, sodass Text/Icon trotz dunklerer Grundfarbe insgesamt
  // heller als der Hintergrund wirkten. Mit einer deckenden dunkleren Farbe
  // ist der Kontrast garantiert richtig herum; der Schein bleibt nur noch
  // als dezenter Zusatz obendrauf.
  const textBgColor = coverAccentColor(fill, isAnthracite ? 0.15 : 0.4);
  // Nur auf Anthrazit/Schwarz zusätzlich einen dunklen Gegenschatten +
  // helleren Schein — auf den übrigen Farben bleibt es beim bisherigen
  // einzelnen, dezenten Schein (unverändert).
  const textShineColor = hexToRgba(embossTextColor(fill, isAnthracite ? 0.6 : 0.55, 255), isAnthracite ? 0.4 : 0.28);
  const engravedTextStyle: CSSProperties = {
    color: textBgColor,
    textShadow: isAnthracite
      ? `${hexToRgba(embossTextColor(fill, 0.6, 0), 0.35)} -0.5px -0.8px 0.4px, ${textShineColor} 0.5px 0.8px 0.4px`
      : `${textShineColor} 0.5px 0.8px 0.4px`,
  };
  // Icons: gleiche (aus der Binderfarbe abgeleitete) Schein-Farbe wie beim
  // Text, aber kräftiger als der Text-Schatten — auf einer durchgehenden
  // Kreis-/Glyphenfläche (Typ-Icon) liest sich der für Text austarierte,
  // sehr dezente Versatz (0.5px/0.8px, Alpha .28) kaum als Prägung, anders
  // als bei dünnen Textstrichen. Zusätzlich die Leder-Körnung direkt auf
  // die Icon-Fläche geblendet (multiply, auf die Icon-eigene Alpha-Form
  // geclippt) — bei Typ-Icons/Set-Logos ist das die einzige Textur-Quelle,
  // da sie (anders als Basis-Icons/Text) keine eigene deckende Farbe
  // bekommen, deren Kontrastrichtung wir steuern könnten (ihre
  // Originalfarben bleiben unverändert erhalten).
  const iconShineColor = hexToRgba(embossTextColor(fill, isAnthracite ? 0.6 : 0.55, 255), 0.5);
  const iconShadowColor = hexToRgba(embossTextColor(fill, 0.7, 0), 0.65);
  const iconShadowFilter = `url(#icon-grain-${uid}) drop-shadow(${iconShadowColor} -1.3px -1.6px 0.6px) drop-shadow(${iconShineColor} 1px 1.3px 0.6px)`;
  const iconColor = isColorableIcon ? textBgColor : undefined;

  return (
    <div
      className={`relative aspect-[3/4] overflow-hidden ${rounding} ${className}`}
    >
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
            <filter id={`leatherbox-${uid}`}>
              <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" result="noise" />
              <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.1 0.1 0.1 0 0" />
            </filter>
          </defs>

          {/* Deckel — eigenes Rechteck mit diagonalem Leder-Glanz */}
          <g clipPath={`url(#lidclip-${uid})`}>
            <rect x="0" y="0" width="300" height={BOX_LID_HEIGHT} fill={fill} />
            <rect x="0" y="0" width="300" height={BOX_LID_HEIGHT} fill={`url(#lidsheen-${uid})`} />
            {/* Ganz feine Leder-Körnung — gleiche Textur wie beim Ordner, sonst
                wirkt v.a. Weiß auf der Box viel reiner/heller als auf dem
                Ordner (dort bricht die Körnung die Fläche bewusst grau). */}
            <rect x="0" y="0" width="300" height={BOX_LID_HEIGHT} filter={`url(#leatherbox-${uid})`} />
          </g>
          {/* Körper — eigenes Rechteck mit leichtem Schatten von oben (fällt unter dem Deckel aus) */}
          <g clipPath={`url(#bodyclip-${uid})`}>
            <rect x="0" y={BOX_LID_HEIGHT} width="300" height={400 - BOX_LID_HEIGHT} fill={fill} />
            <rect x="0" y={BOX_LID_HEIGHT} width="300" height={400 - BOX_LID_HEIGHT} fill={`url(#bodyshadow-${uid})`} />
            <rect x="0" y={BOX_LID_HEIGHT} width="300" height={400 - BOX_LID_HEIGHT} filter={`url(#leatherbox-${uid})`} />
          </g>

          {/* Schlagschatten + gerade Trennlinie an der Deckel-Unterkante */}
          <path d="M3 129 L297 129" stroke="#000" strokeOpacity=".7" strokeWidth="16" transform="translate(0,6)" filter={`url(#lidblur-${uid})`} />
          <path d="M3 131 L297 131" stroke="#000" strokeOpacity=".22" strokeWidth="2.5" />
          {/* Daumenkerbe zum Aufklappen */}
          <ellipse cx="150" cy="6" rx="26" ry="15" fill="#000" fillOpacity=".28" />
          <ellipse cx="150" cy="3" rx="20" ry="9" fill="#fff" fillOpacity=".12" />
        </svg>
      ) : (
        <>
          <div className="absolute inset-0" style={{ background: fill }} />
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
          <div className="absolute inset-x-0 top-0 flex items-center justify-center px-[10px]" style={{ height: '30%' }}>
            {name && (
              <span
                className="font-extrabold text-[17px] text-center leading-tight line-clamp-2"
                style={engravedTextStyle}
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
                size={iconSize}
                strokeWidth={iconStrokeWidth}
                style={{ color: iconColor, filter: iconShadowFilter, maxWidth: '100%', width: 'auto', height: 'auto', maxHeight: iconSize }}
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
                size={iconSize}
                strokeWidth={iconStrokeWidth}
                style={{ color: iconColor, filter: iconShadowFilter, maxWidth: '100%', width: 'auto', height: 'auto', maxHeight: iconSize }}
              />
            </div>
          )}
          {name && (
            <span
              className="font-extrabold text-[19px] text-center leading-tight line-clamp-3 px-[10px]"
              style={engravedTextStyle}
            >
              {name}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
