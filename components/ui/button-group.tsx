'use client';

interface ButtonGroupOption<T extends string> {
  value: T;
  label: string;
  count?: number;
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
      className={`flex rounded-lg overflow-hidden border border-border bg-secondary ${className}`}
      role="group"
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap flex items-center justify-center gap-1${
              i > 0 ? ' border-l border-border' : ''
            }`}
            style={
              active
                ? { background: 'var(--pokedex-red)', color: '#fff' }
                : { color: 'var(--muted-foreground)' }
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
