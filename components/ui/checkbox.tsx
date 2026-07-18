'use client';

import { Check } from 'lucide-react';
import { tintedGlassStyle } from '@/lib/ui/tinted-glass';
import { readableTextColor } from '@/lib/color-utils';
import { useGlassTheme } from '@/lib/ui/glass-theme';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  /** Füllfarbe im aktiven Zustand — Default App-Rot. */
  accentColor?: string;
  disabled?: boolean;
  className?: string;
  /** Nur für die Design-System-Testseite: überschreibt testweise den Stil
   *  des aktiven Kästchens (Entwurf), ohne das gespeicherte Theme zu ändern. */
  activeStyle?: React.CSSProperties;
}

/**
 * Checkbox in Glass-Optik — gab es bisher app-weit nicht (kein einziges
 * `<input type="checkbox">` im Code). Inaktiv: `.glass-inner`-Kachel,
 * aktiv: getöntes Glas mit Häkchen, analog zum `Switch`-Verhalten. Randlos,
 * `rounded-full` (Session-Vorgabe: einheitliche Kapsel-/Kreis-Rundung für
 * alle Elemente außer Panels/Dialoge/Sheets) — vormals `rounded-[5px]`.
 */
export function Checkbox({ checked, onChange, label, accentColor = '#e53e3e', disabled, className = '', activeStyle }: CheckboxProps) {
  const [theme] = useGlassTheme();
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      className={`flex items-center gap-2 text-sm shrink-0 min-h-11 disabled:opacity-40 ${className}`}
    >
      <span
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${checked ? '' : 'glass-inner'}`}
        // Kein Rahmen (Session-Vorgabe) — `.glass-inner` bringt sonst einen
        // zurück. Aktiv: getöntes Glas statt Flachfarbe (`flat: true`, das
        // Kästchen ist zu klein für einen sichtbaren Außenschatten).
        style={checked
          ? {
              ...tintedGlassStyle(accentColor, { flat: true, theme: theme.toggle, insetHighlight: theme.toggle.insetHighlight }),
              ...activeStyle,
            }
          : { border: 'none' }}
      >
        {/* Häkchen-Farbe je nach Helligkeit der Akzentfarbe statt hart
            codiertem Weiß (Session-Vorgabe). */}
        {checked && <Check size={16} strokeWidth={3} color={readableTextColor(accentColor)} />}
      </span>
      {label && <span className={checked ? '' : 'text-glass-muted'}>{label}</span>}
    </button>
  );
}
