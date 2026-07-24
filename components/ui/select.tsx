'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { secondaryGlassStyle, primaryGlassStyle } from '@/lib/ui/tinted-glass';
import { readableTextColor } from '@/lib/color-utils';
import { useGlassTheme } from '@/lib/ui/glass-theme';

// Gleicher Default wie `Button`s `primary`-Variante (dort nicht exportiert,
// daher hier dupliziert) — `var(--pokedex-blue)`.
const DEFAULT_PRIMARY = '#3182ce';

/** Liefert Style+Klassen für die gewählte Variante — geteilt zwischen
 *  `Select` und `CustomSelect`, damit beide exakt dasselbe `primary`/
 *  `secondary`-Rezept wie `Button` nutzen (nicht nur `secondary`). */
function selectVariantStyle(variant: 'primary' | 'secondary', accentColor?: string) {
  if (variant === 'primary') {
    const color = accentColor ?? DEFAULT_PRIMARY;
    return {
      className: 'btn-primary-shadow font-semibold',
      style: { color: readableTextColor(color), ...primaryGlassStyle(color) } as React.CSSProperties,
    };
  }
  return { className: 'font-medium', style: secondaryGlassStyle() };
}

/**
 * Zentraler Select-Wrapper — extrahiert aus dem bisher mehrfach kopierten
 * Muster (`CardSortBar.tsx`, `collection/page.tsx`, `scanner/page.tsx`,
 * Blatt-Auswahl in `binders/[id]/page.tsx`, u.a.): `relative` Wrapper +
 * natives `<select appearance-none>` + absolut positionierter Chevron.
 *
 * Optik bewusst 1:1 vom `secondary`-Button übernommen (`secondaryGlassStyle()`
 * + `.btn-glass-interactive` für Hover-Lift/Press-Squish), NICHT mehr
 * `.glass-inner` — ein Select ist ein anklickbares Steuerelement ("Button,
 * der ein Menü öffnet"), keine reine Lese-/Eingabefläche wie ein Input oder
 * eine Zeile in einem Panel. Optisch identisch zum secondary-Button macht
 * das auf den ersten Blick erkennbar, statt wie ein flacher Info-Chip zu
 * wirken.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  height = 'md',
  variant = 'secondary',
  accentColor,
  'aria-label': ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  /** 'md' = h-11 (Standard, touch-target-konform), 'sm' = h-9 (kompakte Kontexte wie Blatt-Auswahl). */
  height?: 'sm' | 'md';
  /** Wie bei `Button`: `secondary` (Default, neutral) oder `primary`
   *  (Akzentfarbe, für den Fall, dass das Select selbst die Haupt-Aktion ist,
   *  z.B. eine prominente Sortier-/Set-Auswahl statt einer Nebensache). */
  variant?: 'primary' | 'secondary';
  /** Nur bei `variant="primary"` wirksam — Default `var(--pokedex-blue)`, wie bei `Button`. */
  accentColor?: string;
  'aria-label'?: string;
}) {
  // Abonniert den geteilten Glas-Theme-Store, damit `secondaryGlassStyle()`/
  // `primaryGlassStyle()` frische Werte liefern, sobald die Testseite das
  // Theme live verstellt (gleiches Muster wie in `button.tsx`).
  useGlassTheme();
  const { className: variantClassName, style: variantStyle } = selectVariantStyle(variant, accentColor);
  return (
    <label
      className={cn(
        'relative inline-flex items-center shrink-0 rounded-full transition-transform duration-150 active:scale-[.97] btn-glass-interactive',
        variantClassName,
        height === 'sm' ? 'h-9' : 'h-11',
      )}
      style={{ border: 'none', ...variantStyle }}
    >
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        aria-label={ariaLabel}
        className={cn(
          'appearance-none bg-transparent pl-3 pr-6 tabular-nums focus:outline-none rounded-full h-full',
          height === 'sm' ? 'text-[12px]' : 'text-xs',
          className,
        )}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2.5 pointer-events-none opacity-70" />
    </label>
  );
}

export interface CustomSelectOption<T extends string> {
  value: T;
  label: string;
  /** z.B. `BinderIcon`/Lucide-Icon vor dem Label — optional, für Fälle wie
   *  die Sammlung-Auswahl (Icon je Binder). */
  icon?: React.ReactNode;
}

/**
 * Eigenständiges Dropdown mit Trigger-Button + per Portal freischwebendem
 * Options-Panel — für Fälle, in denen ein natives `<select>` nicht reicht
 * (Icons pro Option, wie bisher bei der Sammlung-Auswahl in
 * `OwnedCopyRow`/`CardDetailSheet.tsx`, dort noch als Ad-hoc-Kopie ohne
 * Wiederverwendung). Optik identisch zu `Select`/`secondary`-Button
 * (`secondaryGlassStyle()` + `.btn-glass-interactive`) — nur die Öffnen-
 * Mechanik unterscheidet sich (Portal statt natives `<select>`), nicht das
 * Aussehen. Portal ist nötig, falls der Trigger in einem Container mit
 * `overflow-hidden` sitzt (das Panel würde sonst unsichtbar abgeschnitten).
 */
