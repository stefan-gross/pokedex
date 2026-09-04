'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { secondaryGlassStyle, primaryGlassStyle } from '@/lib/ui/tinted-glass';
import { readableTextColor } from '@/lib/color-utils';
import { useGlassTheme } from '@/lib/ui/glass-theme';
import { Input } from '@/components/ui/input';

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
  return { className: 'font-medium text-glass', style: secondaryGlassStyle() };
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
  /** Gedämpfte Zahl rechts (z.B. Treffer-Count). */
  count?: number;
  /** Gedämpfter Zusatztext rechts im PANEL — NICHT im Trigger (dort steht nur
   *  `label`). Z.B. Langform zum Kürzel („Near Mint" neben „NM") oder ein
   *  Status wie „Empfohlen". */
  hint?: string;
  /** Ausgegraut + nicht wählbar (z.B. 0 Treffer). */
  disabled?: boolean;
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

  // Untere Grenze ist normalerweise der Viewport-Rand — aber eine fix am unteren
  // Rand klebende BottomNav verdeckt sonst die untersten Optionen. Klebt eine
  // solche Nav da, endet das Panel oberhalb ihrer Oberkante.
  let bottomLimit = viewportH - PANEL_MARGIN;
  const nav = typeof document !== 'undefined' ? document.querySelector('nav') : null;
  if (nav) {
    const nr = nav.getBoundingClientRect();
    if (nr.height > 0 && nr.bottom >= viewportH - 120 && nr.top < bottomLimit) {
      bottomLimit = nr.top - PANEL_MARGIN;
    }
  }
  const spaceBelow = bottomLimit - rect.bottom;
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
  fullWidth = false,
  panelWide = false,
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
  /** Trigger füllt die volle Breite (Label links, Chevron rechts); Panel
   *  übernimmt die Trigger-Breite statt der Standard-Max-Breite. */
  fullWidth?: boolean;
  /** Auch bei `fullWidth` darf das Options-Panel breiter als der Trigger werden
   *  (bis `PANEL_MAX_WIDTH`), statt auf die Trigger-Breite begrenzt zu sein —
   *  für schmale Trigger (z.B. 3-spaltige Auswahl), deren Optionen sonst mit
   *  „…" abgeschnitten würden. Mindestbreite bleibt die Trigger-Breite. */
  panelWide?: boolean;
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
          'inline-flex items-center gap-1.5 rounded-full transition-transform duration-150 active:scale-[.97] btn-glass-interactive pl-3 pr-2.5',
          fullWidth ? 'w-full justify-between' : 'shrink-0',
          variantClassName,
          height === 'sm' ? 'h-9 text-[12px]' : 'h-11 text-xs',
          className,
        )}
        style={{ border: 'none', ...variantStyle }}
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          {selected?.icon}
          <span className="truncate">{selected?.label ?? placeholder}</span>
        </span>
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
              minWidth: pos.width, maxWidth: fullWidth && !panelWide ? pos.width : PANEL_MAX_WIDTH, maxHeight: pos.maxHeight,
              boxShadow: '0 8px 24px rgba(0,0,0,.25)',
            }}
          >
            {options.map(o => (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                onClick={() => { if (o.disabled) return; setOpen(false); onChange(o.value); }}
                className="w-full text-left px-3 py-2 text-role-body text-glass flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                style={o.value === value ? { fontWeight: 700 } : undefined}
              >
                {o.icon}
                <span className="truncate">{o.label}</span>
                {o.hint && (
                  <span className="ml-auto shrink-0 text-glass-muted text-role-label">{o.hint}</span>
                )}
                {o.count != null && (
                  <span className={`shrink-0 text-glass-muted text-role-label ${o.hint ? 'ml-1.5' : 'ml-auto'}`}>{o.count.toLocaleString('de')}</span>
                )}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

export interface SearchableSelectOption<T extends string> {
  value: T;
  label: string;
  /** Zusätzlicher, nicht angezeigter Suchtext (z.B. englischer Name, Set-Kürzel)
   *  — wird beim Filtern mit durchsucht, damit man ein Set auch über den
   *  EN-Namen oder das Kürzel findet, obwohl das Label deutsch ist. */
  keywords?: string;
  /** Optionales Icon links (z.B. Set-Logo/-Symbol). */
  icon?: React.ReactNode;
  /** Gedämpfter Zusatz rechts (z.B. Set-Kürzel „MEW"). */
  hint?: string;
  /** Optionale zweite Zeile unter dem Label (z.B. Zyklus/Serie eines Sets). */
  sub?: string;
  /** Optionaler Inhalt rechts VOR dem `hint` (z.B. Set-Symbol + Kürzel). Anders
   *  als `hint` beliebige Nodes (Bild + Text), rechtsbündig, nicht umbrechend. */
  trailing?: React.ReactNode;
}

/**
 * Wie `CustomSelect` (Portal-Panel, gleiche Optik/Positionslogik), aber mit
 * einem **Suchfeld** oben im Panel — für lange Optionslisten (z.B. ~218 Sets),
 * bei denen ein reines Dropdown unbrauchbar lang wird. Die Reihenfolge der
 * `options` bleibt erhalten (Aufrufer sortiert selbst, z.B. alphabetisch);
 * gefiltert wird case-insensitiv über `label` + `keywords`.
 */
export function SearchableSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder = '—',
  searchPlaceholder = 'Suchen …',
  className,
  height = 'md',
  variant = 'secondary',
  accentColor,
  fullWidth = false,
  onQueryChange,
  emptyMessage = 'Keine Treffer',
  'aria-label': ariaLabel,
}: {
  value: T | null;
  onChange: (value: T) => void;
  options: SearchableSelectOption<T>[];
  /** Angezeigt, wenn `value` zu keiner Option passt. */
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  height?: 'sm' | 'md';
  variant?: 'primary' | 'secondary';
  accentColor?: string;
  /** Trigger füllt die volle Breite (Label links, Chevron rechts); Panel
   *  übernimmt die Trigger-Breite statt der Standard-Max-Breite. */
  fullWidth?: boolean;
  /** Remote-Modus: wird bei jeder Sucheingabe aufgerufen (Aufrufer entprellt +
   *  liefert die passenden `options`). Gesetzt = KEINE Client-Filterung mehr,
   *  `options` werden 1:1 gerendert (z.B. Firestore-Suche wie Pokémon). */
  onQueryChange?: (query: string) => void;
  /** Text, wenn keine Optionen da sind (Default „Keine Treffer"). */
  emptyMessage?: string;
  'aria-label'?: string;
}) {
  useGlassTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<PanelPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(o => o.value === value);
  const { className: variantClassName, style: variantStyle } = selectVariantStyle(variant, accentColor);

  const filtered = useMemo(() => {
    if (onQueryChange) return options; // Remote-Modus: Aufrufer filtert
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || o.keywords?.toLowerCase().includes(q),
    );
  }, [options, query, onQueryChange]);

  // Remote-Modus: Suchbegriff an den Aufrufer geben (der entprellt + sucht).
  useEffect(() => { onQueryChange?.(query); }, [query, onQueryChange]);

  // Bei jedem Öffnen die Suche zurücksetzen (frische Liste).
  useEffect(() => { if (open) setQuery(''); }, [open]);

  function openPanel() {
    if (btnRef.current) setPos(computePanelPos(btnRef.current.getBoundingClientRect()));
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
          'inline-flex items-center gap-1.5 rounded-full transition-transform duration-150 active:scale-[.97] btn-glass-interactive pl-3 pr-2.5 py-1',
          fullWidth ? 'w-full justify-between' : 'shrink-0',
          variantClassName,
          height === 'sm' ? 'min-h-9 text-[12px]' : 'min-h-11 text-xs',
          className,
        )}
        style={{ border: 'none', ...variantStyle }}
      >
        {/* Trigger spiegelt die Options-Zeile: Icon · Name (+ Sub-Zeile) ·
            rechtsbündiger Hint. */}
        <span className="inline-flex items-center gap-1.5 min-w-0 flex-1 text-left">
          {selected?.icon}
          {selected ? (
            <span className="min-w-0 flex-1">
              <span className="truncate block">{selected.label}</span>
              {selected.sub && <span className="truncate block text-glass-muted text-role-label">{selected.sub}</span>}
            </span>
          ) : (
            <span className="truncate text-glass-muted">{placeholder}</span>
          )}
          {selected?.trailing && <span className="ml-auto shrink-0 flex items-center gap-1 opacity-70 text-role-label">{selected.trailing}</span>}
          {selected?.hint && <span className={`shrink-0 opacity-50 tabular-nums ${selected.trailing ? 'ml-1.5' : 'ml-auto'}`}>{selected.hint}</span>}
        </span>
        <ChevronDown size={12} className="opacity-70 shrink-0" />
      </button>

      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setOpen(false)} />
          <div
            className="glass fixed rounded-xl flex flex-col z-[201]"
            style={{
              top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right,
              minWidth: pos.width, maxWidth: fullWidth ? pos.width : PANEL_MAX_WIDTH, maxHeight: pos.maxHeight,
              boxShadow: '0 8px 24px rgba(0,0,0,.25)',
            }}
          >
            <div className="p-2 pb-1 shrink-0">
              <Input
                variant="search"
                size="sm"
                value={query}
                onChange={setQuery}
                onClear={() => setQuery('')}
                placeholder={searchPlaceholder}
                autoFocus
              />
            </div>
            <div className="overflow-y-auto py-1 flex-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-role-label text-glass-muted">{emptyMessage}</p>
              ) : filtered.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { setOpen(false); onChange(o.value); }}
                  className="w-full text-left px-3 py-2 text-role-body text-glass flex items-center gap-2"
                  style={o.value === value ? { fontWeight: 700 } : undefined}
                >
                  {o.icon}
                  <span className="min-w-0 flex-1">
                    <span className="truncate block">{o.label}</span>
                    {o.sub && <span className="truncate block text-glass-muted text-role-label">{o.sub}</span>}
                  </span>
                  {o.trailing && <span className="shrink-0 flex items-center gap-1 text-glass-muted text-role-label">{o.trailing}</span>}
                  {o.hint && <span className="shrink-0 text-glass-muted text-role-label tabular-nums">{o.hint}</span>}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

