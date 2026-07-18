'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Zentraler Select-Wrapper — extrahiert aus dem bisher mehrfach kopierten
 * Muster (`CardSortBar.tsx`, `collection/page.tsx`, `scanner/page.tsx`,
 * Blatt-Auswahl in `binders/[id]/page.tsx`, u.a.): `relative` Wrapper +
 * natives `<select appearance-none>` + absolut positionierter Chevron.
 * Kein neues Aussehen, nur eine Stelle statt neun.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  height = 'md',
  'aria-label': ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  /** 'md' = h-11 (Standard, touch-target-konform), 'sm' = h-9 (kompakte Kontexte wie Blatt-Auswahl). */
  height?: 'sm' | 'md';
  'aria-label'?: string;
}) {
  return (
    <label className="relative inline-flex items-center shrink-0">
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        aria-label={ariaLabel}
        // Kein Rahmen (Session-Vorgabe) — als Inline-Style, da `.glass-inner`
        // sonst einen zurückbringt (siehe button.tsx für die Begründung).
        // Rundung immer `rounded-full` — dieselbe Kapsel-Form wie ButtonGroup.
        style={{ border: 'none' }}
        className={cn(
          'appearance-none pl-2.5 pr-6 font-bold tabular-nums glass-inner text-glass focus:outline-none rounded-full',
          height === 'sm' ? 'h-9 text-[12px]' : 'h-11 text-xs',
          className,
        )}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={11} className="absolute right-1.5 pointer-events-none text-glass-muted" />
    </label>
  );
}
