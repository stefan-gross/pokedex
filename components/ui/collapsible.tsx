'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Einklappbares Glas-Panel mit Kopfzeile (Titel + optional rechte Info) und
 * Chevron. App-weit wiederverwendbar (bisher rollte jede Stelle das selbst) —
 * z.B. die Kategorie-Sektionen im Deck-Editor. Der Inhalt liegt FLACH im Panel
 * (keine verschachtelten Glas-Panels).
 */
export function Collapsible({ title, right, defaultOpen = true, children, className = '', bodyClassName = 'px-4 pb-3' }: {
  title: ReactNode;
  /** Rechts neben dem Chevron (z.B. eine Anzahl). */
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`glass rounded-2xl overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="font-semibold text-sm min-w-0 truncate">{title}</span>
        <span className="flex items-center gap-2 shrink-0">
          {right}
          <ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className={bodyClassName}>{children}</div>}
    </div>
  );
}
