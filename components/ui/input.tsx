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
  autoComplete,
  required,
  name,
  autoFocus,
  style,
  onFocus,
  onBlur,
  onEnter,
  ghost,
  onCompleteGhost,
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
  /** Fokus-Callbacks (z.B. für Autosuggest-Dropdowns). */
  onFocus?: () => void;
  onBlur?: () => void;
  /** Enter-Taste im Feld (z.B. Suche sofort ausführen + Tastatur schließen). */
  onEnter?: () => void;
  /** Inline-Autocomplete („Ghost-Text"): der VOLLE Vorschlag (z.B. „Glurak"),
   *  während `value` erst „glur" ist. Ist er ein Präfix-Match zu `value`, wird
   *  der Rest ausgegraut hinter der Eingabe gezeigt. Mobil-robust, weil es weder
   *  den Wert noch die Textselektion anfasst (nur ein Overlay). */
  ghost?: string;
  /** „Ghost" übernehmen (→/Tab am Zeilenende) — setzt den vollen Vorschlag. */
  onCompleteGhost?: () => void;
  /** Fokussiert das Feld direkt beim Mounten (z.B. Suchfeld in einem gerade
   *  geöffneten Dropdown/Panel). */
  autoFocus?: boolean;
  /** Native Formular-Attribute — u.a. nötig, damit Passwort-Manager/Browser-
   *  Autofill funktionieren (z.B. `autoComplete="current-password"`) und die
   *  HTML5-Pflichtfeld-Validierung greift (`required`). */
  autoComplete?: string;
  required?: boolean;
  name?: string;
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
  const fontClass = size === 'lg' ? 'text-base' : 'text-sm';
  const padClass = variant === 'search' ? 'pl-9 pr-8' : 'px-3';
  // Inline-Autocomplete-Overlay: nur wenn `ghost` ein echtes Präfix-Match zu
  // `value` ist (und nicht zu lang, sonst scrollt die Eingabe und das Overlay
  // liefe aus dem Tritt). Der getippte Teil bleibt unsichtbar (die echte Eingabe
  // scheint durch), nur der Rest wird ausgegraut angehängt.
  const ghostActive =
    !!ghost && value.length > 0 && value.length <= 24 &&
    ghost.length > value.length && ghost.toLowerCase().startsWith(value.toLowerCase());
  const ghostSuffix = ghostActive ? ghost!.slice(value.length) : '';
  const handleKeyDown = (onEnter || onCompleteGhost) ? (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { if (onEnter) { e.preventDefault(); onEnter(); (e.currentTarget as HTMLInputElement).blur(); } return; }
    // →/Tab am Zeilenende (ohne Selektion) übernimmt den Ghost-Vorschlag.
    if (onCompleteGhost && ghostActive && (e.key === 'ArrowRight' || e.key === 'Tab')) {
      const el = e.currentTarget;
      if (el.selectionStart === value.length && el.selectionEnd === value.length) {
        e.preventDefault(); onCompleteGhost();
      }
    }
  } : undefined;
  return (
    <div className="relative">
      {variant === 'search' && (
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-glass-muted pointer-events-none z-10" />
      )}
      <input
        type={variant === 'search' ? 'search' : type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        name={name}
        autoFocus={autoFocus}
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
      {/* Ghost-Text-Overlay (Inline-Autocomplete): liegt deckungsgleich über der
          Eingabe; der getippte Teil ist unsichtbar (echte Eingabe scheint durch),
          nur der Rest erscheint ausgegraut. `pointer-events-none` → stört keine
          Klicks/Selektion. */}
      {ghostActive && (
        <div
          aria-hidden
          className={cn(
            'absolute inset-0 flex items-center rounded-full overflow-hidden pointer-events-none whitespace-pre',
            fontClass, padClass,
          )}
        >
          <span className="invisible">{value}</span>
          <span className="text-glass-muted">{ghostSuffix}</span>
        </div>
      )}
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
