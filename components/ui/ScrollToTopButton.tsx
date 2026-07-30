'use client';

import { useEffect, useState } from 'react';
import { ChevronUp } from 'lucide-react';

/**
 * Sprung-nach-oben-FAB: fixiert unten rechts, oberhalb der (fixed) BottomNav
 * (die bei `bottom:12` mit `height:64` sitzt). Erscheint erst, wenn weit genug
 * gescrollt wurde, und scrollt bei Klick sanft an den Seitenanfang.
 *
 * Scrollt das window/`<body>` (kein eigener Container in der App — siehe
 * `globals.css` `overflow-x: clip`), daher `window.scrollY`/`window.scrollTo`.
 */
export function ScrollToTopButton({ threshold = 400 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return (
    <button
      type="button"
      aria-label="Nach oben"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={`glass fixed right-3 z-40 flex items-center justify-center w-11 h-11 rounded-full text-glass shadow-[0_6px_20px_rgba(0,0,0,0.28)] transition-all duration-200 ${
        visible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'
      }`}
      style={{ bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))' }}
    >
      <ChevronUp size={22} strokeWidth={2.2} />
    </button>
  );
}
