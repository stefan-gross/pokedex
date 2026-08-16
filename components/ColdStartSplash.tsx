'use client';

import { useEffect, useState } from 'react';
import { SplashScreen } from '@/components/SplashScreen';

const SESSION_KEY = 'pokedex-splash-shown';

/**
 * Zeigt beim echten Cold-Start der App den Pokémon-Splash **einmal pro
 * Browser-Session** und blendet ihn dann aus. Der `sessionStorage`-Marker
 * verhindert, dass ein erneuter Mount des (app)-Layouts (z.B. durch
 * `router.refresh()` nach einer Aktion, oder eine Hard-Navigation) den Splash
 * nochmal auslöst — das war der Grund, warum er „aus dem Nichts" wieder
 * auftauchte. Rein visuell; blockiert nichts.
 */
export function ColdStartSplash() {
  const [show, setShow] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;   // in dieser Session schon gezeigt
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch { /* sessionStorage nicht verfügbar → einmal zeigen ist ok */ }
    setShow(true);
    const hide = setTimeout(() => setVisible(false), 1000);
    const unmount = setTimeout(() => setShow(false), 1500);
    return () => { clearTimeout(hide); clearTimeout(unmount); };
  }, []);

  if (!show) return null;
  return <SplashScreen visible={visible} />;
}
