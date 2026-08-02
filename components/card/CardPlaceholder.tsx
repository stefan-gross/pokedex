'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ENERGY_META, EnergyIcon, type EnergyType } from '@/components/ui/EnergyIcon';

// useLayoutEffect vermeidet ein sichtbares „Zucken" der Namensgröße; auf dem
// Server (SSR) auf useEffect ausweichen, um die React-Warnung zu vermeiden.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Platzhalter für Karten ohne Bild (weder TCGdex noch Backfill haben eins).
 * Nachempfundene Pokémon-Karte mit realistischen Proportionen: farbiger
 * Typ-Rahmen, Kartenkörper, Artwork-Fenster in der oberen Kartenhälfte (mit
 * „Bild fehlt"), Pokédex-Nr. direkt darunter, unten links Set-Kürzel +
 * Nummer/PrintedTotal. Zeigt die vorhandenen Infos (Name dt., KP, Set, Dex).
 *
 * Bewusst KEIN 1:1-Nachbau der offiziellen Pokémon-Kartengestaltung (kein
 * gelber Trade-Dress-Rahmen) — nur eine erkennbare, generische Kartenoptik.
 * Sobald ein späterer TCGdex-Sync ein echtes (deutsches) Bild liefert, wird
 * statt dieses Platzhalters das Bild gezeigt.
 */
export interface CardPlaceholderInfo {
  name: string;
  hp?: number;
  number?: string;
  total?: number;
  dexNumber?: number;
  setCode?: string;
  types?: string[];
  /** true = vorläufige, nicht katalogisierte Karte → Hinweis „nicht im Katalog"
   *  statt „Bild fehlt" (das Bild kommt beim späteren Sync). */
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
  const { name, hp, number, total, dexNumber, setCode, types, pending } = info;
  const numberLabel = number ? `${number}${total ? `/${total}` : ''}` : null;

  const t0 = types?.[0];
  const type = (t0 && t0 in ENERGY_META ? t0 : null) as EnergyType | null;

  // Namensgröße: Basis = KP-Wert-Größe (5cqw). Nur wenn der Name zu breit wird
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

  // Vorläufige (nicht im Katalog gefundene) Karte: das vom Nutzer gelieferte
  // Karten-Template als Hintergrund + die erkannten Werte als Overlay. Positionen
  // sind PROZENTUAL (leicht anpassbar, wenn das Template verfeinert wird);
  // Schriftgrößen in `cqw` skalieren mit der Kartenbreite (Container-Query).
  if (pending) {
    const labelShadow = '0 1px 2px rgba(255,255,255,0.85), 0 0 1px rgba(255,255,255,0.9)';
    // Echte Pokémon-Karten: Name/Set/Nummern in Gill Sans (Condensed Extra
    // Bold → hier via weight 900 + leichte scaleX-Stauchung angenähert, da das
    // System-Gill-Sans keinen Condensed-Schnitt hat), KP-Zahl in Futura Bold.
    // Beide sind auf iOS/macOS Systemschriften.
    const cardFont = '"Gill Sans", "Gill Sans MT", "GillSans", "Segoe UI", sans-serif';
    const numFont = '"Futura", "Futura-Bold", "Jost", "Century Gothic", sans-serif';
    return (
      <div
        className={className}
        style={{ containerType: 'inline-size', position: 'relative', ...style }}
        onClick={onClick}
        role="img"
        aria-label={`${name} — vorläufig, nicht im Katalog`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/pending-card-template.png"
          alt=""
          className="absolute inset-0 w-full h-full object-cover rounded-[5%]"
        />
        {/* Rotes „?"-Eck-Badge oben links — gleiche Form/Optik wie das gelbe
            „!"-Prüfen-Badge (CardBadge, corner="tl"): quadratisch, obere linke
            Ecke = Kartenecke, „?" als Stroke-Icon im selben Stil wie das „!". */}
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
        {/* Name — oben, transparent direkt auf die Karte (Text-Schatten für
            Lesbarkeit), etwas kleiner. */}
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

  return (
    <div className={className} style={style} onClick={onClick} role="img" aria-label={`${name} — Bild fehlt`}>
      {/* Gelber Karten-Rand (klassische Pokémon-Optik) */}
      <div
        className="w-full h-full rounded-[5%] p-[4%] shadow-[inset_0_1px_2px_rgba(255,255,255,0.4),0_2px_6px_rgba(0,0,0,0.25)]"
        style={{ background: 'linear-gradient(155deg, #F5CE3E 0%, #E0AC24 55%, #C68E17 100%)' }}
      >
        {/* Kartenkörper (creme) */}
        <div
          className="w-full h-full rounded-[3%] flex flex-col p-[4%] text-[#2b2b2b]"
          style={{ background: 'linear-gradient(160deg, #faf8f2 0%, #ece6d6 100%)' }}
        >
          {/* Kopf: Name + KP + Typ-Icon */}
          <div className="flex items-center justify-between gap-1.5 pb-[3%]">
            <span className="font-bold text-[11px] leading-tight truncate">{name}</span>
            <span className="flex items-center gap-1 shrink-0">
              {hp != null && (
                <span className="font-extrabold text-[10px] leading-none">
                  <span className="text-[#c0392b]">KP</span> {hp}
                </span>
              )}
              {type && <EnergyIcon type={type} size={14} />}
            </span>
          </div>

          {/* Artwork-Fenster — grüne Landschaft + „Wer ist das Pokémon?"-Silhouette */}
          <div
            className="relative flex-[0_0_48%] min-h-0 overflow-hidden rounded-[2px]"
            style={{ border: '2px solid #b8901a', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3)' }}
          >
            <svg viewBox="0 0 120 84" preserveAspectRatio="xMidYMid slice" className="w-full h-full" aria-hidden="true">
              <defs>
                <linearGradient id="ph-sky" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#a6e0b0" />
                  <stop offset="0.55" stopColor="#63bd77" />
                  <stop offset="1" stopColor="#2f8f4c" />
                </linearGradient>
              </defs>
              <rect width="120" height="84" fill="url(#ph-sky)" />
              {/* Sonne */}
              <circle cx="98" cy="18" r="9" fill="#f7f3c8" opacity="0.75" />
              {/* Hügel-Landschaft */}
              <path d="M0 60 Q30 46 62 58 T120 54 V84 H0 Z" fill="#3f9d5a" opacity="0.9" />
              <path d="M0 70 Q38 58 78 69 T120 66 V84 H0 Z" fill="#2a7a41" />
              {/* Mystery-Pokémon-Silhouette mit Fragezeichen */}
              <g fill="#17351f" opacity="0.9">
                <ellipse cx="60" cy="46" rx="16" ry="15" />
                <path d="M49 34 Q47 24 53 27 Q54 31 57 33 Z" />
                <path d="M71 34 Q73 24 67 27 Q66 31 63 33 Z" />
              </g>
              <text x="60" y="52" textAnchor="middle" fontSize="20" fontWeight="bold" fill="#eaf6ec" fontFamily="sans-serif">?</text>
            </svg>
            {/* „Bild fehlt"-Hinweis */}
            <span className="absolute bottom-0 inset-x-0 text-center text-[8px] leading-tight font-semibold text-white py-[1.5%]" style={{ background: 'rgba(0,0,0,0.4)' }}>
              {pending ? 'nicht im Katalog' : 'Bild fehlt'}
            </span>
          </div>

          {/* Pokédex-Nr. direkt unter dem Bild */}
          {dexNumber != null && (
            <div className="text-[8px] leading-none text-[#6b6656] pt-[2.5%] pl-[1%]">Nr. {dexNumber}</div>
          )}

          {/* Textbox-Bereich (leer) füllt den Rest */}
          <div className="flex-1 min-h-0" />

          {/* Fuß unten links: Set-Kürzel + Nummer/PrintedTotal (wie echte Karte) */}
          <div className="flex items-center gap-1.5 text-[9px] leading-none text-[#6b6656]">
            {setCode && (
              <span className="font-bold px-1 py-0.5 rounded-[3px]" style={{ background: 'rgba(0,0,0,0.10)' }}>{setCode}</span>
            )}
            {numberLabel && <span className="font-medium">{numberLabel}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