export interface MultiSelectOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  count?: number;
  disabled?: boolean;
  /** Akzentfarbe für den aktiven Zustand (Pill-Rahmen/-Tönung), z.B. Typ-Farbe. */
  color?: string;
}

/**
 * Mehrfach-Auswahl-Dropdown (Portal-Panel wie `CustomSelect`). Die aktuelle
 * Auswahl wird direkt im Trigger als entfernbare **Pills** angezeigt; das
 * geöffnete Panel listet alle Optionen (Icon + Label + Count), Tippen schaltet
 * eine Option an/aus, ohne das Panel zu schließen (Mehrfachauswahl). Für Fälle
 * wie den Pokémon-Typ-Filter, wo ein reines Pill-Band zu breit/unruhig wird.
 */
export function MultiSelect<T extends string>({
  values,
  onChange,
  options,
  placeholder = 'Auswählen …',
  className,
  height = 'md',
  fullWidth = true,
  'aria-label': ariaLabel,
}: {
  values: T[];
  onChange: (values: T[]) => void;
  options: MultiSelectOption<T>[];
  placeholder?: string;
  className?: string;
  height?: 'sm' | 'md';
  fullWidth?: boolean;
  'aria-label'?: string;
}) {
  useGlassTheme();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const { className: variantClassName, style: variantStyle } = selectVariantStyle('secondary');

  const selectedSet = new Set(values);
  const selectedOptions = options.filter(o => selectedSet.has(o.value));

  const toggle = (v: T) =>
    onChange(selectedSet.has(v) ? values.filter(x => x !== v) : [...values, v]);

  function openPanel() {
    if (btnRef.current) setPos(computePanelPos(btnRef.current.getBoundingClientRect()));
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
          'inline-flex items-center gap-1.5 rounded-full transition-transform duration-150 active:scale-[.97] btn-glass-interactive pl-2.5 pr-2.5 min-h-9',
          fullWidth ? 'w-full justify-between' : 'shrink-0',
          variantClassName,
          height === 'sm' ? 'text-[12px]' : 'text-xs',
          className,
        )}
        style={{ border: 'none', ...variantStyle }}
      >
        {selectedOptions.length === 0 ? (
          <span className="text-glass-muted pl-0.5 py-1.5">{placeholder}</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1 py-1 min-w-0">
            {selectedOptions.map(o => (
              <span
                key={o.value}
                role="button"
                tabIndex={0}
                aria-label={`${o.label} entfernen`}
                onClick={e => { e.stopPropagation(); toggle(o.value); }}
                className="inline-flex items-center gap-1 rounded-full border pl-1.5 pr-1 py-0.5 text-[11px] font-semibold"
                style={{
                  borderColor: o.color ?? 'var(--pokedex-red)',
                  background: `color-mix(in srgb, ${o.color ?? 'var(--pokedex-red)'} 15%, transparent)`,
                  color: o.color ?? 'var(--pokedex-red)',
                }}
              >
                {o.icon}
                {o.label}
                <X size={12} className="opacity-70" />
              </span>
            ))}
          </span>
        )}
        <ChevronDown size={12} className="opacity-70 shrink-0" />
      </button>

      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setOpen(false)} />
          <div
            className="glass fixed rounded-xl overflow-y-auto py-1 z-[201]"
            style={{
              top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right,
              minWidth: pos.width, maxWidth: fullWidth ? pos.width : PANEL_MAX_WIDTH, maxHeight: pos.maxHeight,
              boxShadow: '0 8px 24px rgba(0,0,0,.25)',
            }}
          >
            {options.map(o => {
              const active = selectedSet.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={o.disabled}
                  onClick={() => !o.disabled && toggle(o.value)}
                  className="w-full text-left px-3 py-2 text-role-body text-glass flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={active ? { fontWeight: 700 } : undefined}
                >
                  {o.icon}
                  <span className="truncate">{o.label}</span>
                  {o.count != null && (
                    <span className="ml-auto shrink-0 text-glass-muted text-role-label">{o.count}</span>
                  )}
                  {active && <Check size={14} className={o.count != null ? 'ml-1 shrink-0' : 'ml-auto shrink-0'} />}
                </button>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
