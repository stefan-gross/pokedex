'use client';

import { useEffect } from 'react';
import { hydrateGlassTheme } from '@/lib/ui/glass-theme';
import { hydrateCardVisualTheme } from '@/lib/ui/card-theme';

/** Liest evtl. gespeicherte Theme-Overrides aus diesem Browser (Glas: `lib/
 *  ui/glass-theme.ts`, Karte: `lib/ui/card-theme.ts`) einmal beim App-Start.
 *  Rendert nichts. */
export function GlassThemeHydrator() {
  useEffect(() => {
    hydrateGlassTheme();
    hydrateCardVisualTheme();
  }, []);
  return null;
}
