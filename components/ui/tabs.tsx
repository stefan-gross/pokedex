'use client';

import { useLayoutEffect, useRef, useState } from 'react';

interface TabOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Für rein-Icon-Tabs ohne sichtbaren Text — Screenreader-Label. */
  ariaLabel?: string;
}

/**
 * Underline-Tabs — klassische Tab-Leiste mit gleitendem Unterstrich unter dem
 * aktiven Tab, linksbündig und bei vielen Tabs horizontal scrollbar. Bewusst
 * eine EIGENE Komponente neben `ButtonGroup` (die als Segmented-Control/Pille
 * die Toggle-/Filter-Rolle abdeckt) — `Tabs` ist für Inhalts-/Sektions-
 * Navigation (z.B. der Icon-Switch im „Neue Sammlung"-Drawer).
 *
 * Der Indikator wird per `offsetLeft`/`offsetWidth` des aktiven Buttons
 * positioniert (relativ zur scrollenden Leiste, daher scroll-sicher — kein
 * `getBoundingClientRect`), gemessen vor dem Paint (`useLayoutEffect`), damit
 * er nicht flackert.
 */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  className = '',
  accentColor = '#e53e3e',
}: {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Farbe des Unterstrichs (Default App-Rot). */
  accentColor?: string;
}) {
  const btnRefs = useRef(new Map<string, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const btn = btnRefs.current.get(String(value));
    if (!btn) { setIndicator(null); return; }
    setIndicator({ left: btn.offsetLeft, width: btn.offsetWidth });
    // `options.length` als Dep: eine geänderte Optionsliste verschiebt die
    // Positionen, auch ohne dass sich `value` ändert.
  }, [value, options.length]);

  return (
    <div className={`overflow-x-auto ${className}`} role="tablist">
      <div className="relative flex gap-1 w-max min-w-full border-b border-[color-mix(in_srgb,var(--border)_60%,transparent)]">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                if (el) btnRefs.current.set(String(o.value), el);
                else btnRefs.current.delete(String(o.value));
              }}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={o.ariaLabel}
              onClick={() => onChange(o.value)}
              className={`relative z-10 whitespace-nowrap px-3 min-h-11 inline-flex items-center justify-center gap-1.5 text-sm transition-colors ${
                active ? 'text-glass font-semibold' : 'text-glass-muted font-medium hover:text-glass'
              }`}
            >
              {o.label}
            </button>
          );
        })}
        {indicator && (
          <span
            aria-hidden
            className="absolute bottom-0 h-[2px] rounded-full transition-all duration-300"
            style={{ left: indicator.left, width: indicator.width, background: accentColor }}
          />
        )}
      </div>
    </div>
  );
}
