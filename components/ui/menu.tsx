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
 *  - **Glas**: `.glass-menu` (mattierte, transluzente Scheibe — bewusst
 *    blickdichter als `.glass`, da Menüs meist über hellem Glas liegen).
 *  - **Öffnet direkt unter dem Auslöser** (`top-full`) — der Auslöser bleibt
 *    sichtbar; das Menü quillt gooey aus seiner oberen Ecke nach unten.
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
      {trigger(open, toggle)}
      {open && (
        <div
          role="menu"
          className={`menu-goo-open absolute top-full mt-2 z-40 min-w-[190px] glass-menu rounded-2xl overflow-hidden shadow-xl ${
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
