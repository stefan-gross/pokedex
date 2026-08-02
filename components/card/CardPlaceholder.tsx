'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// useLayoutEffect vermeidet ein sichtbares „Zucken" der Namensgröße; auf dem
// Server (SSR) auf useEffect ausweichen, um die React-Warnung zu vermeiden.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Platzhalter für Karten ohne Bild. Legt die vorhandenen Werte (Name dt., KP,
 * Set-Kürzel, Set-Nummer, Pokédex-Nr.) als Overlay auf eine fertige Karten-
 * vorlage — an denselben, pixel-vermessenen Positionen für beide Fälle:
 *  - `pending` (nicht im Katalog): Hintergrund `pending-card-template.png` +
 *    rotes „?"-Eck-Badge (Bild kommt beim späteren TCGdex-Sync).
 *  - sonst (katalogisiert, aber noch ohne Bild): Hintergrund `no-card-image.png`
 *    ohne Badge.
 * Sobald ein späterer Sync ein echtes (deutsches) Bild liefert, wird statt des
 * Platzhalters das Bild gezeigt (siehe `CardImage`).
 */
export interface CardPlaceholderInfo {
  name: string;
  hp?: number;
  number?: string;
  total?: number;
  dexNumber?: number;
  setCode?: string;
  types?: string[];
  /** true = vorläufige, nicht katalogisierte Karte → Template „nicht im Katalog"
   *  + rotes „?"-Badge. false = katalogisiert, aber Bild fehlt noch. */
  pending?: boolean;
}

