'use client';

import { Check } from 'lucide-react';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  /** Füllfarbe im aktiven Zustand — Default App-Rot. */
  accentColor?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Checkbox in Glass-Optik — gab es bisher app-weit nicht (kein einziges
 * `<input type="checkbox">` im Code). Inaktiv: `.glass-inner`-Kachel,
 * aktiv: gefüllt mit Häkchen, analog zum `Switch`-Farbverhalten.
 */
export function Checkbox({ checked, onChange, label, accentColor = 'var(--pokedex-red)', disabled, className = '' }: CheckboxProps) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      className={`flex items-center gap-2 text-sm shrink-0 disabled:opacity-40 ${className}`}
    >
      <span
        className={`w-[18px] h-[18px] rounded-[5px] flex items-center justify-center shrink-0 transition-colors ${checked ? '' : 'glass-inner'}`}
        style={checked ? { background: accentColor } : undefined}
      >
        {checked && <Check size={12} strokeWidth={3} color="#fff" />}
      </span>
      {label && <span className={checked ? '' : 'text-glass-muted'}>{label}</span>}
    </button>
  );
}
