'use client';

import { tintedGlassStyle } from '@/lib/ui/tinted-glass';
import { useGlassTheme } from '@/lib/ui/glass-theme';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  /** Füllfarbe im aktiven Zustand — Default App-Rot. */
  accentColor?: string;
  disabled?: boolean;
  className?: string;
  /** Icon IM Thumb (weißer Knopf), das je nach Zustand wechselt — z.B. ein
   *  „i" (an) vs. durchgestrichenes „i" (aus). Ohne Angabe bleibt der Thumb
   *  leer wie bisher. Icons erben `currentColor` (an: Akzent, aus: grau). */
  iconOn?: React.ReactNode;
  iconOff?: React.ReactNode;
  /** Zugänglicher Name, wenn kein sichtbares `label` gesetzt ist (Icon-Switch). */
  'aria-label'?: string;
  /** Nur für die Design-System-Testseite: überschreibt testweise den Stil
   *  des aktiven Tracks (Entwurf), ohne das gespeicherte Theme zu ändern. */
  activeTrackStyle?: React.CSSProperties;
}

/**
 * iOS-artiger An/Aus-Switch — extrahiert aus dem bisher einzigen, in
 * `app/(app)/collection/page.tsx` (Evolutionslinie) handgebauten Toggle,
 * jetzt als wiederverwendbare Komponente statt Kopiervorlage.
 */
export function Switch({ checked, onChange, label, accentColor = '#e53e3e', disabled, className = '', iconOn, iconOff, activeTrackStyle, ...rest }: SwitchProps) {
  const [theme] = useGlassTheme();
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={rest['aria-label']}
      disabled={disabled}
      className={`flex items-center gap-1.5 text-xs shrink-0 min-h-11 disabled:opacity-40 ${className}`}
    >
      <span
        className="w-12 h-7 rounded-full flex items-center shrink-0 transition-colors px-0.5"
        // Getöntes Glas statt Flachfarbe im aktiven Zustand (Session-Vorgabe:
        // Transparenz für alle Elemente) — `flat: true`, da der Track sehr
        // schmal ist und ein großer Schatten unproportional wirken würde.
        // Kein Rahmen (schon vorher so, hier bewusst nicht ergänzt).
        style={checked
          ? {
              ...tintedGlassStyle(accentColor, { flat: true, theme: theme.toggle, insetHighlight: theme.toggle.insetHighlight }),
              ...activeTrackStyle,
            }
          : { background: 'rgba(120,120,130,.3)' }}
      >
        <span
          className="w-6 h-6 rounded-full bg-white shadow-sm transition-transform flex items-center justify-center"
          style={{
            transform: checked ? 'translateX(20px)' : 'translateX(0)',
            color: checked ? accentColor : 'rgba(120,120,130,.9)',
          }}
        >
          {checked ? iconOn : iconOff}
        </span>
      </span>
      {label && <span className={checked ? '' : 'text-glass-muted'}>{label}</span>}
    </button>
  );
}