export function CardPlaceholder({
  info,
  className,
  style,
  onClick,
}: {
  info: CardPlaceholderInfo;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const { name, hp, number, dexNumber, setCode, pending } = info;

  // Namensgröße: Basis = KP-Wert-Größe (5.8cqw). Nur wenn der Name zu breit wird
  // und sonst ins KP-Feld liefe, schrumpft er gerade so weit, dass er komplett
  // in den verfügbaren Bereich passt (wie auf echten Karten) — kein Überlappen,
  // kein Abschneiden. `cqw` ist breitenrelativ, daher skaliert das mit.
  const NAME_BASE_CQW = 5.8;
  const nameRef = useRef<HTMLSpanElement | null>(null);
  const [nameSizeCqw, setNameSizeCqw] = useState(NAME_BASE_CQW);
  useIsoLayoutEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    el.style.fontSize = `${NAME_BASE_CQW}cqw`;
    const avail = el.clientWidth;   // durch maxWidth begrenzt
    const natural = el.scrollWidth;  // natürliche Textbreite bei Basisgröße
    if (natural > avail && avail > 0) {
      // Faktor 0.94 = kleiner Sicherheitsabstand, damit der ganze Name passt
      // (exakte Randbreite würde sonst weiter „…" abschneiden).
      setNameSizeCqw(Math.max(3.2, Math.round((NAME_BASE_CQW * avail / natural * 0.94) * 100) / 100));
    } else {
      setNameSizeCqw(NAME_BASE_CQW);
    }
  }, [name]);

  const labelShadow = '0 1px 2px rgba(255,255,255,0.85), 0 0 1px rgba(255,255,255,0.9)';
  // Echte Pokémon-Karten: Name/Set/Nummern in Gill Sans (Condensed Extra Bold →
  // hier via höherem Gewicht + leichter scaleX-Stauchung angenähert, da das
  // System-Gill-Sans keinen Condensed-Schnitt hat), KP-Zahl in Futura Bold.
  // Beide sind auf iOS/macOS Systemschriften.
  const cardFont = '"Gill Sans", "Gill Sans MT", "GillSans", "Segoe UI", sans-serif';
  const numFont = '"Futura", "Futura-Bold", "Jost", "Century Gothic", sans-serif';

  // Beide Vorlagen haben denselben Kartenrahmen → identische Overlay-Positionen.
  const bgSrc = pending ? '/pending-card-template.png' : '/no-card-image.png';

  return (
    <div
      className={className}
      style={{ containerType: 'inline-size', position: 'relative', ...style }}
      onClick={onClick}
      role="img"
      aria-label={pending ? `${name} — vorläufig, nicht im Katalog` : `${name} — aktuell kein Bild`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={bgSrc}
        alt=""
        className="absolute inset-0 w-full h-full object-cover rounded-[5%]"
      />
      {/* Rotes „?"-Eck-Badge oben links — NUR bei vorläufigen Karten. Gleiche
          Form/Optik wie das gelbe „!"-Prüfen-Badge (CardBadge, corner="tl"):
          quadratisch, obere linke Ecke = Kartenecke, „?" als Stroke-Icon im
          selben Stil wie das „!". */}
      {pending && (
        <div
          style={{
            position: 'absolute', top: 0, left: 0, width: '17cqw', height: '17cqw',
            background: '#c53030',
            // Maße 1:1 zum gelben „!"-Badge (CardBadge md: 34px auf 200px-Karte
            // = 17 % Breite; Karten-Radius 10px = 5 %): TL = Kartenecke (5cqw),
            // BR = Gegenecke gerundet (5cqw), TR/BL eckig (0).
            borderTopLeftRadius: '5cqw', borderBottomRightRadius: '5cqw',
            borderTopRightRadius: 0, borderBottomLeftRadius: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,.4)',
          }}
        >
          {/* Das „?"-Glyph füllt seine viewBox nur zu ~63 % (Höhe 10/24), das
              „!" dagegen zu 79 % (16/24). Damit „?" GENAUSO groß wirkt wie das
              „!" des CardBadge (Icon = 0.588·Badge), braucht es eine größere
              Box (~0.94·Badge = 16cqw) und einen um 1.6 dünneren Stroke, damit
              die Strichstärke gleich bleibt. */}
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ width: '16cqw', height: '16cqw' }} aria-hidden="true">
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
      )}
      {/* Name — oben, transparent direkt auf die Karte (Text-Schatten für
          Lesbarkeit). */}
      <span
        ref={nameRef}
        style={{
          position: 'absolute', left: '19.5%', top: '4.1%', maxWidth: '44%',
          transform: 'scaleX(0.92) scaleY(1.2)', transformOrigin: 'left center',
          fontFamily: cardFont, fontSize: `${nameSizeCqw}cqw`, fontWeight: 700,
          color: '#141414', lineHeight: 1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          textShadow: labelShadow,
        }}
      >
        {name}
      </span>
      {/* KP — oben rechts, transparent; „KP" schwarz + kleiner, Wert größer. */}
      {hp != null && (
        <span
          style={{
            position: 'absolute', right: '13.3%', top: '4.15%',
            display: 'inline-flex', alignItems: 'baseline', gap: '0.5cqw',
            fontFamily: cardFont, color: '#141414', lineHeight: 1, textShadow: labelShadow,
          }}
        >
          <span style={{ fontFamily: cardFont, fontSize: '2.5cqw', fontWeight: 700 }}>KP</span>
          <span style={{ fontFamily: numFont, fontSize: '5.4cqw', fontWeight: 500, letterSpacing: '-0.02em', WebkitTextStroke: '0.02em #141414', display: 'inline-block', transform: 'scaleY(1.14)', transformOrigin: 'bottom' }}>{hp}</span>
        </span>
      )}
      {/* Pokédex-Nr. — im schmalen Streifen direkt unter dem Artwork-Fenster,
          horizontal Richtung Mitte. */}
      {dexNumber != null && (
        <span style={{ position: 'absolute', left: '40%', top: '47.3%', transform: 'scaleX(0.9)', transformOrigin: 'left center', fontFamily: cardFont, fontSize: '2.6cqw', fontWeight: 600, color: '#3a3a3a', textShadow: labelShadow }}>
          Nr. {dexNumber}
        </span>
      )}
      {/* Set-Kürzel — weiß, mittig in der eingebrannten schwarzen Box (unten
          links), wie die Nummern-Box auf echten Karten. */}
      {setCode && (
        <span style={{ position: 'absolute', left: '9.7%', bottom: '4.28%', width: '5.2%', textAlign: 'center', transform: 'scaleX(0.9)', transformOrigin: 'center', fontFamily: cardFont, fontSize: '2cqw', fontWeight: 700, color: '#fff', lineHeight: 1, whiteSpace: 'nowrap' }}>
          {setCode}
        </span>
      )}
      {/* Set-Nummer — rechtsbündig knapp links neben dem eingebrannten „/"
          (ohne Gesamtzahl, die haben wir nicht). */}
      {number && (
        <span style={{ position: 'absolute', right: '80.6%', bottom: '3.55%', transform: 'scaleX(0.9)', transformOrigin: 'right center', fontFamily: cardFont, fontSize: '2cqw', fontWeight: 700, color: '#2b2b2b', textShadow: labelShadow, lineHeight: 1, whiteSpace: 'nowrap' }}>
          {number}
        </span>
      )}
    </div>
  );
}
