'use client';

import { useGlassTheme } from '@/lib/ui/glass-theme';
import { progressTrackStyle } from '@/lib/ui/tinted-glass';

/**
 * Linearer Fortschrittsbalken — extrahiert aus dem Vorlagen-Binder-Header
 * (`app/(app)/binders/[id]/page.tsx`, `templateProgress`-Block). Circular
 * wird app-weit nirgends gebraucht, daher bewusst nicht gebaut.
 */
export function Progress({
  value,
  max,
  accentColor,
  doneColor = '#48bb78',
  trackStyle,
}: {
  value: number;
  max: number;
  accentColor: string;
  /** Füllfarbe bei 100% — Default Grün, überschreibbar. */
  doneColor?: string;
  /** Nur für `/design-system-preview` gedacht — überschreibt den Track-Look
   *  zum Live-Abstimmen. Echte Aufrufer lassen das weg und bekommen den
   *  aktuell GESPEICHERTEN Stand (`getGlassTheme().progressTrack`). */
  trackStyle?: React.CSSProperties;
}) {
  // Abonniert das geteilte Theme nur, damit diese Komponente neu rendert,
  // wenn `progressTrackStyle()` frische Werte liefern soll (analog zu
  // `useGlassTheme()` in `components/ui/button.tsx`).
  useGlassTheme();
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div
      // Höher auf Mobile (h-3 = 12px, ohne Präfix = Mobile-first-Basis),
      // ab `sm:` wieder auf den bisherigen 8px — auf kleinen Touch-Screens
      // besser lesbar/greifbar.
      className="h-3 sm:h-2 rounded-full overflow-hidden"
      style={{ border: 'none', ...progressTrackStyle(), ...trackStyle }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${pct}%`,
          background: value >= max ? doneColor : accentColor,
        }}
      />
    </div>
  );
}
