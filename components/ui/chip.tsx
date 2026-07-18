'use client';

/**
 * Filter-Pille — extrahiert aus dem dreifach kopierten Muster in
 * `app/(app)/collection/page.tsx` (Typ-/Evolutionsstufen-/Sonderformen-
 * Filter): inaktiv = `.glass-inner`, aktiv = getönter Hintergrund (Akzent
 * 15-20% Deckkraft) + Volltonfarbe für Text/Icon. Randlos (Session-Vorgabe) —
 * aktiv/inaktiv unterscheidet sich allein über Hintergrundtönung + Textfarbe,
 * kein Rahmen mehr.
 */
export function Chip({
  active,
  disabled,
  count,
  accentColor = 'var(--pokedex-red)',
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  count?: number;
  /** Akzentfarbe im aktiven Zustand — z.B. Energie-Typfarbe oder App-Rot. */
  accentColor?: string;
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      className={`flex items-center gap-1.5 text-role-label min-h-11 py-1 rounded-full whitespace-nowrap transition-all shrink-0 disabled:opacity-30 disabled:cursor-not-allowed ${icon ? 'pl-1 pr-2.5' : 'px-3'} ${active ? '' : 'glass-inner text-glass-muted'}`}
      style={{
        // Kein Rahmen (Session-Vorgabe) — `.glass-inner` bringt sonst einen
        // zurück, siehe button.tsx für dieselbe Begründung.
        border: 'none',
        // `color-mix()` statt Hex+Alpha-Suffix-Trick (`${accentColor}22`) —
        // funktioniert auch mit CSS-Variablen wie `var(--pokedex-red)` als
        // `accentColor`, nicht nur mit echten Hex-Strings.
        background: active ? `color-mix(in srgb, ${accentColor} 15%, transparent)` : undefined,
        color: active ? accentColor : undefined,
        fontWeight: active ? 600 : 400,
      }}
    >
      {icon}
      {label}
      {count != null && count > 0 && (
        <span className="text-[10px] opacity-50 font-normal">{count}</span>
      )}
    </button>
  );
}
