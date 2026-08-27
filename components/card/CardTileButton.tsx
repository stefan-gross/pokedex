'use client';

import { cn } from '@/lib/utils';

interface CardTileButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Hebt die Kachel hervor (Auswahl bzw. Kandidat) → Akzent-Rahmen/-Ring. */
  selected?: boolean;
  /** Akzentfarbe für Rahmen/Ring im ausgewählten Zustand (Hex oder CSS-Var). */
  accent?: string;
  /**
   * Auswahl-Stil:
   *  - `bordered` (Default): Akzent-Rahmen + dezente Fläche — für dunkle
   *    Slider-Kacheln (Korrektur-Panel, Scanner-Kandidaten).
   *  - `ring`: Fokus-Ring + Hover-Fläche (`bg-secondary`) — für helle
   *    Listen-Grids (Melden-Picker).
   */
  tone?: 'bordered' | 'ring';
  /** Rahmenbreite im `bordered`-Stil (px). Default 1.5. */
  borderWidth?: number;
}

/**
 * Klickbare Karten-Kachel — der wiederverwendbare, konsistente Button-Rahmen
 * hinter allen selektierbaren Karten-Kacheln (Korrektur-Panel, Scanner-
 * Kandidaten-Grid, Melden-Picker). Kapselt Tap-/Fokus-/Auswahl-Verhalten;
 * der Inhalt (Bild + Meta) kommt als `children`.
 */
export function CardTileButton({
  selected = false,
  accent = '#f4c542',
  tone = 'bordered',
  borderWidth = 1.5,
  className,
  style,
  children,
  ...props
}: CardTileButtonProps) {
  const isRing = tone === 'ring';
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'shrink-0 text-left transition-transform active:scale-[0.98]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50',
        isRing
          ? ['rounded-lg p-1.5 transition-colors', selected ? 'bg-secondary' : 'hover:bg-secondary']
          : 'rounded-2xl p-2',
        className,
      )}
      style={{
        ...(isRing
          ? { boxShadow: selected ? `0 0 0 2px ${accent}` : undefined }
          : {
              border: `${borderWidth}px solid ${selected ? accent : 'rgba(255,255,255,0.15)'}`,
              background: 'rgba(255,255,255,0.04)',
            }),
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}
