'use client';

import { useEffect } from 'react';

/** Breite des Randbands (px) an linker UND rechter Kante, in dem die native
 *  iOS-Zurück-/Vorwärts-Wischgeste ausgelöst wird. iOS reagiert ab ~20 px. */
const EDGE = 24;

/**
 * Unterdrückt die nativen Zurück-/Vorwärts-Wischgesten (iOS-PWA/Browser: vom
 * linken bzw. rechten Bildschirmrand nach innen wischen → History back/forward).
 *
 * Robust: Beginnt ein Touch INNERHALB eines Randbands, wird JEDER folgende
 * `touchmove` sofort per `preventDefault` gestoppt — ohne vorher auf eine
 * erkannte Horizontal-Richtung zu warten. Genau dieses Warten war das Leck:
 * iOS committet die Rand-Geste oft schon beim ersten winzigen Move, bevor
 * „horizontal" feststeht. Der Preis ist ein sehr schmales (24 px) Randband, in
 * dem auch vertikales Scrollen unterbunden ist — dort startet man selten.
 *
 * Rein clientseitig, ohne UI — global im `(app)`-Layout eingehängt.
 */
export function EdgeSwipeGuard() {
  useEffect(() => {
    let active = false;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) { active = false; return; }
      const x = t.clientX;
      active = x <= EDGE || x >= window.innerWidth - EDGE;
    };

    const onMove = (e: TouchEvent) => {
      if (active && e.cancelable) e.preventDefault();
    };

    const onEnd = () => { active = false; };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return null;
}
