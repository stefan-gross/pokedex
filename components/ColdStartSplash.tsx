'use client';

import { useEffect, useState } from 'react';
import { SplashScreen } from '@/components/SplashScreen';

/**
 * Zeigt beim Cold-Start der App (erster Mount des (app)-Layouts, also einmal
 * pro echtem Seiten-Load — NICHT bei SPA-Navigation) kurz den Pokémon-Splash
 * und blendet ihn dann aus. Rein visuell; blockiert nichts. Nach dem Ausblenden
 * wird die Komponente entfernt, damit kein unsichtbares Overlay liegen bleibt.
 */
export function ColdStartSplash() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    // Mindestanzeige, dann Ausblenden; nach der 450ms-Fade unmounten.
    const hide = setTimeout(() => setVisible(false), 1000);
    const unmount = setTimeout(() => setMounted(false), 1500);
    return () => { clearTimeout(hide); clearTimeout(unmount); };
  }, []);

  if (!mounted) return null;
  return <SplashScreen visible={visible} />;
}
