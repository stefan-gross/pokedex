'use client';

import { cn } from '@/lib/utils';

/**
 * Ein rundes Badge/Button auf einer Kartenkachel (`Card`/`CardTile`) — Set-
 * Symbol, Anzahl-Badge, Prüfen-Hinweis oder Wunschlisten-Herz nutzen jetzt
 * alle dieselbe Grundform statt vier leicht unterschiedlicher Ad-hoc-Formen
 * (Kreis/abgerundetes Rechteck). Immer `rounded-full`, unabhängig vom Inhalt
 * (Icon, Zahl, Buchstabe) — auf Nutzerwunsch: "Badges sind immer rund".
 */
export interface CardBadgeProps {
  /** Inhalt — Icon (`<Icon/>`), Text ("×2", "A") oder ein `<img>` (Set-Logo). */
  children: React.ReactNode;
  /** Durchmesser in px. */
  size?: number;
  /** Hintergrundfarbe — ignoriert, wenn `background={false}`. */
  color?: string;
  /** `false` = kein Kreis-Hintergrund, nur der Inhalt selbst sichtbar (z.B.
   *  das Wunschlisten-Herz, das rein als Icon+Schatten ohne Kreisfläche
   *  gezeichnet wird). */
  background?: boolean;
  textColor?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
  ariaLabel?: string;
  title?: string;
  /** 'circle' (Default) = Breite fest gleich `size`, für Icons/kurze Zahlen
   *  wie "×2". 'pill' = Höhe bleibt `size`, Breite wird automatisch (mit
   *  horizontalem Innenabstand) — für längere Textinhalte wie einen Preis
   *  ("4,59 €"), die in einem echten Kreis nicht lesbar wären. */
  shape?: 'circle' | 'pill';
  /** Kartenecke, in der das Badge sitzt. Gesetzt → eckiges Badge mit zwei
   *  diagonal abgerundeten Ecken (die genannte Ecke + ihre Gegenecke), die
   *  beiden anderen fast eckig. `tl`/`br` runden die TL–BR-Diagonale,
   *  `tr`/`bl` die TR–BL-Diagonale. Ohne `corner` bleibt das Badge rund
   *  (`rounded-full`, Rückwärtskompatibilität). */
  corner?: 'tl' | 'tr' | 'bl' | 'br';
  /** Radius (px) der beiden abgerundeten Diagonal-Ecken — an den Karten-Ecken-
   *  Radius angeglichen (siehe `Card`), damit Badge und Karte gleich stark
   *  gerundet wirken. Nur relevant zusammen mit `corner`. */
  cornerRadius?: number;
}

/** Border-Radius für ein eckiges Badge mit diagonal abgerundeten Ecken.
 *  Die Ecke, in der das Badge sitzt, UND ihre Gegenecke werden mit `round`
 *  gerundet (= Karten-Radius); die beiden anderen bleiben nahezu eckig. */
function cornerRadiusStyle(corner: NonNullable<CardBadgeProps['corner']>, round: number): React.CSSProperties {
  const R = round;             // abgerundete Diagonal-Ecken = Karten-Radius
  const S = 2;                 // „eckige" Ecken (minimal entschärft)
  const roundTLBR = corner === 'tl' || corner === 'br';
  return {
    borderTopLeftRadius: roundTLBR ? R : S,
    borderBottomRightRadius: roundTLBR ? R : S,
    borderTopRightRadius: roundTLBR ? S : R,
    borderBottomLeftRadius: roundTLBR ? S : R,
  };
}

export function CardBadge({
  children, size = 22, color = 'rgba(0,0,0,.55)', background = true, textColor = '#fff',
  className, style, onClick, ariaLabel, title, shape = 'circle', corner, cornerRadius = 6,
}: CardBadgeProps) {
  const Tag = onClick ? 'button' : 'div';
  const isPill = shape === 'pill';
  return (
    <Tag
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      className={cn('absolute flex items-center justify-center font-bold leading-none', corner ? '' : 'rounded-full', className)}
      style={{
        width: isPill ? 'auto' : size,
        height: size,
        ...(isPill ? { paddingInline: size * 0.28, whiteSpace: 'nowrap' } : undefined),
        ...(corner ? cornerRadiusStyle(corner, cornerRadius) : undefined),
        background: background ? color : 'transparent',
        color: textColor,
        fontSize: size * (isPill ? 0.38 : 0.45),
        // Ohne Kreis-Hintergrund (z.B. Wunschlisten-Herz) sorgt ein
        // `drop-shadow`-Filter statt `box-shadow` für Kontrast auf hellen
        // Kartenmotiven — `box-shadow` bräuchte eine gefüllte Box, die es
        // hier per Definition nicht gibt.
        boxShadow: background ? '0 1px 3px rgba(0,0,0,.4)' : undefined,
        filter: background ? undefined : 'drop-shadow(0 1px 3px rgba(0,0,0,0.6))',
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
