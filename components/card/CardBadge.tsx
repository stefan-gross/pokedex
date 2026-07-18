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
}

export function CardBadge({
  children, size = 22, color = 'rgba(0,0,0,.55)', background = true, textColor = '#fff',
  className, style, onClick, ariaLabel, title,
}: CardBadgeProps) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      className={cn('absolute rounded-full flex items-center justify-center font-bold leading-none', className)}
      style={{
        width: size,
        height: size,
        background: background ? color : 'transparent',
        color: textColor,
        fontSize: size * 0.45,
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
