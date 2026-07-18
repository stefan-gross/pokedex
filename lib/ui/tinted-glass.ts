/**
 * Getönter Glas-Chip-Stil für Aktions-Buttons (Hinzufügen/Löschen/Speichern),
 * den Scan-FAB (components/BottomNav.tsx) sowie das aktive Segment von
 * `ButtonGroup` — blur + Sättigung + heller Innenrand + dezenter Schatten,
 * an Apples offizieller Liquid-Glass-Spec ausgerichtet (siehe Kommentar in
 * `tintedGlassStyle`). Zentral hier statt pro Datei dupliziert.
 *
 * `tintedGlassStyle`/`primaryGlassStyle`/`scanFabStyle` lesen ihre
 * Transparenz/Blur/Sättigung/Verlauf/Glanz/Rahmen/Schatten-Werte jetzt aus
 * `lib/ui/glass-theme.ts` (`getGlassTheme()`) statt aus hartcodierten
 * Konstanten — dieselbe Quelle, die auch die Design-System-Testseite
 * (`app/(app)/design-system-preview/page.tsx`) live verstellt. Siehe dort für
 * Details zum Laufzeit-Override-Mechanismus.
 */

import { lightenColor, darkenColor, hexToRgba, saturateColor, readableTextColor, readableTextColorBlended } from '@/lib/color-utils';
import { getGlassTheme, type GlassOverride, type PanelTheme, type InputOverride, type SecondaryOverride } from '@/lib/ui/glass-theme';

export function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

/** `blur(0px) saturate(1)` verändert nichts sichtbar, zwingt Chromium aber
 *  trotzdem in eine eigene Compositing-Ebene — dabei wird die Fläche
 *  sichtbar leicht grau eingefärbt, obwohl Hintergrund/Rahmen/Schatten alle
 *  `transparent`/`none` sind (reproduziert an `secondary` + Hintergrundfarbe
 *  "Keine" + Blur 0). Fix: bei neutralen Werten `backdrop-filter` komplett
 *  weglassen (`undefined`), statt eine wirkungslose, aber compositing-
 *  auslösende Filterkette zu setzen. */
export function backdropFilterValue(blur: number, saturate: number): string | undefined {
  return blur === 0 && saturate === 1 ? undefined : `blur(${blur}px) saturate(${saturate})`;
}

