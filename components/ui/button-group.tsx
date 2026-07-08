'use client';

interface ButtonGroupOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  /** Deaktiviert die Option (z.B. count === 0 im aktuellen Filter-Kontext). */
  disabled?: boolean;
}

interface ButtonGroupProps<T extends string> {
  options: ButtonGroupOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function ButtonGroup<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: ButtonGroupProps<T>) {
  return (
    <div
      className={`glass-inner flex rounded-lg overflow-hidden ${className}`}
      role="group"
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        // Nie die gerade aktive Option deaktivieren — sonst wirkt sie ohne
        // erkennbaren Grund "eingefroren", obwohl sie ja bereits gewählt ist.
        const isDisabled = !!opt.disabled && !active;
        return (
          <button
            key={opt.value}
            onClick={() => !isDisabled && onChange(opt.value)}
            disabled={isDisabled}
            className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap flex items-center justify-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed ${active ? '' : 'text-glass-muted'}${
              i > 0 ? ' border-l border-[rgba(46,46,50,0.08)] dark:border-white/10' : ''
            }`}
            style={
              active
                ? { background: 'var(--pokedex-red)', color: '#fff' }
                : undefined
            }
          >
            {opt.label}
            {opt.count !== undefined && (
              <span className={`text-[10px] font-normal tabular-nums ${active ? 'opacity-80' : 'opacity-50'}`}>
                {opt.count.toLocaleString('de')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
