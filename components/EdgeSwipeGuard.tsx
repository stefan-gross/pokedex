'use client';

import { useEffect } from 'react';

/** Breite des Randbands (px), in dem eine horizontale Wischgeste die native
 *  iOS-Zurück-Navigation auslöst. iOS reagiert ab ~20 px — knapp darüber, um
 *  legitime Interaktionen weiter innen nicht zu beeinträchtigen. */
const EDGE = 22;

/**
 * Unterdrückt die native Zurück-Wischgeste (iOS-PWA/Browser: vom linken
 * Bildschirmrand nach innen wischen → History-Back). Ein Touch, der INNERHALB
 * des linken Randbands beginnt UND sich überwiegend HORIZONTAL bewegt, wird per
 * `preventDefault` gestoppt. Vertikales Scrollen (auch am Rand startend) bleibt
 * unberührt, damit Listen normal scrollbar sind.
 *
 * Rein clientseitig, ohne UI — global im `(app)`-Layout eingehängt.
 */
export function EdgeSwipeGuard() {
  useEffect(() => {
    let active = false;
    let startX = 0;
    let startY = 0;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) { active = false; return; }
      active = t.clientX <= EDGE;
      startX = t.clientX;
      startY = t.clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      // Nur die horizontale Rand-Geste blocken (Zurück), vertikales Scrollen
      // durchlassen. `cancelable` schützt vor bereits laufendem Scroll.
      if (Math.abs(dx) > Math.abs(dy) && e.cancelable) e.preventDefault();
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