export function tintedGlassStyle(
  hex: string,
  opts?: {
    flat?: boolean; alpha?: number; theme?: PanelTheme; insetHighlight?: number;
    /** Nur im nicht-`flat`-Zweig wirksam (Ambient-Schatten) — Default
     *  entspricht dem bisherigen Fixwert `0 4px 12px rgba(0,0,0,.3)`. */
    shadowOpacity?: number; shadowOffsetY?: number; shadowBlur?: number;
  },
): React.CSSProperties {
  const rgb = hexToRgb(hex);
  // Default bleibt das geteilte Panel-Theme (Glas-auf-Glas, Add-/Lösch-FABs
  // in den Sammlungs-Screens) — `opts.theme` erlaubt `ButtonGroup`/`Switch`/
  // `Checkbox` (alle `flat: true`), stattdessen `getGlassTheme().toggle` zu
  // nutzen, ohne alle anderen `tintedGlassStyle`-Aufrufer mit zu ändern.
  const theme = opts?.theme ?? getGlassTheme().panel;
  // Inset-Highlight nach Apples eigener Spec ("apply an inner shadow — white
  // 30%, blur 6 — for lift", developer.apple.com/documentation/
  // technologyoverviews/adopting-liquid-glass) — dieselbe Formel wie `.glass`
  // in globals.css, damit Panels und getönte Buttons/ButtonGroups konsistent
  // denselben "Lift" zeigen statt zweier leicht abweichender Rezepte. Bisher
  // fix 0.3, jetzt per `opts.insetHighlight` überschreibbar (`ToggleTheme`).
  const insetHighlight = `inset 0 0 6px rgba(255,255,255,${opts?.insetHighlight ?? 0.3})`;
  // `alpha` erlaubt einzelnen Aufrufern (z.B. destructive/add im Button, auf
  // denselben Wert wie primary angeglichen) weiterhin eine abweichende
  // Deckkraft, ohne alle anderen `tintedGlassStyle`-Nutzer mit zu verändern.
  const alpha = opts?.alpha ?? theme.alpha;
  const backdropFilter = backdropFilterValue(theme.blur, theme.saturate);
  return {
    background: `rgba(${rgb},${alpha})`,
    backdropFilter,
    WebkitBackdropFilter: backdropFilter,
    // Kein Rahmen (Session-Vorgabe: alle Elemente außer Panels/Dialoge/Sheets
    // sind randlos) — Kantendefinition kommt ausschließlich vom Inset-
    // Highlight + Ambient-Schatten unten, kein zusätzlicher `border`.
    border: 'none',
    // `flat: true` (z.B. das aktive Segment in `ButtonGroup`) lässt die
    // beiden ÄUSSEREN Schatten (Farbtupfer + Ambient) weg — das Segment hat
    // selbst keine eigene Rundung, nur der Track drumherum clippt via
    // `overflow-hidden` zur Kapsel. Ein äußerer Schatten würde dort hart am
    // Container-Rand abgeschnitten, aber ins Nachbarsegment hineinbluten —
    // sichtbar als schiefer, asymmetrischer Schatten. Der Inset-Highlight
    // bleibt immer, da er innerhalb der eigenen Box liegt und nicht vom
    // Clipping betroffen ist.
    boxShadow: opts?.flat
      ? insetHighlight
      : `${insetHighlight}, 0 0 6px rgba(${rgb},0.25), 0 ${opts?.shadowOffsetY ?? 4}px ${opts?.shadowBlur ?? 12}px rgba(0,0,0,${opts?.shadowOpacity ?? 0.3})`,
  };
}

/**
 * Nur die `--btn-shadow-color`-Variable, die `.btn-glass-interactive`
 * (globals.css) für Schatten/Press-Verdunkelung braucht — geteilt zwischen
 * `primaryGlassStyle` und `destructive`, das seinen eigenen (flachen)
 * Hintergrund aus `tintedGlassStyle` behält, aber dasselbe Hover-/Press-
 * Verhalten wie `primary` übernimmt.
 */
export function glassInteractiveVars(hex: string, shadowAlpha = 0.4): React.CSSProperties {
  return {
    '--btn-shadow-color': hexToRgba(darkenColor(hex, 0.4), shadowAlpha),
  } as React.CSSProperties;
}

/** Baut Hintergrund (flach oder Verlauf) + Rahmen aus einem `GlassOverride`
 *  — von primary UND scan genutzt, da beide jetzt dasselbe Options-Set
 *  (Verlauf, Rahmen) unterstützen. */
function backgroundAndBorder(hex: string, o: GlassOverride): Pick<React.CSSProperties, 'background' | 'border'> {
  const rgb = hexToRgb(hex);
  const background = o.gradient
    ? `linear-gradient(135deg, ${hexToRgba(lightenColor(hex, o.gradientLighten), o.alpha)}, ${hexToRgba(darkenColor(hex, o.gradientDarken), o.alpha)})`
    : `rgba(${rgb},${o.alpha})`;
  const border = o.borderWidth > 0 ? `${o.borderWidth}px solid rgba(255,255,255,${o.borderOpacity})` : 'none';
  return { background, border };
}

/**
 * Scan-Button-Rezept — 1:1 das Original-Rezept des Scan-FABs in der
 * Fußnavigation (`components/BottomNav.tsx`, `fabStyle`/`scanCameraStyle`,
 * bislang unabhängig von diesem Modul gepflegt), jetzt aus `getGlassTheme().
 * scan` gespeist. Rahmen ist hier bewusst standardmäßig AN (Ausnahme von der
 * "randlos"-Regel, da hier der bestehende FAB-Look nachgebildet wird) — der
 * farbige Glow ist ein festes Signatur-Element, nicht Teil des Themes.
 */
