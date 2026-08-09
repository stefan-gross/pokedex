'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

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
 *  - **Glas**: dieselbe `.glass`-Klasse wie die App-Panels (identische
 *    Deckkraft/Blur/Hintergrund) — gut lesbar über dem bunten App-Hintergrund.
 *  - **Öffnet ÜBER dem Auslöser** (`top-0`, z-Ebene): der Auslöser verschwindet,
 *    während das Menü offen ist, und ploppt beim Schließen gooey zurück
 *    (`menu-trigger-pop`). Der Auslöser behält im Layout seinen Platz
 *    (unsichtbar statt entfernt), damit nichts springt.
 *  - **Klick irgendwohin außerhalb** (Button + Menü) schließt es
 *    (document-`pointerdown`).
 *
 * Auslöser als Render-Prop, damit jeder Button/Icon genutzt werden kann:
 *   <Menu
 *     trigger={(open, toggle) => <Button icon={<MoreHorizontal/>} onClick={toggle} />}
 *     items={[{ label: 'Bearbeiten', onClick: … }, …]}
 *   />
 */
export function Menu({
  trigger, items, align = 'right', className = '',
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  items: MenuItem[];
  /** An welcher Ecke des Auslösers das Menü ausgerichtet wird. Default rechts. */
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Zählt jede Schließung hoch → `key` am Auslöser-Wrapper wechselt → die
  // Wiedererscheinen-Animation (`menu-trigger-pop`) startet neu. `> 0` schließt
  // den ersten Mount aus (da soll der Button NICHT einploppen).
  const [closeCount, setCloseCount] = useState(0);
  const prevOpen = useRef(false);
  // Auf JEDEM Schließpfad (Toggle, Eintrag-Klick, Klick-außerhalb) genau einmal
  // hochzählen — deckt alle Wege ab, ohne dass jeder Aufrufer daran denken muss.
  useEffect(() => {
    if (prevOpen.current && !open) setCloseCount(c => c + 1);
    prevOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const toggle = () => setOpen(o => !o);

  return (
    <div ref={ref} className={`relative shrink-0 ${className}`}>
      {/* Auslöser behält seinen Platz (unsichtbar statt entfernt → kein
          Layout-Sprung); ploppt beim Schließen per key-Remount gooey zurück. */}
      <span
        key={closeCount}
        className={open ? 'opacity-0 pointer-events-none' : (closeCount > 0 ? 'menu-trigger-pop inline-flex' : 'inline-flex')}
      >
        {trigger(open, toggle)}
      </span>
      {open && (
        <div
          role="menu"
          className={`menu-goo-open absolute top-0 z-40 min-w-[190px] glass rounded-2xl overflow-hidden shadow-xl ${
            align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'
          }`}
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
      )}
    </div>
  );
}
