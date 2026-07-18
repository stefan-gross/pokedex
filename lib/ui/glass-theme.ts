'use client';

import { useSyncExternalStore } from 'react';

/**
 * Eine-Quelle-der-Wahrheit für alle "Glas"-Stilwerte (Panels, primary/scan-
 * Buttons) — sowohl echte App-Komponenten (`.glass`-CSS via Custom
 * Properties, `tintedGlassStyle`/`primaryGlassStyle`/`scanFabStyle` in
 * `lib/ui/tinted-glass.ts`) als auch die Design-System-Testseite
 * (`app/(app)/design-system-preview/page.tsx`) lesen/schreiben denselben
 * Zustand. Der Laufzeit-Override gilt NUR für diesen Browser (localStorage)
 * — betrifft nicht andere Nutzer/Geräte oder das Deployment. Eine dauerhafte
 * Übernahme in den Code (diese Datei) passiert weiterhin manuell, nachdem
 * ein Wert live abgestimmt wurde — bewusst kein automatischer Schreibzugriff
 * auf den Quellcode.
 *
 * Bewusst NICHT Teil dieses Themes: das Sheet/Dialog-Rezept (`.glass-sheet`,
 * echtes Rezept unterscheidet sich strukturell — dunkles Navy statt
 * Alpha-Weiß im Dark Mode) — bleibt vorerst nur auf der Testseite simuliert.
 * `secondary` und die Textfarbe (Schwarz-/Weißwert) waren das anfangs auch,
 * sind aber inzwischen ebenfalls Teil des Themes (siehe `SecondaryOverride`/
 * `textColor` unten) — auf Nutzerwunsch soll "Speichern" wirklich ALLE
 * Testseiten-Regler erfassen, nicht nur eine Teilmenge.
 */
export interface GlassOverride {
  alpha: number; blur: number; saturate: number;
  borderWidth: number; borderOpacity: number;
  shadowOpacity: number; shadowOffsetY: number; shadowBlur: number;
  gradient: boolean; gradientLighten: number; gradientDarken: number;
  insetHighlight: number;
}

export interface PanelTheme { alpha: number; blur: number; saturate: number }

/** `secondary` hat keine Akzentfarbe — statt `hex`/`accentColor` wählt man
 *  hier direkt zwischen keiner Füllung (transparent), Weiß, Schwarz oder Grau
 *  (bisher fixer `.glass-inner`-Look). Erbt sonst alle Regler von
 *  `GlassOverride` (Deckkraft/Blur/Sättigung/Verlauf/Glanz/Rahmen/Schatten) —
 *  bei `colorMode: 'none'` wirken davon nur Blur/Sättigung noch (reiner
 *  Verzerrungseffekt auf den Hintergrund, braucht keine eigene Füllfläche),
 *  der Rest (Deckkraft/Verlauf/Glanz/Rahmen/Schatten) bräuchte eine Füllung,
 *  um sichtbar zu sein — siehe `secondaryGlassStyle()` in tinted-glass.ts. */
export interface SecondaryOverride extends GlassOverride {
  colorMode: 'none' | 'white' | 'black' | 'gray';
  /** Deckkraft der Textfarbe (nicht der Füllung) — der volle Kontrast aus
   *  `readableTextColor()` (reines Schwarz/Weiß) wirkte auf einem eher
   *  zurückhaltend gedachten `secondary`-Button zu "präsent"/fett. Nur bei
   *  `colorMode !== 'none'` wirksam (dort ist die Textfarbe klassenbasiert
   *  `text-foreground`, siehe `secondaryGlassStyle()`). */
  textOpacity: number;
}

/** Vereinfachtes Rezept für Input (Rahmen ohne Verlauf/Schatten) — Verlauf/
 *  Glanz/Schatten fehlen bewusst: Inputs brauchen weiterhin einen sichtbaren
 *  Fokus-Ring (Accessibility-Pflicht, `focus:ring-2` in `components/ui/
 *  input.tsx`), der über `box-shadow` funktioniert. Ein eigener, per Theme
 *  gesetzter `box-shadow` (Glanz/Schatten) würde den Fokus-Ring per CSS-
 *  Kaskade dauerhaft verdecken — Rahmen/Transparenz/Blur/Sättigung sind
 *  dagegen unproblematisch (kein Konflikt mit `box-shadow`). */
export interface InputOverride {
  alpha: number; blur: number; saturate: number;
  borderWidth: number; borderOpacity: number;
}

