'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Rot dargestellt (z.B. „Löschen"). */
  destructive?: boolean;
}

/**
 * Aufklappendes Aktionen-Menü (Dropdown) im App-Glas-Stil.
 *
 *  - **Gooey-Öffnen**: quillt per `menu-goo-open` (globals.css) organisch aus
 *    der Verankerungsecke — kein SVG-Blur, damit der Text scharf bleibt.
 *  - **Glas**: dieselbe `.glass`-Klasse wie die App-Panels.
 *  - **Öffnet ÜBER dem Auslöser**: der Auslöser verschwindet, während das Menü
 *    offen ist, und ploppt beim Schließen gooey zurück (`menu-trigger-pop`).
 *  - **Klick irgendwohin außerhalb** (Button + Menü) schließt es.
 *
 *  `portal`: Rendert das Menü an `document.body` (fixe Positionierung an der
 *  Auslöser-Ecke) statt als absolutes Kind. Nötig, damit `backdrop-filter`
 *  (Glas-Blur) wirkt — verschachteltes `backdrop-filter` (Menü IN einem
 *  Glas-Panel) ist ein No-op, das Blur bliebe sonst wirkungslos. Außerhalb
 *  jedes Glas-Vorfahren greift der Blur wieder.
 */
export function Menu({
  trigger, items, align = 'right', className = '', portal = false,
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  items: MenuItem[];
  /** An welcher Ecke des Auslösers das Menü ausgerichtet wird. Default rechts. */
  align?: 'left' | 'right';
  className?: string;
  /** An `document.body` rendern (fix positioniert) — für echten Glas-Blur. */
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Fixe Bildschirm-Koordinaten der Auslöser-Ecke (nur im Portal-Modus).
  const [coords, setCoords] = useState<{ top: number; left?: number; right?: number } | null>(null);
  // Zählt jede Schließung hoch → `key` am Auslöser-Wrapper wechselt → die
  // Wiedererscheinen-Animation (`menu-trigger-pop`) startet neu. `> 0` schließt
  // den ersten Mount aus (da soll der Button NICHT einploppen).
  const [closeCount, setCloseCount] = useState(0);
  const prevOpen = useRef(false);
  useEffect(() => {
    if (prevOpen.current && !open) setCloseCount(c => c + 1);
    prevOpen.current = open;
  }, [open]);

  // Klick außerhalb (Auslöser-Wrapper UND portaltes Menü) schließt.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Portal: Auslöser-Ecke messen (top-links/-rechts) und bei Scroll/Resize
  // aktualisieren, damit das fix positionierte Menü an Ort und Stelle bleibt.
  useLayoutEffect(() => {
    if (!portal || !open || !wrapRef.current) { setCoords(null); return; }
    const update = () => {
      const r = wrapRef.current!.getBoundingClientRect();
      setCoords(align === 'right'
        ? { top: r.top, right: window.innerWidth - r.right }
        : { top: r.top, left: r.left });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [portal, open, align]);

  const toggle = () => setOpen(o => !o);

  const menuEl = (
    <div
      ref={menuRef}
      role="menu"
      className={`menu-goo-open z-50 w-max max-w-[80vw] glass rounded-2xl overflow-hidden shadow-xl ${
        align === 'right' ? 'origin-top-right' : 'origin-top-left'
      } ${portal ? 'fixed' : `absolute top-0 ${align === 'right' ? 'right-0' : 'left-0'}`}`}
      style={portal && coords ? { top: coords.top, left: coords.left, right: coords.right } : undefined}
    >
      {items.map((it, i) => (
        <button
          key={i}
          role="menuitem"
          type="button"
          onClick={() => { setOpen(false); it.onClick(); }}
          disabled={it.disabled}
          className={`w-full px-4 py-3 text-sm text-left hover:bg-white/10 disabled:opacity-50 ${
            it.destructive ? 'text-destructive' : 'text-glass'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={wrapRef} className={`relative shrink-0 ${className}`}>
      {/* Auslöser behält seinen Platz (unsichtbar statt entfernt → kein
          Layout-Sprung); ploppt beim Schließen per key-Remount gooey zurück. */}
      <span
        key={closeCount}
        className={open ? 'opacity-0 pointer-events-none' : (closeCount > 0 ? 'menu-trigger-pop inline-flex' : 'inline-flex')}
      >
        {trigger(open, toggle)}
      </span>
      {open && (
        portal
          ? (coords && typeof document !== 'undefined' ? createPortal(menuEl, document.body) : null)
          : menuEl
      )}
    </div>
  );
}
