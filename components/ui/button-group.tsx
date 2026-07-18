'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { tintedGlassStyle } from '@/lib/ui/tinted-glass';
import { readableTextColorBlended, hexToRgba } from '@/lib/color-utils';
import { useGlassTheme } from '@/lib/ui/glass-theme';

// Feste Kantenlänge der iconOnly-Buttons (`w-11 h-11`) + Track-Innenabstand
// (`p-0.5`) — als Zahlen statt Tailwind-Klassen gebraucht, um die Position
// des gleitenden Indikators (unten) exakt zu berechnen, ohne den DOM messen
// zu müssen (alle iconOnly-Optionen sind gleich groß, kein ResizeObserver
// nötig). Das Text-Segment hat dagegen unterschiedlich breite Optionen
// (Label + optionale Zähler-Zahl) — dessen Indikator wird per DOM-Messung
// positioniert (`useLayoutEffect` unten), nicht per fixer Zellgröße.
const ICON_ONLY_CELL = 44;
const ICON_ONLY_TRACK_PADDING = 2;
// Dauer der Gleit-Animation (Position + Stauch-Keyframe in app/globals.css,
// `.goo-squish`) — muss mit der `goo-squish`-Keyframe-Dauer dort
// übereinstimmen.
const GOO_DURATION_MS = 420;

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
  /** Füllfarbe der aktiven Option (Textsegmente) — Default App-Rot, als
   *  Hex-Wert (nicht CSS-Var), da `tintedGlassStyle` das für die Tönung
   *  braucht. Für `iconOnly` ungenutzt, dort ist die aktive Option immer ein
   *  weiß getönter Chip (siehe `theme.buttonGroupIcon` unten). */
  accentColor?: string;
  /** Icon-only-Variante (z.B. Theme-Switcher): runde Buttons statt
   *  Textsegmente, aktive Option = weiß getöntes Glas auf grauem Track statt
   *  Akzentfarbfüllung — ersetzt die bisher eigenständig gebaute Toggle-
   *  Variante. Eigenes Theme (`theme.buttonGroupIcon`), unabhängig vom
   *  Text-Segment (`theme.buttonGroupText`). */
  iconOnly?: boolean;
  /** Nur für die Design-System-Testseite: überschreibt testweise den Stil
   *  des aktiven Segments/Indikators (Entwurf), ohne das gespeicherte Theme
   *  zu ändern — wird nach dem intern berechneten Stil gemerged. */
  activeStyle?: React.CSSProperties;
  /** Nur für die Design-System-Testseite: überschreibt testweise den Stil
   *  des Tracks (Entwurf) — der Track liest seinen Hintergrund sonst immer
   *  aus dem zuletzt GESPEICHERTEN Theme (`useGlassTheme()`), nicht aus dem
   *  Entwurf; ohne diesen Override hätten die "Hintergrund-Deckkraft
   *  (inaktiv)"-Regler auf der Testseite keine sichtbare Wirkung. */
  trackStyle?: React.CSSProperties;
}