/** Rezept für den aktiven Zustand von `Switch`/`Checkbox` — beide nutzen
 *  `tintedGlassStyle(accentColor, { flat: true })` (getöntes Glas, kein
 *  Außenschatten). Bisher fix an `panel.alpha/blur/saturate` +
 *  hartcodiertem `insetHighlight: 0.3` gekoppelt — jetzt ein eigener,
 *  unabhängig einstellbarer Wert. `ButtonGroup` hat EIGENE, unabhängige
 *  Themes (`buttonGroupText`/`buttonGroupIcon` unten, getrennt auf
 *  Nutzerwunsch) — teilt sich NICHT mehr dieses Feld. Auch das
 *  Text-Segment und die iconOnly-Variante von `ButtonGroup` teilen sich
 *  UNTEREINANDER kein Feld mehr (zweiter Trennungs-Wunsch) — jede der drei
 *  "Toggle-artigen" Komponenten (Switch/Checkbox, ButtonGroup-Text,
 *  ButtonGroup-iconOnly) hat ihr eigenes, unabhängiges Theme. */
export interface ToggleTheme extends PanelTheme {
  insetHighlight: number;
}

/** Rezept für `ButtonGroup`s Text-Segment (Alle/Vorhanden/Fehlen-Stil).
 *  Anders als bei `ToggleTheme` (Switch/Checkbox) hat das Text-Segment
 *  jetzt einen eigenen Schatten/Schein am aktiven Segment (`shadowOpacity/
 *  shadowOffsetY/shadowBlur`, `flat: false` statt `flat: true`) sowie eine
 *  eigene Transparenz für den Track im INAKTIVEN Zustand (`trackAlpha`,
 *  ersetzt die bisher fixe `.glass-inner-clear`-Klasse — Farbe bleibt Weiß,
 *  nur die Deckkraft ist themebar). Achtung (bewusst in Kauf genommen, auf
 *  Nutzerwunsch): der Track clippt via `overflow-hidden` zu einer Kapsel —
 *  ein Schatten am aktiven Segment kann dadurch am Track-Rand hart
 *  abgeschnitten wirken, siehe button-group.tsx. */
export interface ButtonGroupTextTheme extends ToggleTheme {
  shadowOpacity: number;
  shadowOffsetY: number;
  shadowBlur: number;
  trackAlpha: number;
}

/** Rezept für `ButtonGroup`s iconOnly-Variante (z.B. Light/Dark-Umschalter)
 *  — eigenständig, getrennt sowohl von `Switch`/`Checkbox` (`ToggleTheme`
 *  oben) als auch vom Text-Segment derselben Komponente (`buttonGroupText`
 *  oben). */
export interface ButtonGroupTheme extends ToggleTheme {
  /** Nur für die iconOnly-Variante (z.B. Light/Dark-Umschalter) — das
   *  Text-Segment bekommt seine Farbe weiterhin über die `accentColor`-Prop
   *  pro Aufrufstelle (z.B. App-Rot). iconOnly hat keine sinnvolle
   *  "Akzentfarbe" (kein Filter-Kontext), daher hier direkt themebar. Hex,
   *  Default Weiß. */
  activeColor: string;
  /** Schatten des aktiven iconOnly-Chips — gibt ihm Kontur unabhängig vom
   *  Hintergrund (Light/Dark-Track). Nur bei iconOnly wirksam, da das
   *  Text-Segment `flat: true` nutzt (siehe `tintedGlassStyle`, Schatten
   *  dort per Definition weggelassen). */
  shadowOpacity: number;
  shadowOffsetY: number;
  shadowBlur: number;
  /** Track-Hintergrund im INAKTIVEN Zustand (nur iconOnly) — bisher fix
   *  `rgba(30,40,80,.08)` (Light) / `rgba(255,255,255,.18)` (Dark). Jetzt
   *  EIN gemeinsamer Wert für beide Modi (analog zu `progressTrack` u.a.
   *  oben — ein Kompromiss zwischen den beiden bisherigen Werten). */
  trackColor: string;
  trackAlpha: number;
}

export interface GlassTheme {
  panel: PanelTheme;
  primary: GlassOverride;
  secondary: SecondaryOverride;
  scan: GlassOverride;
  /** Inaktiver Bereich der `Progress`-Leiste — bisher fix `.glass-inner-clear`,
   *  jetzt wie Panel ein gemeinsamer Alpha/Blur/Sättigung-Wert für Light UND
   *  Dark (ersetzt die bisher unterschiedlichen Light/Dark-Werte dieser
   *  Klasse — siehe Kommentar dort). */
  progressTrack: PanelTheme;
  input: InputOverride;
  /** Nur `Switch`/`Checkbox` (aktiver Zustand). */
  toggle: ToggleTheme;
  /** Nur `ButtonGroup`s Text-Segment (Alle/Vorhanden/Fehlen-Stil) —
   *  eigenständig, getrennt von `buttonGroupIcon` unten. */
  buttonGroupText: ButtonGroupTextTheme;
  /** Nur `ButtonGroup`s iconOnly-Variante (z.B. Light/Dark-Umschalter) —
   *  eigenständig, siehe `ButtonGroupTheme`-Kommentar oben. */
  buttonGroupIcon: ButtonGroupTheme;
  /** Textfarbe auf `.glass` (`.text-glass`/`.text-glass-muted`, app/globals.css)
   *  — ein Graustufen-Kanal (0–255) je Modus, entspricht dem "Schwarzwert"/
   *  "Weißwert"-Regler auf der Testseite. `light`/`dark` bleiben bewusst
   *  getrennt (anders als Panel/primary/scan, die EINEN Wert für beide Modi
   *  teilen) — Text muss in jedem Modus einzeln lesbar bleiben. */
  textColor: { light: number; dark: number };
}

