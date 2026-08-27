'use client';

import { useEffect, useState } from 'react';

/**
 * TEMPORÄRE Diagnose: zeigt die echten Safe-Area-/Viewport-Werte des Geräts +
 * markiert die Bottom-Safe-Area farbig (magenta). Zum Debuggen des „schwarzen
 * Rands" unten. Nach der Diagnose wieder entfernen.
 */
export function DebugSafeArea() {
  const [info, setInfo] = useState('…');

  useEffect(() => {
    const read = () => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);width:0';
      document.body.appendChild(probe);
      const safeBottom = Math.round(parseFloat(getComputedStyle(probe).height) || 0);
      probe.remove();
      const dvh = Math.round(window.visualViewport?.height ?? 0);
      setInfo(
        `safe-bottom: ${safeBottom}px · innerH: ${window.innerHeight} · visualVP: ${dvh} · screen: ${window.screen.height} · dpr: ${window.devicePixelRatio}`,
      );
    };
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  return (
    <>
      {/* Bottom-Safe-Area farbig markiert */}
      <div
        className="fixed inset-x-0 bottom-0 z-[999] pointer-events-none"
        style={{ height: 'env(safe-area-inset-bottom, 0px)', background: 'rgba(255,0,255,0.6)' }}
      />
      {/* Werte-Leiste knapp über der Safe-Area */}
      <div
        className="fixed inset-x-0 z-[999] pointer-events-none text-center"
        style={{
          bottom: 'env(safe-area-inset-bottom, 0px)',
          background: 'rgba(0,0,0,0.85)',
          color: '#0f0',
          fontSize: '11px',
          fontFamily: 'monospace',
          padding: '3px 6px',
        }}
      >
        {info}
      </div>
    </>
  );
}
