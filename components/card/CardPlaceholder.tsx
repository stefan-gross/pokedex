'use client';

import { ENERGY_META, EnergyIcon, type EnergyType } from '@/components/ui/EnergyIcon';

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
  const { name, hp, number, total, dexNumber, setCode, types } = info;
  const numberLabel = number ? `${number}${total ? `/${total}` : ''}` : null;

  const t0 = types?.[0];
  const type = (t0 && t0 in ENERGY_META ? t0 : null) as EnergyType | null;

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
              Bild fehlt
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
