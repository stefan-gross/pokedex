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
  const frame = type ? ENERGY_META[type].bg : '#B8B29E';
  const frameDark = `color-mix(in srgb, ${frame} 68%, #000)`;

  return (
    <div className={className} style={style} onClick={onClick} role="img" aria-label={`${name} — Bild fehlt`}>
      {/* Farbiger Typ-Rahmen (dünn wie bei einer echten Karte) */}
      <div
        className="w-full h-full rounded-[5%] p-[4%] shadow-[inset_0_1px_2px_rgba(255,255,255,0.35),0_2px_6px_rgba(0,0,0,0.25)]"
        style={{ background: `linear-gradient(155deg, ${frame}, ${frameDark})` }}
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

          {/* Artwork-Fenster — obere Kartenhälfte, wie bei einer echten Karte */}
          <div
            className="flex-[0_0_48%] min-h-0 rounded-[2px] flex flex-col items-center justify-center gap-1.5"
            style={{
              background: 'linear-gradient(160deg, #e6e0cf, #d8d1bd)',
              border: `2px solid ${frameDark}`,
              boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.25)',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#8a8471" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[24%] h-[24%] max-w-8 max-h-8" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="m3 16 5-5c.9-.9 2.1-.9 3 0l4 4" />
              <path d="m14 14 1-1c.9-.9 2.1-.9 3 0l3 3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
            </svg>
            <span className="text-[10px] leading-none font-medium text-[#8a8471]">Bild fehlt</span>
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
