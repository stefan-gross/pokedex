'use client';

import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGlassTheme } from '@/lib/ui/glass-theme';
import { inputGlassStyle } from '@/lib/ui/tinted-glass';

/**
 * Zentraler Text-/Search-Input — extrahiert aus dem am saubersten bereits
 * gestylten Vorkommen (`collection/page.tsx`-Suchfeld). `variant="search"`
 * zeigt ein Lupen-Icon links + optional einen Clear-Button rechts, sobald
 * ein Wert eingetragen ist. Randlos, immer Kapsel-Rundung (Session-Vorgabe:
 * einheitlich mit Button/ButtonGroup/Chip). Fokus-Ring-Animation (weicher
 * `transition-shadow` statt hartem Sprung) ist ein von glinui übernommenes
 * Politur-Detail, kein neues Farbschema.
 */
export function Input({
  value,
  onChange,
  placeholder,
  variant = 'default',
  size = 'md',
  onClear,
  className,
  type = 'text',
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  variant?: 'default' | 'search';
  size?: 'sm' | 'md' | 'lg';
  /** Zeigt einen Clear-("×")-Button rechts, sobald `value` nicht leer ist. */
  onClear?: () => void;
  className?: string;
  type?: string;
  /** Nur für `/design-system-preview` gedacht — überschreibt Transparenz/
   *  Blur/Sättigung/Rahmen zum Live-Abstimmen. Echte Aufrufer lassen das weg
   *  und bekommen den aktuell GESPEICHERTEN Stand (`getGlassTheme().input`). */
  style?: React.CSSProperties;
}) {
  // Abonniert das geteilte Theme nur, damit diese Komponente neu rendert,
  // wenn `inputGlassStyle()` frische Werte liefern soll (analog zu
  // `useGlassTheme()` in `components/ui/button.tsx`).
  useGlassTheme();
  const heightClass = size === 'sm' ? 'h-9 text-sm' : size === 'lg' ? 'h-12 text-base' : 'h-11 text-sm';
  return (
    <div className="relative">
      {variant === 'search' && (
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-glass-muted pointer-events-none" />
      )}
      <input
        type={variant === 'search' ? 'search' : type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        // Fokus-Ring bleibt (Accessibility: sichtbarer Fokus ist Pflicht) —
        // das läuft über Tailwinds `ring`-Utility (ebenfalls `box-shadow`,
        // aber nur bei `:focus` aktiv) — deshalb setzt `inputGlassStyle()`
        // nie selbst einen `box-shadow`, sonst würde der Ring dauerhaft
        // verdeckt (Kaskade: inline `style` schlägt jede Pseudoklassen-Regel).
        style={{ border: 'none', ...inputGlassStyle(), ...style }}
        className={cn(
          // Immer `rounded-full` — dieselbe Kapsel-Form wie ButtonGroup/
          // Button (Session-Vorgabe: einheitliche Rundung für alle Elemente).
          'w-full text-glass placeholder:text-glass-muted outline-none rounded-full',
          'focus:ring-2 focus:ring-ring transition-shadow duration-150',
          heightClass,
          variant === 'search' ? 'pl-9 pr-8' : 'px-3',
          className,
        )}
      />
      {onClear && value && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-glass-muted"
          aria-label="Eingabe löschen"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