// Startwerte entsprechen dem zuletzt in der Design-System-Testseite
// bestätigten/gespeicherten Stand (per "Speichern" live abgestimmt) — nicht
// mehr den ursprünglichen Fixwerten aus `app/globals.css`. Diese Konstante
// ist die kanonische Quelle, alle Style-Funktionen lesen von hier statt
// eigener hartcodierter Zahlen.
export const DEFAULT_GLASS_THEME: GlassTheme = {
  panel: { alpha: 0.15, blur: 22, saturate: 1.4 },
  primary: {
    alpha: 0.46, blur: 13, saturate: 1.7,
    borderWidth: 0, borderOpacity: 0.5,
    shadowOpacity: 0.5, shadowOffsetY: 2, shadowBlur: 6,
    gradient: true, gradientLighten: 0.15, gradientDarken: 0.15,
    insetHighlight: 0.3,
  },
  secondary: {
    alpha: 0.07, blur: 13, saturate: 1.7, borderWidth: 0, borderOpacity: 0.5,
    shadowOpacity: 0.25, shadowOffsetY: 1, shadowBlur: 1,
    gradient: true, gradientLighten: 0.15, gradientDarken: 0.15, insetHighlight: 0.3,
    colorMode: 'white', textOpacity: 0.75,
  },
  scan: {
    alpha: 0.85, blur: 10, saturate: 1.4,
    borderWidth: 1.5, borderOpacity: 0.5,
    shadowOpacity: 0.4, shadowOffsetY: 6, shadowBlur: 20,
    gradient: false, gradientLighten: 0.15, gradientDarken: 0.15,
    insetHighlight: 0.6,
  },
  // Bisher `.glass-inner-clear`: Light `rgba(255,255,255,.4)`, Dark
  // `rgba(255,255,255,.08)`, beide `blur(14px) saturate(1.3)` — als EIN
  // gemeinsamer Wert übernommen (Mittelweg 0.2), analog zur Panel-
  // Vereinheitlichung. Per Slider jederzeit anpassbar.
  progressTrack: { alpha: 0.2, blur: 14, saturate: 1.3 },
  input: { alpha: 0.2, blur: 14, saturate: 1.3, borderWidth: 0, borderOpacity: 0.5 },
  toggle: { alpha: 0.46, blur: 22, saturate: 1.4, insetHighlight: 0.3 },
  // Eigenständiges Theme für ButtonGroups Text-Segment (getrennt von
  // `toggle` UND von `buttonGroupIcon` unten, auf Nutzerwunsch) — Schatten/
  // Schein am aktiven Segment (bisher `flat: true`, kein Außenschatten) und
  // `trackAlpha` (Track-Deckkraft im inaktiven Zustand, ersetzt die bisher
  // fixe `.glass-inner-clear`-Deckkraft) live abgestimmt.
  buttonGroupText: {
    alpha: 0.46, blur: 13, saturate: 1.7, insetHighlight: 0.3,
    shadowOpacity: 0.55, shadowOffsetY: 2, shadowBlur: 6,
    trackAlpha: 0.15,
  },
  // Eigenständiges Theme für ButtonGroups iconOnly-Variante.
  buttonGroupIcon: {
    alpha: 0.46, blur: 13, saturate: 1.7, insetHighlight: 0.3,
    activeColor: '#ffffff',
    shadowOpacity: 0.55, shadowOffsetY: 2, shadowBlur: 4,
    trackColor: '#3d4670', trackAlpha: 0.15,
  },
  // Entspricht der Leuchtdichte von `.text-glass`s bisherigem Fixwert
  // (`#1E2024` ≈ Graustufe 32, `#fff` = 255) — neutrales Grau statt des
  // leichten Blaustichs von `#1E2024`, kaum wahrnehmbarer Unterschied.
  textColor: { light: 32, dark: 255 },
};

