'use client';

interface ButtonGroupOption<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: number;
  /** Deaktiviert die Option (z.B. count === 0 im aktuellen Filter-Kontext). */
  disabled?: boolean;
  /** Für `iconOnly`-Optionen ohne sichtbaren Text — Screenreader-Label. */
  ariaLabel?: string;
}

interface ButtonGroupProps<T extends string> {
  options: ButtonGroupOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Füllfarbe der aktiven Option (Textsegmente) — Default App-Rot. Für
   *  `iconOnly` ungenutzt, dort ist die aktive Option immer ein weißer Chip. */
  accentColor?: string;
  /** Icon-only-Variante (z.B. Theme-Switcher): runde Buttons statt
   *  Textsegmente, aktive Option = weißer Chip auf grauem Track statt
   *  Farbfüllung — ersetzt die bisher eigenständig gebaute Toggle-Variante. */
  iconOnly?: boolean;
}

export function ButtonGroup<T extends string>({
  options,
  value,
  onChange,
  className = '',
  accentColor = 'var(--pokedex-red)',
  iconOnly = false,
}: ButtonGroupProps<T>) {
  return (
    <div
      className={
        iconOnly
          ? `flex rounded-full p-0.5 bg-[rgba(30,40,80,0.08)] dark:bg-white/[.18] ${className}`
          : `glass-inner flex rounded-lg overflow-hidden ${className}`
      }
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
            aria-label={opt.ariaLabel}
            className={
              iconOnly
                ? `w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${active ? '' : 'text-glass-muted'}`
                : `flex-1 px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap flex items-center justify-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed ${active ? '' : 'text-glass-muted'}${
                    i > 0 ? ' border-l border-[rgba(46,46,50,0.08)] dark:border-white/10' : ''
                  }`
            }
            style={
              active
                ? iconOnly
                  ? { background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }
                  : { background: accentColor, color: '#fff' }
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
