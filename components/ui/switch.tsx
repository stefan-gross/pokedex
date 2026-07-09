'use client';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  /** Füllfarbe im aktiven Zustand — Default App-Rot. */
  accentColor?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * iOS-artiger An/Aus-Switch — extrahiert aus dem bisher einzigen, in
 * `app/(app)/collection/page.tsx` (Evolutionslinie) handgebauten Toggle,
 * jetzt als wiederverwendbare Komponente statt Kopiervorlage.
 */
export function Switch({ checked, onChange, label, accentColor = 'var(--pokedex-red)', disabled, className = '' }: SwitchProps) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`flex items-center gap-1.5 text-xs shrink-0 disabled:opacity-40 ${className}`}
    >
      <span
        className="w-8 h-[18px] rounded-full flex items-center shrink-0 transition-colors px-0.5"
        style={{ background: checked ? accentColor : 'rgba(120,120,130,.3)' }}
      >
        <span
          className="w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform"
          style={{ transform: checked ? 'translateX(14px)' : 'translateX(0)' }}
        />
      </span>
      {label && <span className={checked ? '' : 'text-glass-muted'}>{label}</span>}
    </button>
  );
}