const STORAGE_KEY = 'pokedex-glass-theme-override';

let state: GlassTheme = DEFAULT_GLASS_THEME;
const listeners = new Set<() => void>();

/** Spiegelt Panel- und Textfarbe-Werte als CSS Custom Properties auf `:root`
 *  — dort lesen `.glass`/`.text-glass` (app/globals.css) sie mit Fallback
 *  auf den jeweiligen Default. Beide Textfarbe-Werte werden IMMER beide
 *  gesetzt (nicht nur der gerade aktive Modus) — `.text-glass`/`.dark
 *  .text-glass` wählen per CSS-Selektor selbst den richtigen aus. */
function applyCssVars(panel: PanelTheme, textColor: GlassTheme['textColor']) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--glass-alpha', String(panel.alpha));
  root.style.setProperty('--glass-blur', `${panel.blur}px`);
  root.style.setProperty('--glass-saturate', String(panel.saturate));
  root.style.setProperty('--text-glass-light', String(textColor.light));
  root.style.setProperty('--text-glass-dark', String(textColor.dark));
}

function persist(next: GlassTheme) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* z.B. privater Modus — Override gilt dann nur für die Session */ }
}

/** Einmal beim App-Start aufgerufen (siehe `GlassThemeHydrator` im Root-
 *  Layout) — liest einen evtl. gespeicherten Override aus diesem Browser und
 *  wendet die CSS-Variablen an, bevor irgendetwas mit `.glass` gerendert wird.
 *  Merged JEDES verschachtelte Feld einzeln gegen `DEFAULT_GLASS_THEME`
 *  (nicht nur die Top-Level-Felder) — ein `localStorage`-Stand von VOR einer
 *  Theme-Erweiterung (z.B. `buttonGroupText.shadowOpacity`, erst nachträglich
 *  ergänzt) hat NUR das übergeordnete Objekt, nicht das neue Unterfeld; ein
 *  reiner Top-Level-Merge (`{...DEFAULT, ...parsed}`) würde das alte,
 *  unvollständige `parsed.buttonGroupText` komplett übernehmen und damit die
 *  neuen Unterfelder verlieren (→ `undefined`, Style-Funktionen crashen beim
 *  Zugriff, z.B. `.toFixed()` auf der Testseite). */
export function hydrateGlassTheme() {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GlassTheme>;
      state = {
        ...DEFAULT_GLASS_THEME,
        ...parsed,
        panel: { ...DEFAULT_GLASS_THEME.panel, ...parsed.panel },
        primary: { ...DEFAULT_GLASS_THEME.primary, ...parsed.primary },
        secondary: { ...DEFAULT_GLASS_THEME.secondary, ...parsed.secondary },
        scan: { ...DEFAULT_GLASS_THEME.scan, ...parsed.scan },
        progressTrack: { ...DEFAULT_GLASS_THEME.progressTrack, ...parsed.progressTrack },
        input: { ...DEFAULT_GLASS_THEME.input, ...parsed.input },
        toggle: { ...DEFAULT_GLASS_THEME.toggle, ...parsed.toggle },
        buttonGroupText: { ...DEFAULT_GLASS_THEME.buttonGroupText, ...parsed.buttonGroupText },
        buttonGroupIcon: { ...DEFAULT_GLASS_THEME.buttonGroupIcon, ...parsed.buttonGroupIcon },
        textColor: { ...DEFAULT_GLASS_THEME.textColor, ...parsed.textColor },
      };
    }
  } catch { /* kaputtes/altes Format ignorieren, bei Default bleiben */ }
  applyCssVars(state.panel, state.textColor);
  listeners.forEach(l => l());
}

/** Nicht-reaktiver Zugriff — von den reinen Style-Funktionen in
 *  `lib/ui/tinted-glass.ts` bei jedem Aufruf frisch gelesen. */
export function getGlassTheme(): GlassTheme {
  return state;
}

export function setGlassTheme(updater: GlassTheme | ((prev: GlassTheme) => GlassTheme)) {
  state = typeof updater === 'function' ? (updater as (p: GlassTheme) => GlassTheme)(state) : updater;
  applyCssVars(state.panel, state.textColor);
  persist(state);
  listeners.forEach(l => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reaktiver Hook — Komponenten, die sich bei Theme-Änderungen neu rendern
 *  sollen (z.B. `Button`, damit `primaryGlassStyle`/`scanFabStyle` mit
 *  frischen Werten neu berechnet werden), abonnieren hierüber. */
export function useGlassTheme(): [GlassTheme, typeof setGlassTheme] {
  const theme = useSyncExternalStore(subscribe, getGlassTheme, () => DEFAULT_GLASS_THEME);
  return [theme, setGlassTheme];
}