/** Viewport-Ränder, innerhalb derer das Options-Panel bleiben muss. */
const PANEL_MARGIN = 8;
/** Größtmögliche Panel-Breite — länge Labels (z.B. Sammlungsnamen) sollen
 *  nicht beliebig breiter als der Trigger werden dürfen, sonst reißt das
 *  Panel bei rechtsbündig sitzenden Triggern (z.B. `OwnedCopyRow`s
 *  Sammlung-Pille, `ml-auto`) über den rechten Bildschirmrand hinaus. */
const PANEL_MAX_WIDTH = 260;
/** Bevorzugte/maximale Panel-Höhe, wenn genug Platz ist. */
const PANEL_PREFERRED_MAX_HEIGHT = 240;

interface PanelPos {
  top?: number; bottom?: number; left?: number; right?: number;
  width: number; maxHeight: number;
}

/** Berechnet Position/Größe des Options-Panels aus der Trigger-`rect` —
 *  klappt nach OBEN statt unten, wenn unterhalb zu wenig Platz ist (z.B.
 *  eine Zeile nah am unteren Sheet-/Bildschirmrand), und bündig zum RECHTEN
 *  statt linken Trigger-Rand, wenn das Panel sonst über den rechten
 *  Bildschirmrand hinausragen würde (z.B. bei rechtsbündigen Triggern mit
 *  langen Options-Labels). Ohne das war je nach Zeilenposition/Label-Länge
 *  ein Teil des aufgeklappten Panels unsichtbar (außerhalb des Viewports),
 *  da bisher immer starr unterhalb + linksbündig geöffnet wurde. */
function computePanelPos(rect: DOMRect): PanelPos {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const maxWidth = Math.min(PANEL_MAX_WIDTH, viewportW - PANEL_MARGIN * 2);

  let left: number | undefined = rect.left;
  let right: number | undefined;
  if (rect.left + maxWidth > viewportW - PANEL_MARGIN) {
    left = undefined;
    right = Math.max(PANEL_MARGIN, viewportW - rect.right);
  }

  const spaceBelow = viewportH - rect.bottom - PANEL_MARGIN;
  const spaceAbove = rect.top - PANEL_MARGIN;
  let top: number | undefined;
  let bottom: number | undefined;
  let maxHeight: number;
  if (spaceBelow >= 150 || spaceBelow >= spaceAbove) {
    top = rect.bottom + 4;
    maxHeight = Math.max(100, Math.min(PANEL_PREFERRED_MAX_HEIGHT, spaceBelow));
  } else {
    bottom = viewportH - rect.top + 4;
    maxHeight = Math.max(100, Math.min(PANEL_PREFERRED_MAX_HEIGHT, spaceAbove));
  }

  return { top, bottom, left, right, width: rect.width, maxHeight };
}

export function CustomSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder = '—',
  className,
  height = 'md',
  variant = 'secondary',
  accentColor,
  'aria-label': ariaLabel,
}: {
  value: T | null;
  onChange: (value: T) => void;
  options: CustomSelectOption<T>[];
  /** Angezeigt, wenn `value` zu keiner Option passt (z.B. "Unsortiert"). */
  placeholder?: string;
  className?: string;
  height?: 'sm' | 'md';
  /** Wie bei `Button`/`Select`: `secondary` (Default) oder `primary`. */
  variant?: 'primary' | 'secondary';
  /** Nur bei `variant="primary"` wirksam — Default `var(--pokedex-blue)`. */
  accentColor?: string;
  'aria-label'?: string;
}) {
  useGlassTheme();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(o => o.value === value);
  const { className: variantClassName, style: variantStyle } = selectVariantStyle(variant, accentColor);

  function openPanel() {
    if (btnRef.current) {
      setPos(computePanelPos(btnRef.current.getBoundingClientRect()));
    }
    setOpen(true);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center gap-1.5 shrink-0 rounded-full transition-transform duration-150 active:scale-[.97] btn-glass-interactive pl-3 pr-2.5',
          variantClassName,
          height === 'sm' ? 'h-9 text-[12px]' : 'h-11 text-xs',
          className,
        )}
        style={{ border: 'none', ...variantStyle }}
      >
        {selected?.icon}
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown size={12} className="opacity-70 shrink-0" />
      </button>

      {open && pos && createPortal(
        <>
          {/* Backdrop — schließt das Panel bei Tap außerhalb */}
          <div className="fixed inset-0 z-[200]" onClick={() => setOpen(false)} />
          <div
            className="glass fixed rounded-xl overflow-y-auto py-1 z-[201]"
            style={{
              top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right,
              minWidth: pos.width, maxWidth: PANEL_MAX_WIDTH, maxHeight: pos.maxHeight,
              boxShadow: '0 8px 24px rgba(0,0,0,.25)',
            }}
          >
            {options.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { setOpen(false); onChange(o.value); }}
                className="w-full text-left px-3 py-2 text-role-body text-glass truncate flex items-center gap-1.5"
                style={o.value === value ? { fontWeight: 700 } : undefined}
              >
                {o.icon}
                <span className="truncate">{o.label}</span>
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
