'use client';

import { Plus, Minus } from 'lucide-react';

/**
 * Kompakter −/Anzahl/+ Stepper — app-weit einheitlich (Deck-Editor, Karten-
 * Such-/Picker-Sheets etc.), damit das Muster nicht in jeder Komponente roh
 * nachgebaut wird. Die runden Tap-Ziele sind bewusst 32px (dichte Listen); die
 * Buttons liegen INNERHALB dieser Komponente (das ist hier das Design-System-
 * Primitive), Aufrufer nutzen `<Stepper>` statt eigener `<button>`.
 */
export function Stepper({ value, onDec, onInc, min = 0, disabled = false, decLabel = 'weniger', incLabel = 'mehr', className = '' }: {
  value: number;
  onDec: () => void;
  onInc: () => void;
  /** Untergrenze — der „−“-Button wird bei value <= min deaktiviert. */
  min?: number;
  disabled?: boolean;
  decLabel?: string;
  incLabel?: string;
  className?: string;
}) {
  const btn = 'w-8 h-8 rounded-full flex items-center justify-center bg-black/10 dark:bg-white/15 active:scale-90 transition-transform disabled:opacity-40';
  return (
    <div className={`flex items-center gap-2 shrink-0 ${className}`}>
      <button type="button" onClick={onDec} disabled={disabled || value <= min} className={btn} aria-label={decLabel}>
        <Minus size={16} />
      </button>
      <span className="w-5 text-center font-bold tabular-nums">{value}</span>
      <button type="button" onClick={onInc} disabled={disabled} className={btn} aria-label={incLabel}>
        <Plus size={16} />
      </button>
    </div>
  );
}