export function scanFabStyle(hex: string): React.CSSProperties {
  const o = getGlassTheme().scan;
  const rgb = hexToRgb(hex);
  const { background, border } = backgroundAndBorder(hex, o);
  const insetShadow = `inset 0 1px 2px rgba(255,255,255,${o.insetHighlight})`;
  const glow = `0 0 26px rgba(${rgb},0.55)`; // fester Signatur-Glow, nicht themebar
  const ambientShadow = `0 ${o.shadowOffsetY}px ${o.shadowBlur}px rgba(0,0,0,${o.shadowOpacity})`;
  const backdropFilter = backdropFilterValue(o.blur, o.saturate);
  return {
    background,
    backdropFilter,
    WebkitBackdropFilter: backdropFilter,
    border,
    boxShadow: `${insetShadow}, ${glow}, ${ambientShadow}`,
  };
}

/**
 * Primary-Button-Rezept — adaptiert aus dem vom Nutzer gefundenen CSS-
 * Snippet ("iOS-natives Test-Rezept"): Verlauf aus zwei Tönen der
 * Akzentfarbe statt einer flachen Tönung, Press-Zustand verdunkelt den
 * Schatten statt ihn nur zu verkleinern. Übernimmt UNSERE Kapsel-Rundung
 * (kommt vom `Button`-Grundstil, hier nicht dupliziert) und UNSERE Farbe
 * (Gradient-Stopps aus `hex` berechnet statt fest verdrahtetem Blau).
 *
 * Hintergrund + Rahmen kommen jetzt direkt inline aus dem Theme (unkritisch,
 * da Hover/Press diese Properties nicht anfassen). Die Schatten-GEOMETRIE
 * (Y-Versatz/Blur/innerer Glanz) wird dagegen als CSS-Variable gesetzt und
 * von `.btn-glass-interactive`/`.btn-primary-shadow` (app/globals.css)
 * gelesen — `box-shadow` selbst bleibt CSS-getrieben, weil `:active` dort
 * eine abweichende (dunklere/kleinere) Version definiert; ein inline
 * `boxShadow` hier würde das per Kaskade-Priorität dauerhaft überschreiben
 * und die Press-Verdunkelung kaputt machen.
 */
export function primaryGlassStyle(hex: string): React.CSSProperties {
  const o = getGlassTheme().primary;
  // Sättigungs-Boost bleibt ein fester ästhetischer Kniff (nicht Teil des
  // Themes) — bei niedriger Deckkraft bleibt die Farbe so trotzdem als
  // "diese Farbe" erkennbar statt zu verblassen.
  const vivid = saturateColor(hex, 0.6);
  const { background, border } = backgroundAndBorder(vivid, o);
  const backdropFilter = backdropFilterValue(o.blur, o.saturate);
  return {
    background,
    border,
    ...glassInteractiveVars(hex, o.shadowOpacity),
    '--btn-shadow-y': `${o.shadowOffsetY}px`,
    '--btn-shadow-blur': `${o.shadowBlur}px`,
    '--btn-inset-opacity': String(o.insetHighlight),
    backdropFilter,
    WebkitBackdropFilter: backdropFilter,
  } as React.CSSProperties;
}

/** Referenzfarben für `secondary`s Hintergrundfarbe-Wahl — feste Basistöne
 *  (kein Akzentfarbe-Konzept wie bei primary/scan). */
const SECONDARY_COLOR_HEX: Record<Exclude<SecondaryOverride['colorMode'], 'none'>, string> = {
  white: '#ffffff',
  black: '#000000',
  gray: '#8e8e93',
};

