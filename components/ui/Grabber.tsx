'use client';

/**
 * Griff (Grabber) für kollabierbare Filter-Panels — der sichtbare Pill unten am
 * Panel, den man ziehen (kontinuierlich auf-/zuklappen) oder tippen (ganz
 * auf/zu) kann. Die Interaktions-Logik liefert `useGrabberCollapse`
 * (`grabberProps`); diese Komponente ist rein die Darstellung + das Weiterreichen
 * der Pointer-/Click-Handler. Optik 1:1 wie die bisherige Set-Detail-Grabber-Zeile.
 */
export function Grabber({
  expanded,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onClick,
  className = '',
  barClassName = 'bg-[rgba(46,46,50,0.2)] dark:bg-white/30',
  padClassName = 'pt-3 -mb-1',
}: {
  /** true = mindestens eine Region offen → Aktion „einklappen". */
  expanded: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClick: () => void;
  className?: string;
  /** Farbe des Griff-Pills überschreibbar — z.B. auf dem immer-dunklen
   *  Scanner-Overlay, wo der Light-Default unsichtbar wäre. */
  barClassName?: string;
  /** Innenabstand = Größe des Tap-/Zieh-Trefferbereichs (der sichtbare Pill
   *  bleibt gleich). Default `pt-3 -mb-1` (~18px). Für ein leichter greifbares
   *  Ziel z.B. `py-[13px] -my-1` (~32px). */
  padClassName?: string;
}) {
  return (
    <div
      role="button"
      aria-label={expanded ? 'Filter einklappen' : 'Filter ausklappen'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
      className={`flex justify-center cursor-grab active:cursor-grabbing touch-none select-none ${padClassName} ${className}`}
    >
      <div className={`w-10 h-1.5 rounded-full ${barClassName}`} />
    </div>
  );
}