export function ButtonGroup<T extends string>({
  options,
  value,
  onChange,
  className = '',
  accentColor = '#e53e3e', // var(--pokedex-red) als Hex — s.o.
  iconOnly = false,
  activeStyle,
  trackStyle,
}: ButtonGroupProps<T>) {
  // Abonniert den geteilten Glas-Theme-Store nur für Reaktivität (siehe
  // `Button`) — das aktive Segment liest `theme.buttonGroupText`/
  // `theme.buttonGroupIcon` unten (getrennte Themes).
  const [theme] = useGlassTheme();
  const activeIndex = iconOnly ? options.findIndex(o => o.value === value) : -1;

  // Text-Segment: Indikator-Position/-Breite wird per DOM-Messung bestimmt
  // (Optionen sind unterschiedlich breit, anders als die festen iconOnly-
  // Zellen) — `useLayoutEffect` misst vor dem nächsten Paint, kein Flackern.
  const trackRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef(new Map<string, HTMLButtonElement>());
  const [textRect, setTextRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    if (iconOnly) return;
    const track = trackRef.current;
    const btn = btnRefs.current.get(String(value));
    if (!track || !btn) return;
    const trackBox = track.getBoundingClientRect();
    const btnBox = btn.getBoundingClientRect();
    setTextRect({
      left: btnBox.left - trackBox.left,
      top: btnBox.top - trackBox.top,
      width: btnBox.width,
      height: btnBox.height,
    });
    // `options.length` als Dep, da eine geänderte Optionsliste (z.B. neue
    // Zähler-Werte) die Breiten verschiebt, ohne dass sich `value` ändert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, iconOnly, options.length]);

  return (
    <div
      ref={trackRef}
      // `rounded-full` für beide Varianten — iOS 26 behandelt Segmented
      // Controls wie Buttons/Pills: vollständig gerundet. KEIN
      // `overflow-hidden` mehr (weder hier noch je an dieser Stelle nötig):
      // beide Varianten füllen sich jetzt über einen absolut positionierten,
      // rund gerenderten Indikator (nicht über die Segmente selbst), der
      // dadurch einen Schatten frei nach außen werfen kann, statt hart am
      // Track-Rand abgeschnitten zu werden (Nutzer-Feedback: "Schatten
      // scheint nicht aus dem Element heraus").
      className={`relative flex rounded-full p-0.5 ${iconOnly ? 'backdrop-blur-[14px]' : ''} ${className}`}
      // Kein Rahmen (Session-Vorgabe) — `.glass-inner` bringt sonst einen
      // zurück, siehe button.tsx für dieselbe Begründung. Track-Hintergrund
      // kommt inline aus dem jeweiligen Theme statt fixer CSS-Klassen:
      // iconOnly aus `theme.buttonGroupIcon.trackColor/trackAlpha` (EIN
      // gemeinsamer Wert für Light+Dark); Text-Segment aus `theme.
      // buttonGroupText.trackAlpha` (Farbe bleibt Weiß, Blur/Sättigung fix
      // 14px/1.3, nur Deckkraft ist themebar). `trackStyle` (Testseite)
      // überschreibt das für den Entwurf, siehe Prop-Kommentar oben.
      style={{
        border: 'none',
        ...(iconOnly
          ? { background: hexToRgba(theme.buttonGroupIcon.trackColor, theme.buttonGroupIcon.trackAlpha) }
          : {
              background: `rgba(255,255,255,${theme.buttonGroupText.trackAlpha})`,
              backdropFilter: 'blur(14px) saturate(1.3)',
              WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
            }),
        ...trackStyle,
      }}
      role="group"
    >
      {iconOnly && activeIndex >= 0 && (
        // Äußere Schicht: reine Positionierung (CSS-Transition auf
        // `transform`) — die Stauch/Wabber-Keyframe-Animation (`goo-squish`,
        // app/globals.css) sitzt bewusst auf einem inneren Element, da
        // `transition` (Position) und `animation` (Stauchen) nicht dieselbe
        // CSS-Property auf demselben Element steuern können. `key=
        // {activeIndex}` re-triggert die Keyframe-Animation bei jedem
        // Wechsel. Kein SVG-Blur-Filter (erster Versuch) — der macht die
        // Ränder während der GESAMTEN Übergangsdauer unscharf (Nutzer-
        // Feedback), die Stauch-Keyframe allein liefert das "gooey"-Gefühl
        // bereits ohne jede Unschärfe.
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            width: ICON_ONLY_CELL, height: ICON_ONLY_CELL,
            top: ICON_ONLY_TRACK_PADDING, left: ICON_ONLY_TRACK_PADDING,
            transform: `translateX(${activeIndex * ICON_ONLY_CELL}px)`,
            transition: `transform ${GOO_DURATION_MS}ms cubic-bezier(.34,1.56,.64,1)`,
          }}
        >
          <div
            key={activeIndex}
            className="goo-squish w-full h-full rounded-full"
            style={{
              // KEIN `flat: true` hier (anders als Switch/Checkbox) — die
              // reicht bei einem farblosen, weißen Chip nicht: ohne eigenen
              // Schatten war der Indikator bei niedriger Deckkraft auf
              // dunklem Untergrund (Dark Mode) praktisch unsichtbar
              // ("Zieleinstellung nicht aktiv"-Bug). Der Schatten (Deckkraft/
              // Y-Versatz/Blur, alle themebar über `theme.buttonGroupIcon`)
              // gibt dem Chip Kontur unabhängig vom Hintergrund. Farbe kommt
              // aus `theme.buttonGroupIcon.activeColor` (Default Weiß, aber
              // themebar — anders als Text-Segment/Switch/Checkbox, die ihre
              // Farbe per `accentColor`-Prop bekommen).
              ...tintedGlassStyle(theme.buttonGroupIcon.activeColor, {
                theme: theme.buttonGroupIcon,
                insetHighlight: theme.buttonGroupIcon.insetHighlight,
                shadowOpacity: theme.buttonGroupIcon.shadowOpacity,
                shadowOffsetY: theme.buttonGroupIcon.shadowOffsetY,
                shadowBlur: theme.buttonGroupIcon.shadowBlur,
              }),
              ...activeStyle,
            }}
          />
        </div>
      )}

      {!iconOnly && textRect && (
        // Analog zum iconOnly-Indikator oben, nur mit gemessener statt
        // fixer Größe/Position (siehe `useLayoutEffect` oben) — dieselbe
        // Gooey-Mechanik (Position-Transition außen, Stauch-Keyframe innen)
        // gilt jetzt für BEIDE Varianten von `ButtonGroup`.
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            left: textRect.left, top: textRect.top, width: textRect.width, height: textRect.height,
            transition: `left ${GOO_DURATION_MS}ms cubic-bezier(.34,1.56,.64,1), width ${GOO_DURATION_MS}ms cubic-bezier(.34,1.56,.64,1)`,
          }}
        >
          <div
            key={String(value)}
            className="goo-squish w-full h-full rounded-full"
            style={{
              // Getöntes Glas statt Flachfarbe — dieselbe "Tinted"-Optik wie
              // bei den Button-Varianten (primary/destructive/add/scan).
              // Voller Schatten/Schein möglich (kein `flat: true` mehr) —
              // der Indikator ist jetzt ein eigenständiges, rundes Element
              // statt eines eckigen Segment-Hintergrunds, das war vorher am
              // Track-Rand hart abgeschnitten (`overflow-hidden`, jetzt
              // entfernt).
              ...tintedGlassStyle(accentColor, {
                theme: theme.buttonGroupText,
                insetHighlight: theme.buttonGroupText.insetHighlight,
                shadowOpacity: theme.buttonGroupText.shadowOpacity,
                shadowOffsetY: theme.buttonGroupText.shadowOffsetY,
                shadowBlur: theme.buttonGroupText.shadowBlur,
              }),
              ...activeStyle,
            }}
          />
        </div>
      )}

      {options.map((opt) => {
        const active = opt.value === value;
        // Nie die gerade aktive Option deaktivieren — sonst wirkt sie ohne
        // erkennbaren Grund "eingefroren", obwohl sie ja bereits gewählt ist.
        const isDisabled = !!opt.disabled && !active;
        return (
          <button
            key={opt.value}
            ref={el => {
              if (iconOnly) return;
              if (el) btnRefs.current.set(String(opt.value), el);
              else btnRefs.current.delete(String(opt.value));
            }}
            onClick={() => !isDisabled && onChange(opt.value)}
            disabled={isDisabled}
            aria-label={opt.ariaLabel}
            // `relative z-10` in BEIDEN Varianten — hebt den Text/das Icon
            // über den gleitenden Indikator (liegt als vorheriges
            // Geschwister-Element im DOM, ohne z-index wäre die
            // Stapelreihenfolge sonst von der Dokumentreihenfolge abhängig).
            className={
              iconOnly
                ? `relative z-10 w-11 h-11 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${active ? '' : 'text-glass-muted'}`
                : `relative z-10 flex-1 min-h-11 px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap flex items-center justify-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed ${active ? '' : 'text-glass-muted'}`
            }
            // Die Füllung kommt jetzt für BEIDE Varianten aus dem
            // gleitenden Indikator (oben) — der Button selbst bekommt nur
            // noch die Textfarbe. `readableTextColorBlended` statt
            // `readableTextColor`: kontrastiert gegen die tatsächlich
            // sichtbare (mit Deckkraft gemischte) Fläche, nicht die
            // volldeckende Rohfarbe (derselbe Fix wie bei `secondary`,
            // siehe tinted-glass.ts).
            style={
              !iconOnly && active
                ? { color: readableTextColorBlended(accentColor, theme.buttonGroupText.alpha) }
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