/**
 * Secondary-Button-Rezept — ersetzt das bisherige feste `.glass-inner`
 * (siehe `SecondaryOverride`-Kommentar in glass-theme.ts). `secondary` hat
 * wie `scan` KEINE `.btn-glass-interactive`-Presse-CSS-Klasse (nur
 * `active:scale-[.97]`), `box-shadow` kann hier also unbedenklich komplett
 * inline gesetzt werden (kein Konflikt wie bei primary/Input).
 *
 * `colorMode: 'none'` lässt nur die FÜLLUNG weg (reiner Text-Button) —
 * Blur/Sättigung (Verzerrungseffekt auf den Hintergrund), Rahmen und
 * Schatten/Glanz brauchen dagegen keine eigene Füllfarbe und bleiben auch
 * ohne Hintergrundfarbe wirksam. Nur der Verlauf ist ausgenommen (er
 * definiert ja gerade die Füllung, ergibt ohne sie keinen Sinn). */
export function secondaryGlassStyle(): React.CSSProperties {
  const o = getGlassTheme().secondary;
  const border = o.borderWidth > 0 ? `${o.borderWidth}px solid rgba(255,255,255,${o.borderOpacity})` : 'none';
  const shadows = [
    o.insetHighlight > 0 ? `inset 0 1px 0 0 rgba(255,255,255,${o.insetHighlight})` : null,
    o.shadowOpacity > 0 ? `0 ${o.shadowOffsetY}px ${o.shadowBlur}px rgba(0,0,0,${o.shadowOpacity})` : null,
  ].filter(Boolean);
  const boxShadow = shadows.length > 0 ? shadows.join(', ') : 'none';
  const backdropFilter = backdropFilterValue(o.blur, o.saturate);

  if (o.colorMode === 'none') {
    return { background: 'transparent', border, boxShadow, backdropFilter, WebkitBackdropFilter: backdropFilter };
  }
  const hex = SECONDARY_COLOR_HEX[o.colorMode];
  const { background } = backgroundAndBorder(hex, o);
  return {
    background,
    border,
    // Volles Schwarz/Weiß (`readableTextColor` allein) wirkte auf dem eher
    // zurückhaltenden `secondary`-Button zu fett/präsent — `textOpacity`
    // dämpft die Textfarbe, ohne die Füllung selbst anzufassen.
    // `readableTextColorBlended` statt `readableTextColor`: bei niedriger
    // Deckkraft (`o.alpha`) ist die tatsächlich sichtbare Fläche viel heller
    // als der rohe Hex-Wert (mit dem Seitenhintergrund gemischt) — sonst
    // wählt die Kontrastformel z.B. bei Grau+Alpha 0.2 im Light Mode fälsch-
    // lich Weiß, obwohl die real helle Fläche dunklen Text braucht.
    color: hexToRgba(readableTextColorBlended(hex, o.alpha), o.textOpacity),
    backdropFilter,
    WebkitBackdropFilter: backdropFilter,
    boxShadow,
  };
}

/** Rezept für den inaktiven Bereich der `Progress`-Leiste — ersetzt das
 *  bisherige feste `.glass-inner-clear` (siehe `GlassTheme.progressTrack`-
 *  Kommentar in glass-theme.ts für den Light/Dark-Unifizierungs-Hintergrund). */
export function progressTrackStyle(theme?: PanelTheme): React.CSSProperties {
  const t = theme ?? getGlassTheme().progressTrack;
  const backdropFilter = backdropFilterValue(t.blur, t.saturate);
  return {
    background: `rgba(255,255,255,${t.alpha})`,
    backdropFilter,
    WebkitBackdropFilter: backdropFilter,
  };
}

/** Rezept für `Input` — Transparenz/Blur/Sättigung/Rahmen aus dem Theme.
 *  Bewusst OHNE Glanz/Schatten (siehe `InputOverride`-Kommentar in
 *  glass-theme.ts: würde den Accessibility-Fokus-Ring per `box-shadow`-
 *  Kaskade verdecken). */
export function inputGlassStyle(theme?: InputOverride): React.CSSProperties {
  const o = theme ?? getGlassTheme().input;
  const backdropFilter = backdropFilterValue(o.blur, o.saturate);
  return {
    background: `rgba(255,255,255,${o.alpha})`,
    backdropFilter,
    WebkitBackdropFilter: backdropFilter,
    border: o.borderWidth > 0 ? `${o.borderWidth}px solid rgba(255,255,255,${o.borderOpacity})` : 'none',
  };
}
