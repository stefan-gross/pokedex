'use client';

import { useEffect, useRef, useState } from 'react';
import { Star, Sun, Moon, Image as ImageIcon, Waves, Trash2, Plus, Camera, Settings, Save, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { ButtonGroup } from '@/components/ui/button-group';
import { Select, CustomSelect } from '@/components/ui/select';
import { BinderIcon } from '@/lib/binder-icons';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Sheet, Dialog } from '@/components/ui/modal';
import { hexToRgb, progressTrackStyle, inputGlassStyle, backdropFilterValue, tintedGlassStyle } from '@/lib/ui/tinted-glass';
import { readableTextColor, readableTextColorBlended, lightenColor, darkenColor, hexToRgba } from '@/lib/color-utils';
import {
  getGlassTheme, setGlassTheme, DEFAULT_GLASS_THEME, resolveSwipeSolidColor,
  type GlassTheme, type GlassOverride, type SecondaryOverride,
} from '@/lib/ui/glass-theme';
import {
  Card, CARD_SIZE_PRESETS, DEFAULT_MISSING_CARD_STYLE, MISSING_CARD_EFFECTS, defaultBadgeLayoutFor,
  type CardSize, type MissingCardStyle, type CardTileBadgeLayout,
} from '@/components/card/Card';
import {
  getCardVisualTheme, setCardVisualTheme, DEFAULT_CARD_VISUAL_THEME, type CardVisualTheme,
} from '@/lib/ui/card-theme';
import { CardBadge } from '@/components/card/CardBadge';
import { OwnedCopyRow } from '@/components/card/CardDetailSheet';
import type { CardInfo } from '@/lib/card-info';
import type { CardDoc, BinderDoc } from '@/types';

// Auf Wunsch reduziert von 8 auf 3 strukturelle Varianten — "Löschen"/
// "Hinzufügen" sind kein eigener Typ mehr, sondern `variant="primary"` +
// eine andere `accentColor` (rot/grün statt Blau), siehe die "Aufbauend"-
// Sektion unten. `default`/`ghost`/`icon` waren app-weit ungenutzt (siehe
// Recherche) und sind komplett entfallen.
const BUTTON_VARIANTS = ['primary', 'secondary', 'scan'] as const;
type ButtonVariant = typeof BUTTON_VARIANTS[number];
const SIZES = ['sm', 'md', 'lg'] as const;

/** Referenzfarbe je Variante für den Button-Settings-Dialog — entspricht den
 *  `DEFAULT_*`-Konstanten in `components/ui/button.tsx`. `secondary` hat
 *  keine Akzentfarbe im klassischen Sinn — die Referenzfarbe hier wird nur
 *  für Verlauf-Berechnung gebraucht, falls `colorMode` "weiß"/"grau" ist
 *  (siehe `secondaryHex()` unten). */
const BUTTON_BASE_COLOR: Record<ButtonVariant, string> = {
  primary: '#3182ce',
  secondary: '#8e8e93',
  scan: '#8b5cf6',
};

/** `secondary`s tatsächliche Referenzfarbe hängt von `colorMode` ab (siehe
 *  `SecondaryOverride` in glass-theme.ts) — bei "keine" ist ohnehin
 *  transparent, die Farbe hier ist dann irrelevant. */
function secondaryHex(colorMode: SecondaryOverride['colorMode']): string {
  if (colorMode === 'white') return '#ffffff';
  if (colorMode === 'black') return '#000000';
  return '#8e8e93';
}

// `GlassOverride`/`SecondaryOverride` kommen aus `lib/ui/glass-theme.ts` —
// dieselbe Form, die auch die echten Buttons nutzen (keine doppelte
// Typdefinition mehr). `secondary` ist jetzt ebenfalls Teil des geteilten,
// speicherbaren Themes (siehe Kommentar dort) — Startwerte kommen aus
// `DEFAULT_GLASS_THEME.secondary`, keine eigene Konstante mehr nötig.

/** Baut aus einem `GlassOverride` + der Referenzfarbe der Variante ein
 *  Inline-Style-Objekt — deckt ALLE sichtbaren Stylings ab (Verlauf, innerer
 *  Glanz, Rahmen, Schatten), nicht nur eine flache Tönung, damit sich für
 *  alle 3 Varianten (inkl. secondary ohne eigenes Rezept) das komplette
 *  echte Erscheinungsbild ausprobieren lässt. Nur zum Testen auf dieser
 *  Seite — überschreibt testweise per `style`-Prop, ändert nichts an
 *  `components/ui/button.tsx` oder `lib/ui/tinted-glass.ts`
 *  (insbesondere KEIN Press-Verdunkeln wie `.btn-glass-interactive`, das
 *  bleibt CSS-only). */
function buttonOverrideStyle(variant: ButtonVariant, o: GlassOverride, colorOverride?: string): React.CSSProperties {
  // `colorOverride` — für die "Farbe"-Demoreihen (Löschen=Rot, Hinzufügen=
  // Grün): die echte `accentColor` des Buttons statt der festen Referenzfarbe
  // der Variante, sonst würde z.B. der rote Löschen-Button hier fälschlich
  // wieder blau eingefärbt (die Referenzfarbe ist nur der Default/die Basis
  // für den Settings-Dialog, nicht zwingend die tatsächlich sichtbare Farbe).
  const hex = colorOverride ?? BUTTON_BASE_COLOR[variant];
  const rgb = hexToRgb(hex);
  const background = o.gradient
    ? `linear-gradient(135deg, ${hexToRgba(lightenColor(hex, o.gradientLighten), o.alpha)}, ${hexToRgba(darkenColor(hex, o.gradientDarken), o.alpha)})`
    : `rgba(${rgb},${o.alpha})`;
  const shadows = [
    o.insetHighlight > 0 ? `inset 0 1px 0 0 rgba(255,255,255,${o.insetHighlight})` : null,
    o.shadowOpacity > 0 ? `0 ${o.shadowOffsetY}px ${o.shadowBlur}px rgba(0,0,0,${o.shadowOpacity})` : null,
  ].filter(Boolean);
  const backdropFilter = backdropFilterValue(o.blur, o.saturate);
  return {
    background,
    backdropFilter,
    WebkitBackdropFilter: backdropFilter,
    color: readableTextColor(hex),
    border: o.borderWidth > 0 ? `${o.borderWidth}px solid rgba(255,255,255,${o.borderOpacity})` : 'none',
    boxShadow: shadows.length > 0 ? shadows.join(', ') : 'none',
  };
}

/**
 * Section-Wrapper — gleiche Kachel-Optik für jede Komponenten-Sektion.
 * `plain` lässt die `.glass`-Hülle (Hintergrund/Blur/Border) weg — nur für
 * die Panel-Tuning-Sektion, deren Test-Panels sonst selbst schon "Glas auf
 * Glas" gegen einen zusätzlichen äußeren `.glass`-Rahmen wären.
 */
function Section({ title, children, plain }: { title: string; children: React.ReactNode; plain?: boolean }) {
  return (
    <section className={plain ? 'rounded-[20px] p-4 space-y-3' : 'glass rounded-[20px] p-4 space-y-3'}>
      <h2 className="text-role-h2 text-glass">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Live-Test-Panel für die Panel-Tuning-Sektion — zwei Slider (Transparenz +
 * Blur) pro Panel, komplett lokal/inline gestylt (NICHT die `.glass`-Klasse),
 * damit Experimente hier keine Auswirkung auf die echten Panels app-weit
 * haben. Enthält ein getöntes "Glas auf Glas"-Element, das dieselben zwei
 * Werte übernimmt — zeigt, wie sich Transparenz/Blur auf gestapeltes Glas
 * auswirken (der Fall, den die App bewusst vermeidet, hier aber zum
 * Vergleich gebraucht wird).
 */
/** Drei Slider (Transparenz/Blur/Sättigung) — von `TestPanel` zweimal genutzt
 *  (äußeres Panel + verschachteltes "Glas auf Glas"-Element), damit beide
 *  unabhängig voneinander einstellbar sind statt das innere Element die
 *  Werte des äußeren Panels zu übernehmen. */
// Fallback für Aufrufer, die keine eigenen Defaults übergeben — identisch zu
// `DEFAULT_GLASS_THEME.panel` (lib/ui/glass-theme.ts), der echten Quelle.
const GLASS_DEFAULTS = DEFAULT_GLASS_THEME.panel;

function GlassSliders({
  alpha, setAlpha, blur, setBlur, saturate, setSaturate, color,
  defaults = GLASS_DEFAULTS, hideAlpha,
}: {
  alpha: number; setAlpha: (v: number) => void;
  blur: number; setBlur: (v: number) => void;
  saturate: number; setSaturate: (v: number) => void;
  color: string;
  /** Wert, auf den ein Doppelklick den jeweiligen Slider zurücksetzt. */
  defaults?: { alpha: number; blur: number; saturate: number };
  /** Blendet nur den Deckkraft-Slider aus — für Kontexte ohne eigene
   *  Füllfläche (z.B. secondary + "Keine"), wo Blur/Sättigung als reiner
   *  Verzerrungseffekt trotzdem wirken, Deckkraft (Alpha der Füllung) aber
   *  nichts zum Einfärben hätte. */
  hideAlpha?: boolean;
}) {
  return (
    <>
      {!hideAlpha && (
        <label className="block text-role-label space-y-1" style={{ color }}>
          {/* "Deckkraft" statt "Transparenz" — der Wert ist Alpha (1 = voll
              deckend/undurchsichtig, 0 = komplett durchsichtig), also das
              GEGENTEIL dessen, was "Transparenz" nahelegt. Hat schon einmal zu
              Verwirrung geführt (Nutzer erwartete bei 1.0 einen durchsichtigen
              Button). */}
          <span>Deckkraft: {alpha.toFixed(2)}</span>
          <input
            type="range" min={0} max={1} step={0.01} value={alpha}
            onChange={e => setAlpha(Number(e.target.value))}
            onDoubleClick={() => setAlpha(defaults.alpha)}
            className="w-full"
          />
        </label>
      )}
      <label className="block text-role-label space-y-1" style={{ color }}>
        <span>Blur: {blur}px</span>
        <input
          type="range" min={0} max={40} step={1} value={blur}
          onChange={e => setBlur(Number(e.target.value))}
          onDoubleClick={() => setBlur(defaults.blur)}
          className="w-full"
        />
      </label>
      <label className="block text-role-label space-y-1" style={{ color }}>
        <span>Sättigung: {saturate.toFixed(1)}</span>
        <input
          type="range" min={1} max={2} step={0.1} value={saturate}
          onChange={e => setSaturate(Number(e.target.value))}
          onDoubleClick={() => setSaturate(defaults.saturate)}
          className="w-full"
        />
      </label>
    </>
  );
}

/**
 * Live-Test-Panel — VOLL kontrolliert vom Elternteil (`DesignSystemPreviewPage`),
 * kein eigener State mehr. Panel, "Glas auf Glas" (gestapeltes Panel), Sheet
 * und Dialog teilen sich jetzt EIN gemeinsames Rezept (Transparenz/Blur/
 * Sättigung/Textfarbe) — "Panels auf Panels sind nur gestapelte Panels mit
 * demselben Style", daher keine separaten Werte fürs innere Element mehr.
 */
function TestPanel({
  title, mode, alpha, setAlpha, blur, setBlur, saturate, setSaturate,
  textGray, setTextGray, textColor, mutedTextColor,
}: {
  title: string; mode: 'light' | 'dark';
  alpha: number; setAlpha: (v: number) => void;
  blur: number; setBlur: (v: number) => void;
  saturate: number; setSaturate: (v: number) => void;
  textGray: number; setTextGray: (v: number) => void;
  textColor: string; mutedTextColor: string;
}) {
  const borderColor = mode === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.7)';
  const highlightColor = mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.3)';
  const ambientShadow = mode === 'dark' ? '0 8px 26px rgba(0,0,0,0.32)' : '0 8px 26px rgba(30,40,80,0.1)';
  const panelBackdrop = backdropFilterValue(blur, saturate);
  const panelStyle: React.CSSProperties = {
    background: `rgba(255,255,255,${alpha})`,
    backdropFilter: panelBackdrop,
    WebkitBackdropFilter: panelBackdrop,
    border: `1px solid ${borderColor}`,
    boxShadow: `inset 0 0 6px ${highlightColor}, ${ambientShadow}`,
  };

  return (
    <div className="flex-1 min-w-[220px] rounded-[20px] p-4 space-y-3" style={panelStyle}>
      <h3 className="text-role-h2" style={{ color: textColor }}>{title}</h3>
      {/* In Light Mode der Schwarzwert (dunkle Textfarbe), in Dark Mode der
          Weißwert (helle Textfarbe) — zwei unabhängige States im Elternteil,
          derselbe Slider zeigt je nach Modus den passenden. */}
      <label className="block text-role-label space-y-1" style={{ color: mutedTextColor }}>
        <span>Textfarbe ({mode === 'dark' ? 'Weißwert' : 'Schwarzwert'}): {textGray}</span>
        <input
          type="range" min={0} max={255} step={1} value={textGray}
          onChange={e => setTextGray(Number(e.target.value))}
          onDoubleClick={() => setTextGray(mode === 'dark' ? DEFAULT_GLASS_THEME.textColor.dark : DEFAULT_GLASS_THEME.textColor.light)}
          className="w-full"
        />
      </label>
      <GlassSliders
        alpha={alpha} setAlpha={setAlpha}
        blur={blur} setBlur={setBlur}
        saturate={saturate} setSaturate={setSaturate}
        color={mutedTextColor}
      />
      {/* "Glas auf Glas" = exakt dasselbe Panel-Rezept noch einmal gestapelt
          — keine eigenen Slider mehr, da Panel-auf-Panel per Definition
          denselben Style wie das äußere Panel teilt. */}
      <div className="rounded-[14px] p-3" style={panelStyle}>
        <p className="text-role-label" style={{ color: textColor }}>Glas auf Glas (gleicher Style)</p>
      </div>
    </div>
  );
}

/**
 * Interne, nicht verlinkte Katalogseite für das Liquid-Glass-Design-System —
 * zeigt alle zentralen `components/ui/*`-Bausteine in ihren wichtigsten
 * Varianten/Zuständen nebeneinander, mit lokalem Light/Dark-Umschalter
 * (unabhängig vom echten App-Theme aus `next-themes` — nur für diese Seite).
 * Keine echten Daten/Firestore-Calls, nur statische Beispielwerte.
 */
/** Kartenraster-Hintergrund — simuliert den echten Fall auf der Suche-Seite
 *  (`app/(app)/collection/page.tsx`), wo Panels über einem dichten Grid aus
 *  Karten-Thumbnails schweben statt über einem einzelnen Foto. Mehrere echte
 *  Kartennummern desselben Sets (swsh2, alle über pokemontcg.io verifiziert
 *  erreichbar), damit Motiv/Farbe pro Kachel variieren statt eines
 *  wiederholten Einzelbilds. */
const CARD_GRID_NUMBERS = [1, 5, 10, 15, 25, 30, 40, 50, 60, 70, 80, 90, 3, 12, 22, 35, 45, 55, 65, 75];
const CARD_GRID_URLS = CARD_GRID_NUMBERS.map(n => `https://images.pokemontcg.io/swsh2/${n}_hires.png`);

/** Eine echte Beispielkarte (dasselbe Set wie oben, per pokemontcg.io
 *  verifiziert erreichbar) für die "Karte (vorhanden/fehlend)"-Sektion — nur
 *  die von `CardTile` tatsächlich gelesenen Felder sind befüllt, Rest per
 *  `as`-Cast, da diese Seite keine echten Firestore-/Katalog-Daten lädt. */
const SAMPLE_CARD = {
  id: 'swsh2-1', name: 'Mimigma', number: '1', imgSmall: 'https://images.pokemontcg.io/swsh2/1.png',
} as CardInfo;
const SAMPLE_OWNED_CARD = { quantity: 2, needsReview: false } as CardDoc;
const SAMPLE_OWNED_CARD_REVIEW = { quantity: 1, needsReview: true } as CardDoc;

export default function DesignSystemPreviewPage() {
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const [bg, setBg] = useState<'gradient' | 'cards'>('gradient');
  // `apply()` (im Observer-Effect unten) muss immer den AKTUELLEN Modus
  // sehen, auch wenn dieser Effect (bewusst `[]`-deps, siehe dort) nie neu
  // aufgebaut wird — ein Ref statt der State-Variable direkt, da Closures in
  // einem einmalig gemounteten Effect sonst den Stand vom Mount-Zeitpunkt
  // einfrieren würden.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Wendet den gewählten Modus SOFORT bei jeder Änderung an — unabhängig vom
  // Observer-Effect unten, kein Warten auf dessen (ohnehin nie neu
  // laufenden) Setup nötig.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', mode === 'dark');
    root.classList.toggle('light', mode === 'light');
  }, [mode]);

  // `next-themes` (Root-Layout, `defaultTheme="system"`) setzt auf JEDEM
  // Screen ebenfalls `.dark`/`.light` auf `<html>` — und tut das in einem
  // EIGENEN Effect, dessen Reihenfolge relativ zu diesem hier nicht
  // garantiert ist. Ohne Gegenmaßnahme gewinnt mal next-themes (überschreibt
  // die hier gewählte Vorschau-Ansicht sofort wieder mit dem echten System-
  // Theme), mal diese Seite. Ein `MutationObserver` erzwingt hier dauerhaft
  // die Auswahl DIESER Seite, solange sie gemountet ist: jede fremde
  // Class-Änderung an `<html>` wird sofort wieder überschrieben.
  //
  // WICHTIG (Bugfix): dieser Effect läuft bewusst nur EINMAL (`[]`-deps),
  // NICHT bei jedem `mode`-Wechsel — vorher hing er an `[mode]`, wodurch bei
  // JEDEM Toggle der alte Observer disconnected und ein neuer aufgebaut
  // wurde. Das Cleanup restaurierte dabei `hadDark`/`hadLight`, die aber nur
  // den (durch die vorherige Cleanup bereits neutralisierten) Zwischenstand
  // erfassten — in Kombination mit noch ausstehenden, bereits vom alten
  // Observer aufgezeichneten Mutationsereignissen (die auch nach
  // `disconnect()` noch als Microtask feuern) konnte das dazu führen, dass
  // ausgerechnet der Wechsel zurück zu "Light" wieder verworfen wurde. Mit
  // EINEM dauerhaften Observer (liest `modeRef.current`) gibt es kein
  // Teardown/Wiederaufbau mehr, das mit einer solchen Race kollidieren kann.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    const hadLight = root.classList.contains('light');
    // `.light` zusätzlich zu `.dark` gesetzt (nie nur "kein .dark") —
    // `app/globals.css`s System-Fallback (`@media (prefers-color-scheme:
    // dark) { :root:not(.light) {...} }`) greift sonst weiterhin, auch wenn
    // `.dark` fehlt.
    const apply = () => {
      root.classList.toggle('dark', modeRef.current === 'dark');
      root.classList.toggle('light', modeRef.current === 'light');
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => {
      observer.disconnect();
      root.classList.toggle('dark', hadDark);
      root.classList.toggle('light', hadLight);
    };
  }, []);

  // ENTWURF/SPEICHERN-MODELL: Regler auf dieser Seite schreiben NICHT mehr
  // direkt in die geteilten Theme-Stores (`glass-theme.ts`/`card-theme.ts`)
  // — sie ändern nur einen lokalen ENTWURF (`draftGlassTheme`/
  // `draftCardTheme`, unten initialisiert aus dem zuletzt gespeicherten
  // Stand). Erst der "Speichern"-Button im Header committet den Entwurf in
  // die echten Stores (→ localStorage + sofort sichtbar für jeden echten
  // `Button`/`Card`/`.glass`-Panel app-weit). "Zurücksetzen" verwirft den
  // Entwurf wieder auf den zuletzt gespeicherten Stand — NICHT auf die
  // Werkseinstellungen (die bleiben über die Doppelklick-Resets an den
  // einzelnen Reglern erreichbar, unverändert).
  const [draftGlassTheme, setDraftGlassTheme] = useState<GlassTheme>(() => getGlassTheme());
  const [draftCardTheme, setDraftCardTheme] = useState<CardVisualTheme>(() => getCardVisualTheme());
  const [openVariant, setOpenVariant] = useState<ButtonVariant | null>(null);

  // Der `useState(() => getGlassTheme())`-Initializer oben läuft VOR der
  // Hydration (`GlassThemeHydrator` liest `localStorage` erst in einem
  // `useEffect` im Root-Layout, siehe `components/GlassThemeHydrator.tsx`)
  // — ohne diesen Sync würde der Entwurf hier kurz nach einem harten Reload
  // die eingebauten Werkseinstellungen zeigen, obwohl bereits ein
  // gespeicherter Stand in `localStorage` liegt (den Button/Card selbst,
  // über ihre reaktiven Hooks, schon korrekt anzeigen). Läuft einmalig nach
  // dem Mount — React committet Effects in Baumreihenfolge, der Hydrator
  // steht im Layout VOR `{children}` und hat also garantiert schon
  // hydriert, bevor dieser Effect feuert.
  useEffect(() => {
    setDraftGlassTheme(getGlassTheme());
    setDraftCardTheme(getCardVisualTheme());
  }, []);

  // `.glass-swipe-solid` ist eine reine CSS-Klasse (kein inline berechneter
  // Style wie bei Switch/ButtonGroup-Demos oben) — sie liest die CSS-Variable
  // direkt von `:root`. Ohne diesen Effect würde der Entwurf hier NIE sichtbar
  // (nur nach "Speichern"): dieser Effect spiegelt den Entwurf sofort live auf
  // `:root`, unabhängig vom persistierten Stand — "Speichern" übernimmt ihn
  // danach unverändert dauerhaft (über `setGlassTheme`, das dieselbe Funktion
  // mit dem dann gespeicherten Wert erneut aufruft).
  useEffect(() => {
    document.documentElement.style.setProperty('--swipe-solid-bg-light', resolveSwipeSolidColor(draftGlassTheme.swipeSolid.light));
    document.documentElement.style.setProperty('--swipe-solid-bg-dark', resolveSwipeSolidColor(draftGlassTheme.swipeSolid.dark));
  }, [draftGlassTheme.swipeSolid]);

  const handleSaveAll = () => {
    setGlassTheme(draftGlassTheme);
    setCardVisualTheme(draftCardTheme);
  };
  const handleResetAll = () => {
    setDraftGlassTheme(getGlassTheme());
    setDraftCardTheme(getCardVisualTheme());
  };

  // `secondary` ist jetzt genauso Teil des geteilten Themes wie primary/scan
  // — keine Sonderbehandlung mehr nötig (vorher: eigener, nie gespeicherter
  // lokaler State, siehe Nutzer-Hinweis "ich sehe immer wieder die alten
  // Einstellungen zum secondary Button").
  const getOverride = (variant: ButtonVariant): GlassOverride => draftGlassTheme[variant];
  const getOverrideDefaults = (variant: ButtonVariant): GlassOverride => DEFAULT_GLASS_THEME[variant];
  const updateOverride = (variant: ButtonVariant, patch: Partial<GlassOverride>) => {
    setDraftGlassTheme(prev => ({ ...prev, [variant]: { ...prev[variant], ...patch } }));
  };
  // Da Änderungen jetzt erst per "Speichern" wirksam werden, müssen die
  // Demo-Buttons (auch primary/scan/secondary) ihren Look aus dem ENTWURF
  // berechnen — `Button` selbst liest weiterhin den zuletzt GESPEICHERTEN
  // Stand.
  const demoStyleFor = (variant: ButtonVariant, colorOverride?: string): React.CSSProperties => {
    if (variant === 'secondary') {
      const secondary = draftGlassTheme.secondary;
      const style = buttonOverrideStyle('secondary', secondary, secondaryHex(secondary.colorMode));
      // "Keine" lässt nur die FÜLLUNG weg — Blur/Sättigung (Verzerrungseffekt),
      // Rahmen und Schatten/Glanz brauchen keine eigene Füllfarbe und bleiben
      // wirksam (siehe `secondaryGlassStyle()` in lib/ui/tinted-glass.ts,
      // dasselbe Prinzip). `color` fällt auf die Klassenfarbe zurück (kein
      // Text zum Kontrastieren gegen eine Füllung nötig).
      if (secondary.colorMode === 'none') {
        return { ...style, background: 'transparent', color: undefined };
      }
      // Voller Schwarz/Weiß-Kontrast (was `buttonOverrideStyle` per
      // `readableTextColor` liefert) wirkt zu fett/präsent — `textOpacity`
      // dämpft das, analog zu `secondaryGlassStyle()` (tinted-glass.ts).
      // `readableTextColorBlended` statt `readableTextColor`: kontrastiert
      // gegen die tatsächlich sichtbare (mit Deckkraft gemischte) Fläche,
      // nicht die volldeckende Rohfarbe — sonst z.B. bei Grau+niedriger
      // Deckkraft im Light Mode fälschlich Weiß auf heller Fläche.
      return { ...style, color: hexToRgba(readableTextColorBlended(secondaryHex(secondary.colorMode), secondary.alpha), secondary.textOpacity) };
    }
    return buttonOverrideStyle(variant, getOverride(variant), colorOverride);
  };

  // Switch/Checkbox teilen sich EIN Rezept (`tintedGlassStyle(accentColor,
  // {flat:true})`) und ein Theme-Feld (`draftGlassTheme.toggle`).
  const toggleDemoStyle = (accentColor: string): React.CSSProperties =>
    tintedGlassStyle(accentColor, {
      flat: true,
      theme: draftGlassTheme.toggle,
      insetHighlight: draftGlassTheme.toggle.insetHighlight,
    });

  // ButtonGroups Text-Segment hat ein EIGENES, von Switch/Checkbox UND von
  // der iconOnly-Variante unabhängiges Theme-Feld (`draftGlassTheme.
  // buttonGroupText`, auf Nutzerwunsch getrennt — alle drei "Toggle-artigen"
  // Komponenten sollen unabhängig voneinander gestylt werden können).
  const buttonGroupTextDemoStyle = (accentColor: string): React.CSSProperties =>
    tintedGlassStyle(accentColor, {
      theme: draftGlassTheme.buttonGroupText,
      insetHighlight: draftGlassTheme.buttonGroupText.insetHighlight,
      shadowOpacity: draftGlassTheme.buttonGroupText.shadowOpacity,
      shadowOffsetY: draftGlassTheme.buttonGroupText.shadowOffsetY,
      shadowBlur: draftGlassTheme.buttonGroupText.shadowBlur,
    });

  // ButtonGroups iconOnly-Variante — eigenes Theme (`buttonGroupIcon`).
  const buttonGroupIconDemoStyle = (accentColor: string): React.CSSProperties =>
    tintedGlassStyle(accentColor, {
      theme: draftGlassTheme.buttonGroupIcon,
      insetHighlight: draftGlassTheme.buttonGroupIcon.insetHighlight,
      shadowOpacity: draftGlassTheme.buttonGroupIcon.shadowOpacity,
      shadowOffsetY: draftGlassTheme.buttonGroupIcon.shadowOffsetY,
      shadowBlur: draftGlassTheme.buttonGroupIcon.shadowBlur,
    });

  // Der Track liest seinen Hintergrund in `button-group.tsx` sonst immer aus
  // dem zuletzt GESPEICHERTEN Theme, nicht aus dem Entwurf — ohne diesen
  // Override hätten die "Hintergrund-Deckkraft (inaktiv)"-Regler unten keine
  // sichtbare Wirkung auf dieser Testseite (genau der gemeldete Bug).
  const buttonGroupTextTrackStyle: React.CSSProperties = {
    background: `rgba(255,255,255,${draftGlassTheme.buttonGroupText.trackAlpha})`,
  };
  const buttonGroupIconTrackStyle: React.CSSProperties = {
    background: hexToRgba(draftGlassTheme.buttonGroupIcon.trackColor, draftGlassTheme.buttonGroupIcon.trackAlpha),
  };

  // "Karte (vorhanden/fehlend)"-Sektion: Regler ändern `draftCardTheme`
  // (s.o.) — erst "Speichern" committet in `card-theme.ts`.
  const [cardSize, setCardSize] = useState<CardSize>('sm');
  const missingStyle = draftCardTheme.missingStyle;
  const setMissingStyle = (updater: MissingCardStyle | ((prev: MissingCardStyle) => MissingCardStyle)) => {
    setDraftCardTheme(prev => ({ ...prev, missingStyle: typeof updater === 'function' ? updater(prev.missingStyle) : updater }));
  };
  const badgeLayout = draftCardTheme.badgeLayout[cardSize];
  const cornerRadius = draftCardTheme.cornerRadius[cardSize];
  const setCornerRadius = (v: number) => setDraftCardTheme(prev => ({ ...prev, cornerRadius: { ...prev.cornerRadius, [cardSize]: v } }));
  const [showReviewBadge, setShowReviewBadge] = useState(false);
  const updateBadge = <K extends keyof CardTileBadgeLayout>(badge: K, patch: Partial<CardTileBadgeLayout[K]>) => {
    setDraftCardTheme(prev => ({
      ...prev,
      badgeLayout: { ...prev.badgeLayout, [cardSize]: { ...prev.badgeLayout[cardSize], [badge]: { ...prev.badgeLayout[cardSize][badge], ...patch } } },
    }));
  };
  // Größe wechseln — Ecken-Radius/Badge-Position kommen jetzt automatisch
  // aus `draftCardTheme` für die neu gewählte Größe (kein Reset nötig, jede
  // Größe hat ihren eigenen Eintrag im Entwurf).
  const changeCardSize = (s: CardSize) => setCardSize(s);

  // "CardBadge"-Sektion: eigenständige Demo unabhängig von der Karte oben —
  // zeigt das Badge-Primitiv (immer rund) mit seinen Optionen (Farbe/Inhalt/
  // Hintergrund an-aus, insbesondere fürs Wunschlisten-Herz relevant).
  const [badgeColor, setBadgeColor] = useState('#35d15a');
  const [badgeContent, setBadgeContent] = useState<'icon' | 'number' | 'letter' | 'heart'>('number');
  const [badgeBackground, setBadgeBackground] = useState(true);

  // "OwnedCopyRow"-Sektion: rein lokale Demo-Kopien (keine Firestore-Calls,
  // kein echtes Löschen) — Swipe-Physik hier gefahrlos iterierbar, ohne bei
  // jedem Testlauf echte Sammlungsdaten zu riskieren (siehe Vorfall im Chat:
  // Testen der Geste direkt im Kartendetail hat zweimal echte Karten gelöscht).
  const DEMO_BINDER: BinderDoc = {
    id: 'demo-binder', name: 'Fatale Flammen', icon: 'star', sortOrder: 0, cardIds: [], wishlistCardIds: [],
    createdAt: null as unknown as BinderDoc['createdAt'],
  };
  const DEMO_OTHER_BINDER: BinderDoc = {
    id: 'demo-binder-2', name: 'Wunschzettel-Doppelte', icon: 'heart', sortOrder: 1, cardIds: [], wishlistCardIds: [],
    createdAt: null as unknown as BinderDoc['createdAt'],
  };
  const makeDemoCopy = (id: string, overrides: Partial<CardDoc>): CardDoc => ({
    id, tcgId: 'demo', name: 'Giflor', setId: 'me2', setName: 'Fatale Flammen', number: '003',
    variant: 'holo', condition: 'NM', language: 'de', isFoil: false, isFirstEd: false, quantity: 1,
    addedAt: null as unknown as CardDoc['addedAt'], updatedAt: null as unknown as CardDoc['updatedAt'],
    ...overrides,
  });
  const [demoCopies, setDemoCopies] = useState<CardDoc[]>([
    makeDemoCopy('demo-1', { needsReview: true }),
    makeDemoCopy('demo-2', { condition: 'LP', language: 'en', needsReview: false }),
    makeDemoCopy('demo-3', { condition: 'HP', language: 'jp', quantity: 3 }),
  ]);
  const [demoLog, setDemoLog] = useState<string>('—');
  // Eigener State für die zwei CustomSelect-Vergleichszeilen weiter unten —
  // ohne das würde "Löschen" (Swipe) nichts sichtbar bewirken, da `onDelete`
  // sonst ein reines No-op ohne zugehörige Liste wäre.
  const [showPrimaryDemo, setShowPrimaryDemo] = useState(true);
  const [showSecondaryDemo, setShowSecondaryDemo] = useState(true);
  // Ausgewählte Sammlung je Vergleichszeile — ohne das würde `onMoveToBinder`
  // ein reines No-op sein und die Auswahl im Dropdown liefe optisch ins Leere
  // (gleicher Fehler wie zuvor bei `onDelete`).
  const [primaryDemoBinderId, setPrimaryDemoBinderId] = useState<string | null>(DEMO_BINDER.id);
  const [secondaryDemoBinderId, setSecondaryDemoBinderId] = useState<string | null>(DEMO_BINDER.id);

  const [chipA, setChipA] = useState(true);
  const [chipB, setChipB] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [selectVal, setSelectVal] = useState('b');
  const [customSelectVal, setCustomSelectVal] = useState<'a' | 'b' | 'c'>('b');
  const [inputVal, setInputVal] = useState('');
  const [searchVal, setSearchVal] = useState('Knapfel');
  const [groupVal, setGroupVal] = useState('all');
  const [groupIconVal, setGroupIconVal] = useState('a');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // EIN gemeinsames Glas-Rezept für Panel, "Glas auf Glas" (gestapeltes
  // Panel), Sheet UND Dialog — "Panels auf Panels sind nur gestapelte Panels
  // mit demselben Style", und Sheets/Dialoge sollen laut Nutzer ebenfalls
  // exakt dieselben Werte teilen statt eigener. Kommt aus dem ENTWURF
  // (`draftGlassTheme.panel`) — erst "Speichern" macht die Werte für die
  // echte `.glass`-Klasse app-weit wirksam (Sheet/Dialog bleiben weiterhin
  // nur simuliert, siehe `glassOverrideStyle` unten).
  const glassAlpha = draftGlassTheme.panel.alpha;
  const glassBlur = draftGlassTheme.panel.blur;
  const glassSaturate = draftGlassTheme.panel.saturate;
  const setGlassAlpha = (v: number) => setDraftGlassTheme(prev => ({ ...prev, panel: { ...prev.panel, alpha: v } }));
  const setGlassBlur = (v: number) => setDraftGlassTheme(prev => ({ ...prev, panel: { ...prev.panel, blur: v } }));
  const setGlassSaturate = (v: number) => setDraftGlassTheme(prev => ({ ...prev, panel: { ...prev.panel, saturate: v } }));
  // Textfarbe: Schwarzwert in Light, Weißwert in Dark — jetzt Teil des
  // Entwurfs (`draftGlassTheme.textColor`), Moduswechsel überschreibt den
  // jeweils anderen Modus nicht (zwei getrennte Felder).
  const glassTextGray = mode === 'dark' ? draftGlassTheme.textColor.dark : draftGlassTheme.textColor.light;
  const setGlassTextGray = (v: number) => setDraftGlassTheme(prev => ({
    ...prev, textColor: { ...prev.textColor, [mode === 'dark' ? 'dark' : 'light']: v },
  }));
  const glassTextHex = glassTextGray.toString(16).padStart(2, '0');
  const glassTextColor = `#${glassTextHex}${glassTextHex}${glassTextHex}`;
  const glassMutedTextColor = `rgba(${glassTextGray},${glassTextGray},${glassTextGray},0.7)`;
  // Sheet/Dialog nutzen dasselbe Rezept wie das Panel — bewusst auch die
  // gleiche (immer weiße) Basisfarbe statt der echten `.glass-sheet`-Dark-
  // Variante (dort dunkles Navy), damit "gleicher Style" wörtlich stimmt.
  const glassOverrideBackdrop = backdropFilterValue(glassBlur, glassSaturate);
  const glassOverrideStyle: React.CSSProperties = {
    background: `rgba(255,255,255,${glassAlpha})`,
    backdropFilter: glassOverrideBackdrop,
    WebkitBackdropFilter: glassOverrideBackdrop,
  };

  return (
    <div className="min-h-screen px-3 py-4 space-y-4">
      {/* Kartenraster-Hintergrund — liegt über dem Verlauf aus der (app)-Layout-
          `GlassBackground` (z-index -10) aber unter dem normalen Seiteninhalt,
          da `z-index: -5` zwischen beiden liegt. Nur sichtbar bei bg==='cards',
          simuliert den echten Suche-Seiten-Fall (Panels über einem dichten
          Karten-Grid statt einem einzelnen Foto) — `fixed` + `overflow-hidden`,
          deckt nur den Viewport ab (wie zuvor beim Einzelbild), kein Scroll
          des Grids selbst nötig. */}
      {bg === 'cards' && (
        <div className="fixed inset-0 -z-[5] overflow-hidden grid grid-cols-5 gap-1 p-1" aria-hidden="true">
          {CARD_GRID_URLS.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={url} alt="" className="w-full aspect-[63/88] object-cover rounded-md" />
          ))}
        </div>
      )}
      {/* Abdunkel-Scrim im Dark Mode über dem Karten-Grid — unser echter
          `GlassBackground`-Verlauf verdunkelt sich in Dark Mode selbst (dunkle
          Grundfläche + gedämpfte Glows), das Testraster tut das nicht von
          sich aus. Ohne diesen Scrim fällt `.text-glass` (in Dark Mode fest
          Weiß) auf helle Kartenstellen mit zu wenig Kontrast. Nur ein
          Test-Werkzeug-Fix — die echte App zeigt Glas nie über derart
          hellen/bunten Kartenbildern ohne eigene Abdunkelung. */}
      {bg === 'cards' && mode === 'dark' && (
        <div className="fixed inset-0 -z-[4] bg-black/45" aria-hidden="true" />
      )}

      <div className="sticky top-safe z-20 glass rounded-[20px] px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-role-h1 text-glass">Design-System-Vorschau</h1>
        <div className="flex items-center gap-2">
          {/* Speichern committet den aktuellen ENTWURF (Panel/Button/Karte)
              dauerhaft in die geteilten Theme-Stores — ab dann sofort
              app-weit sichtbar. Zurücksetzen verwirft den Entwurf wieder auf
              den zuletzt gespeicherten Stand (nicht auf die
              Werkseinstellungen — die bleiben per Doppelklick an den
              einzelnen Reglern erreichbar). */}
          <Button variant="primary" accentColor="#2f855a" size="sm" icon={<Save size={16} />} aria-label="Speichern" title="Speichern — Entwurf dauerhaft übernehmen" onClick={handleSaveAll} />
          <Button variant="secondary" size="sm" icon={<RotateCcw size={16} />} aria-label="Zurücksetzen" title="Zurücksetzen — auf zuletzt gespeicherten Stand" onClick={handleResetAll} />
          <ButtonGroup
            iconOnly
            value={bg}
            onChange={v => setBg(v as 'gradient' | 'cards')}
            options={[
              { value: 'gradient', label: <Waves size={18} />, ariaLabel: 'Verlauf' },
              { value: 'cards', label: <ImageIcon size={18} />, ariaLabel: 'Kartenraster' },
            ]}
          />
          <ButtonGroup
            iconOnly
            value={mode}
            onChange={v => setMode(v as 'light' | 'dark')}
            options={[
              { value: 'light', label: <Sun size={18} />, ariaLabel: 'Light' },
              { value: 'dark', label: <Moon size={18} />, ariaLabel: 'Dark' },
            ]}
          />
        </div>
      </div>

      {/* Panel (.glass) — explizit benannt, damit Änderungen an der Panel-
          Transparenz/-Optik direkt sichtbar sind, nicht nur implizit als
          Hintergrund jeder anderen Sektion. Jede `<Section>` auf dieser
          Seite IST bereits ein `.glass`-Panel — dies hier ist nur die
          benannte Referenz-Instanz dafür. Panels/Dialoge/Sheets sind bewusst
          NICHT Teil der "alle Elemente"-Regeln (Rundung/Rahmen/Transparenz-
          Vorgaben von Button/ButtonGroup/Chip/Select/Input/Progress/Switch/
          Checkbox) — sie folgen ihrem eigenen, älteren Handoff-Rezept. */}
      {/* Dieselben 3 Werte, die `.glass` app-weit fest nutzt (Transparenz
          0.15, Blur 22px, Sättigung 1.4 — siehe `app/globals.css`), hier als
          Slider zum Entwerfen. Erst "Speichern" im Header macht den Entwurf
          für die echte `.glass`-Klasse/andere Sections auf dieser Seite
          wirksam. `plain`, da `TestPanel` sein eigenes Glas mitbringt — ein
          zusätzlicher äußerer `.glass`-Rahmen wäre Glas auf Glas. */}
      <Section title="Panel (.glass)" plain>
        <p className="text-role-body text-glass">
          Startwerte entsprechen dem zuletzt gespeicherten Stand der echten
          `.glass`-Klasse. Slider ändern nur den Entwurf — "Speichern" im
          Header übernimmt ihn app-weit.
        </p>
        <TestPanel
          title="Panel (.glass)" mode={mode}
          alpha={glassAlpha} setAlpha={setGlassAlpha}
          blur={glassBlur} setBlur={setGlassBlur}
          saturate={glassSaturate} setSaturate={setGlassSaturate}
          textGray={glassTextGray} setTextGray={setGlassTextGray}
          textColor={glassTextColor} mutedTextColor={glassMutedTextColor}
        />
      </Section>

      <Section title="Button">
        <div className="space-y-4">
          <p className="text-role-label text-glass-muted">
            3 Varianten (primary/secondary/scan) × Text/Icon/Text+Icon ×
            aktiviert/deaktiviert × 3 Größen. Zahnrad öffnet einen Settings-
            Dialog pro Variante (Deckkraft/Blur/Sättigung/Verlauf/Glanz/
            Rahmen/Schatten, bei secondary zusätzlich Hintergrundfarbe: Keine/
            Weiß/Grau) — Änderungen sind ein Entwurf und gelten erst app-weit,
            nachdem oben im Header auf "Speichern" getippt wurde.
          </p>
          {BUTTON_VARIANTS.map(variant => (
            <div key={variant} className="space-y-2 pb-3 border-b border-white/10 last:border-0">
              {/* Text, 3 Größen + deaktiviert */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-role-label text-glass-muted w-20 shrink-0">{variant}</span>
                {SIZES.map(size => (
                  <Button key={size} variant={variant} size={size} style={demoStyleFor(variant)}>
                    {size}
                  </Button>
                ))}
                <Button variant={variant} size="md" disabled style={demoStyleFor(variant)}>
                  disabled
                </Button>
                <Button
                  variant="secondary" size="sm" icon={<Settings size={14} />}
                  aria-label={`Einstellungen: ${variant}`} onClick={() => setOpenVariant(variant)}
                />
              </div>
              {/* Nur Icon + Icon-und-Text — dieselbe Variante, keine eigene
                  "icon"-Variante mehr nötig (Icon-only ergibt sich rein
                  daraus, dass kein Text-Kind übergeben wird). */}
              <div className="flex items-center gap-2 flex-wrap pl-[88px]">
                <Button variant={variant} size="md" icon={<Star />} aria-label="Nur Icon" style={demoStyleFor(variant)} />
                <Button variant={variant} size="md" icon={<Star />} style={demoStyleFor(variant)}>
                  Icon + Text
                </Button>
              </div>
            </div>
          ))}
          <p className="text-role-label text-glass-muted">
            Hover (Maus) zeigt Lift, Klick/Press zeigt Squish — kein Shimmer.
          </p>

          {/* "Aufbauend": Löschen/Hinzufügen/Primär sind KEINE eigenen
              Varianten mehr, nur `variant="primary"` mit anderer
              `accentColor` + passendem Icon — genau das Muster, das im
              echten App-Code für Lösch-/Add-Aktionen gebraucht wird. */}
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-white/10">
            <span className="text-role-label text-glass-muted w-20 shrink-0">Farbe</span>
            {/* Echte Hex-Werte statt `var(--action-delete)` — die Glas-
                Rezepte (`primaryGlassStyle` etc.) parsen `accentColor` direkt
                als Hex (`hexToRgb`), eine CSS-Variable würde dort NICHT
                aufgelöst und ergäbe eine unsichtbare/falsche Farbe.
                `style`-Override nötig, solange der Entwurf noch nicht
                gespeichert ist — `Button` selbst liest weiterhin den zuletzt
                GESPEICHERTEN Stand. */}
            <Button variant="primary" accentColor="#c53030" icon={<Trash2 />} style={demoStyleFor('primary', '#c53030')}>Löschen</Button>
            <Button variant="primary" accentColor="#2f855a" icon={<Plus />} style={demoStyleFor('primary', '#2f855a')}>Hinzufügen</Button>
            <Button variant="primary" icon={<Camera />} style={demoStyleFor('primary')}>Primär (Blau)</Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-role-label text-glass-muted w-20 shrink-0">Farbe (Icon)</span>
            <Button variant="primary" accentColor="#c53030" icon={<Trash2 />} aria-label="Löschen" style={demoStyleFor('primary', '#c53030')} />
            <Button variant="primary" accentColor="#2f855a" icon={<Plus />} aria-label="Hinzufügen" style={demoStyleFor('primary', '#2f855a')} />
          </div>

          {/* Kontrast-Test: eine helle accentColor — Text/Icon muss auf
              dunkel umschalten statt bei hart codiertem Weiß zu bleiben. */}
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-white/10">
            <span className="text-role-label text-glass-muted w-20 shrink-0">Kontrast</span>
            <Button variant="primary" accentColor="#f6e05e" style={demoStyleFor('primary', '#f6e05e')}>Helle Farbe</Button>
            <ButtonGroup
              value="a"
              onChange={() => {}}
              accentColor="#f6e05e"
              options={[{ value: 'a', label: 'Aktiv' }, { value: 'b', label: 'Inaktiv' }]}
            />
            <Checkbox checked accentColor="#f6e05e" onChange={() => {}} label="Hell" />
          </div>
        </div>
      </Section>

      {/* Ein gemeinsamer Dialog für alle 3 Varianten (`openVariant` wählt,
          welche gerade bearbeitet wird) statt 3 einzelner Dialog-Instanzen.
          `style={glassOverrideStyle}` — derselbe Glas-Style wie Panel/Sheet/
          Dialog-Demo, aus Konsistenzgründen (kein eigenes drittes Rezept). */}
      <Dialog
        open={openVariant !== null}
        onClose={() => setOpenVariant(null)}
        title={openVariant ? `Einstellungen: ${openVariant}` : ''}
        style={glassOverrideStyle}
      >
        {openVariant && (
          <div className="space-y-3">
            <div className="flex justify-center">
              <Button variant={openVariant} size="md" style={demoStyleFor(openVariant)}>
                Vorschau
              </Button>
            </div>
            {/* Nur bei secondary: Hintergrundfarbe zur Wahl (keine/weiß/
                schwarz/grau) — secondary hat im echten Code keine
                Akzentfarbe, daher macht hier eine feste Farbwahl statt eines
                Verlaufs mehr Sinn. */}
            {openVariant === 'secondary' && (
              <div className="space-y-1">
                <span className="text-role-label text-glass-muted block">Hintergrundfarbe</span>
                <ButtonGroup
                  value={draftGlassTheme.secondary.colorMode}
                  onChange={v => setDraftGlassTheme(prev => ({ ...prev, secondary: { ...prev.secondary, colorMode: v as SecondaryOverride['colorMode'] } }))}
                  options={[
                    { value: 'none', label: 'Keine' },
                    { value: 'white', label: 'Weiß' },
                    { value: 'black', label: 'Schwarz' },
                    { value: 'gray', label: 'Grau' },
                  ]}
                />
              </div>
            )}
            {/* Nur bei secondary + einer echten Füllfarbe sinnvoll — bei
                "Keine" ist die Textfarbe klassenbasiert (`text-foreground`),
                `textOpacity` greift nur im `secondaryGlassStyle()`-Zweig mit
                Hintergrundfarbe. Voller Schwarz/Weiß-Kontrast wirkte zu
                fett/präsent für einen zurückhaltend gedachten Button. */}
            {openVariant === 'secondary' && draftGlassTheme.secondary.colorMode !== 'none' && (
              <label className="block text-role-label text-glass-muted space-y-1">
                <span>Text-Deckkraft: {draftGlassTheme.secondary.textOpacity.toFixed(2)}</span>
                <input
                  type="range" min={0.3} max={1} step={0.01} value={draftGlassTheme.secondary.textOpacity}
                  onChange={e => setDraftGlassTheme(prev => ({ ...prev, secondary: { ...prev.secondary, textOpacity: Number(e.target.value) } }))}
                  onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, secondary: { ...prev.secondary, textOpacity: DEFAULT_GLASS_THEME.secondary.textOpacity } }))}
                  className="w-full"
                />
              </label>
            )}
            {/* Bei secondary + "Keine" hat der Button keine Füllfläche —
                `secondaryGlassStyle()` (lib/ui/tinted-glass.ts) setzt nur
                `background: transparent`. Deckkraft (Alpha DER Füllung) und
                Verlauf (definiert ja gerade die Füllung) hätten dann keine
                Wirkung und werden ausgeblendet — Blur/Sättigung (Verzerrungs-
                effekt auf den Hintergrund), Glanz/Rahmen/Schatten brauchen
                dagegen keine eigene Füllfarbe und bleiben immer nutzbar. */}
            {(() => {
              const isSecondaryNone = openVariant === 'secondary' && draftGlassTheme.secondary.colorMode === 'none';
              return (
                <>
                  <GlassSliders
                    alpha={getOverride(openVariant).alpha}
                    setAlpha={v => updateOverride(openVariant, { alpha: v })}
                    blur={getOverride(openVariant).blur}
                    setBlur={v => updateOverride(openVariant, { blur: v })}
                    saturate={getOverride(openVariant).saturate}
                    setSaturate={v => updateOverride(openVariant, { saturate: v })}
                    color="var(--foreground)"
                    defaults={getOverrideDefaults(openVariant)}
                    hideAlpha={isSecondaryNone}
                  />
                  {/* Verlauf, Glanz, Rahmen + Schatten — nicht Teil von
                      `GlassSliders` (die Panels/Sheets brauchen das nicht, nur
                      Buttons). Doppelklick auf jeden Slider setzt ihn auf den
                      echten Rezept-Default zurück. */}
                  {isSecondaryNone ? (
                    <p className="text-role-label text-glass-muted">
                      Bei "Keine" hat der Button keine Füllfläche — Deckkraft
                      und Verlauf greifen daher nicht (nichts zum Einfärben
                      da). Blur/Sättigung/Glanz/Rahmen/Schatten wirken
                      trotzdem weiter.
                    </p>
                  ) : (
                    <>
                      <Checkbox
                        checked={getOverride(openVariant).gradient}
                        onChange={v => updateOverride(openVariant, { gradient: v })}
                        label="Verlauf (statt flacher Tönung)"
                      />
                      {getOverride(openVariant).gradient && (
                        <>
                          <label className="block text-role-label text-glass-muted space-y-1">
                            <span>Verlauf hell: {getOverride(openVariant).gradientLighten.toFixed(2)}</span>
                            <input
                              type="range" min={0} max={0.5} step={0.01} value={getOverride(openVariant).gradientLighten}
                              onChange={e => updateOverride(openVariant, { gradientLighten: Number(e.target.value) })}
                              onDoubleClick={() => updateOverride(openVariant, { gradientLighten: getOverrideDefaults(openVariant).gradientLighten })}
                              className="w-full"
                            />
                          </label>
                          <label className="block text-role-label text-glass-muted space-y-1">
                            <span>Verlauf dunkel: {getOverride(openVariant).gradientDarken.toFixed(2)}</span>
                            <input
                              type="range" min={0} max={0.5} step={0.01} value={getOverride(openVariant).gradientDarken}
                              onChange={e => updateOverride(openVariant, { gradientDarken: Number(e.target.value) })}
                              onDoubleClick={() => updateOverride(openVariant, { gradientDarken: getOverrideDefaults(openVariant).gradientDarken })}
                              className="w-full"
                            />
                          </label>
                        </>
                      )}
                    </>
                  )}
                  <label className="block text-role-label text-glass-muted space-y-1">
                    <span>Innerer Glanz: {getOverride(openVariant).insetHighlight.toFixed(2)}</span>
                    <input
                      type="range" min={0} max={1} step={0.01} value={getOverride(openVariant).insetHighlight}
                      onChange={e => updateOverride(openVariant, { insetHighlight: Number(e.target.value) })}
                      onDoubleClick={() => updateOverride(openVariant, { insetHighlight: getOverrideDefaults(openVariant).insetHighlight })}
                      className="w-full"
                    />
                  </label>
                  <label className="block text-role-label text-glass-muted space-y-1">
                    <span>Rahmenbreite: {getOverride(openVariant).borderWidth}px</span>
                    <input
                      type="range" min={0} max={3} step={0.5} value={getOverride(openVariant).borderWidth}
                      onChange={e => updateOverride(openVariant, { borderWidth: Number(e.target.value) })}
                      onDoubleClick={() => updateOverride(openVariant, { borderWidth: getOverrideDefaults(openVariant).borderWidth })}
                      className="w-full"
                    />
                  </label>
                  <label className="block text-role-label text-glass-muted space-y-1">
                    <span>Rahmen-Deckkraft: {getOverride(openVariant).borderOpacity.toFixed(2)}</span>
                    <input
                      type="range" min={0} max={1} step={0.01} value={getOverride(openVariant).borderOpacity}
                      onChange={e => updateOverride(openVariant, { borderOpacity: Number(e.target.value) })}
                      onDoubleClick={() => updateOverride(openVariant, { borderOpacity: getOverrideDefaults(openVariant).borderOpacity })}
                      className="w-full"
                    />
                  </label>
                  <label className="block text-role-label text-glass-muted space-y-1">
                    <span>Schatten-Deckkraft: {getOverride(openVariant).shadowOpacity.toFixed(2)}</span>
                    <input
                      type="range" min={0} max={1} step={0.01} value={getOverride(openVariant).shadowOpacity}
                      onChange={e => updateOverride(openVariant, { shadowOpacity: Number(e.target.value) })}
                      onDoubleClick={() => updateOverride(openVariant, { shadowOpacity: getOverrideDefaults(openVariant).shadowOpacity })}
                      className="w-full"
                    />
                  </label>
                  <label className="block text-role-label text-glass-muted space-y-1">
                    <span>Schatten Y-Versatz: {getOverride(openVariant).shadowOffsetY}px</span>
                    <input
                      type="range" min={0} max={20} step={1} value={getOverride(openVariant).shadowOffsetY}
                      onChange={e => updateOverride(openVariant, { shadowOffsetY: Number(e.target.value) })}
                      onDoubleClick={() => updateOverride(openVariant, { shadowOffsetY: getOverrideDefaults(openVariant).shadowOffsetY })}
                      className="w-full"
                    />
                  </label>
                  <label className="block text-role-label text-glass-muted space-y-1">
                    <span>Schatten-Blur: {getOverride(openVariant).shadowBlur}px</span>
                    <input
                      type="range" min={0} max={40} step={1} value={getOverride(openVariant).shadowBlur}
                      onChange={e => updateOverride(openVariant, { shadowBlur: Number(e.target.value) })}
                      onDoubleClick={() => updateOverride(openVariant, { shadowBlur: getOverrideDefaults(openVariant).shadowBlur })}
                      className="w-full"
                    />
                  </label>
                </>
              );
            })()}
          </div>
        )}
      </Dialog>

      {/* Karte (vorhanden/fehlend) — echte `Card`-Instanzen (nicht
          nachgebaut), damit die Regler 1:1 zeigen, was app-weit (Suche/
          Sammlung/Set-Detail) tatsächlich passiert. `missingStyle`/
          `badgeLayout`/`cornerRadius` kommen aus dem lokalen ENTWURF
          (`draftCardTheme`, s.o.) — erst "Speichern" im Header committet ihn
          in `lib/ui/card-theme.ts` (→ app-weit für jede echte `Card`/
          `CardTile`-Instanz sichtbar). Drei Größen (sm=Suche/Liste,
          md=Zwischengröße für spätere Einsätze z.B. Scanmode, lg=Kartendetail)
          — noch nirgends außer `sm` (via `CardTile`) real ausgerollt, `md`/`lg`
          sind vorbereitet + hier zur Abstimmung sichtbar. */}
      <Section title="Karte (vorhanden / fehlend)">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-role-label text-glass-muted">Größe</span>
          <ButtonGroup
            value={cardSize}
            onChange={v => changeCardSize(v as CardSize)}
            options={[
              { value: 'sm', label: 'sm (Suche/Liste)' },
              { value: 'md', label: 'md' },
              { value: 'lg', label: 'lg (Kartendetail)' },
            ]}
          />
        </div>
        <div className="flex items-start gap-6 flex-wrap">
          <div style={{ width: CARD_SIZE_PRESETS[cardSize].badgeSize * 5 }} className="space-y-1.5">
            <p className="text-role-label text-glass-muted text-center">Vorhanden</p>
            <Card
              card={SAMPLE_CARD}
              size={cardSize}
              ownedCards={[showReviewBadge ? SAMPLE_OWNED_CARD_REVIEW : SAMPLE_OWNED_CARD]}
              missingStyle={missingStyle}
              badgeLayout={badgeLayout}
              cornerRadius={cornerRadius}
              sublabel={SAMPLE_CARD.number}
            />
          </div>
          <div style={{ width: CARD_SIZE_PRESETS[cardSize].badgeSize * 5 }} className="space-y-1.5">
            <p className="text-role-label text-glass-muted text-center">Fehlend</p>
            <Card
              card={SAMPLE_CARD}
              size={cardSize}
              ownedCards={[]}
              missingStyle={missingStyle}
              badgeLayout={badgeLayout}
              cornerRadius={cornerRadius}
              sublabel={SAMPLE_CARD.number}
            />
          </div>

          <div className="flex-1 min-w-[220px] space-y-3">
            <Checkbox checked={showReviewBadge} onChange={setShowReviewBadge} label="Prüfen-Badge zeigen (vorhanden)" />

            <label className="block text-role-label text-glass-muted space-y-1">
              <span>Eckenrundung: {cornerRadius}px</span>
              <input
                type="range" min={0} max={28} step={1} value={cornerRadius}
                onChange={e => setCornerRadius(Number(e.target.value))}
                onDoubleClick={() => setCornerRadius(DEFAULT_CARD_VISUAL_THEME.cornerRadius[cardSize])}
                className="w-full"
              />
            </label>

            <p className="text-role-label text-glass-muted pt-1 border-t border-white/10">
              "Fehlend"-Look
            </p>
            <label className="block text-role-label text-glass-muted space-y-1">
              <span>Effekt</span>
              {/* `Select` statt `ButtonGroup` — 6 Optionen mit teils langen
                  Labels würden als Segmented Control auf schmalen Viewports
                  überlaufen. */}
              <Select
                value={missingStyle.effect}
                onChange={v => setMissingStyle(prev => ({ ...prev, effect: v as MissingCardStyle['effect'] }))}
                options={MISSING_CARD_EFFECTS}
              />
            </label>
            <label className="block text-role-label text-glass-muted space-y-1">
              {/* "Deckkraft" statt "Transparenz" — 1 = voll sichtbar, 0 =
                  komplett unsichtbar (siehe GlassSliders-Kommentar oben für
                  denselben Namenskonflikt). */}
              <span>Deckkraft: {missingStyle.opacity.toFixed(2)}</span>
              <input
                type="range" min={0} max={1} step={0.01} value={missingStyle.opacity}
                onChange={e => setMissingStyle(prev => ({ ...prev, opacity: Number(e.target.value) }))}
                onDoubleClick={() => setMissingStyle(prev => ({ ...prev, opacity: DEFAULT_MISSING_CARD_STYLE.opacity }))}
                className="w-full"
              />
            </label>
            <label className="block text-role-label text-glass-muted space-y-1">
              <span>Blur: {missingStyle.blur}px</span>
              <input
                type="range" min={0} max={10} step={0.5} value={missingStyle.blur}
                onChange={e => setMissingStyle(prev => ({ ...prev, blur: Number(e.target.value) }))}
                onDoubleClick={() => setMissingStyle(prev => ({ ...prev, blur: DEFAULT_MISSING_CARD_STYLE.blur }))}
                className="w-full"
              />
            </label>
            <label className="block text-role-label text-glass-muted space-y-1">
              <span>Sättigung: {missingStyle.saturate.toFixed(2)}</span>
              <input
                type="range" min={0} max={1.5} step={0.05} value={missingStyle.saturate}
                onChange={e => setMissingStyle(prev => ({ ...prev, saturate: Number(e.target.value) }))}
                onDoubleClick={() => setMissingStyle(prev => ({ ...prev, saturate: DEFAULT_MISSING_CARD_STYLE.saturate }))}
                className="w-full"
              />
            </label>

            <p className="text-role-label text-glass-muted pt-1 border-t border-white/10">
              Badge-/Button-Position (px, Doppelklick = zurücksetzen)
            </p>
            {([
              { key: 'reviewBadge', title: 'Prüfen-Badge', axes: ['top', 'left'] as const },
              { key: 'ownedBadge', title: 'Owned-Badge', axes: ['top', 'right'] as const },
              { key: 'priceBadge', title: 'Preis-Badge', axes: ['bottom', 'left'] as const },
              { key: 'wishlistBadge', title: 'Wunschlisten-Herz', axes: ['bottom', 'right'] as const },
            ] as const).map(({ key, title, axes }) => (
              <div key={key} className="flex items-center gap-2 flex-wrap">
                <span className="text-role-label text-glass-muted w-32 shrink-0">{title}</span>
                {axes.map(axis => {
                  const values = badgeLayout[key] as unknown as Record<string, number>;
                  const defaults = defaultBadgeLayoutFor(cardSize)[key] as unknown as Record<string, number>;
                  return (
                    <label key={axis} className="flex items-center gap-1 text-role-label text-glass-muted">
                      <span className="w-8">{axis}</span>
                      <input
                        type="range" min={-16} max={16} step={1}
                        value={values[axis]}
                        onChange={e => updateBadge(key, { [axis]: Number(e.target.value) } as Partial<CardTileBadgeLayout[typeof key]>)}
                        onDoubleClick={() => updateBadge(key, { [axis]: defaults[axis] } as Partial<CardTileBadgeLayout[typeof key]>)}
                        className="w-24"
                      />
                      <span className="w-8 text-right">{values[axis]}</span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* OwnedCopyRow — die "eigene Kopie"-Zeile im Kartendetail (Sprache/
          Zustand/Sammlung als Pills, Prüfen-Rahmen, Swipe-to-Delete). Rein
          lokale Demo-Kopien, kein Firestore — Gesten-Physik hier gefahrlos
          iterierbar, ohne echte Sammlungsdaten zu riskieren. */}
      <Section title="OwnedCopyRow (Kartendetail-Zeile)">
        <div className="space-y-3">
          <p className="text-role-label text-glass-muted">
            Swipe nach links: leichter Zug legt die Löschen-Fläche frei (Tap zum
            Bestätigen), genug Schwung löscht direkt — hier ohne Risiko, da rein
            lokale Demo-Daten. Tap auf eine Zeile mit gelbem Rahmen markiert sie
            als geprüft. Letztes Ereignis: <strong>{demoLog}</strong>
          </p>
          <p className="text-role-label text-glass-muted">
            Hintergrund der Zeile WÄHREND des Swipens (<code>.glass-swipe-solid</code>,
            blickdicht) — Light/Dark unabhängig einstellbar, da der Ruhezustand
            in beiden Modi unterschiedlich aussieht. Erst nach „Speichern" (oben
            rechts) wirkt sich das auf die echten Zeilen hier UND in der App aus.
          </p>
          <div className="flex flex-wrap gap-6">
            {(['light', 'dark'] as const).map(m => (
              <div key={m} className="flex items-center gap-3">
                <span className="text-role-label text-glass-muted w-10">{m === 'light' ? 'Light' : 'Dark'}</span>
                <label className="flex items-center gap-2">
                  <span className="text-role-label text-glass-muted">Farbe</span>
                  <input
                    type="color"
                    value={draftGlassTheme.swipeSolid[m].color}
                    onChange={e => setDraftGlassTheme(prev => ({ ...prev, swipeSolid: { ...prev.swipeSolid, [m]: { ...prev.swipeSolid[m], color: e.target.value } } }))}
                    className="w-8 h-8 rounded border border-white/40 bg-transparent"
                  />
                </label>
                <label className="flex items-center gap-2 text-role-label text-glass-muted">
                  <span>Helligkeit: {draftGlassTheme.swipeSolid[m].brightness.toFixed(2)}</span>
                  <input
                    type="range" min={-1} max={1} step={0.01} value={draftGlassTheme.swipeSolid[m].brightness}
                    onChange={e => setDraftGlassTheme(prev => ({ ...prev, swipeSolid: { ...prev.swipeSolid, [m]: { ...prev.swipeSolid[m], brightness: Number(e.target.value) } } }))}
                    onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, swipeSolid: { ...prev.swipeSolid, [m]: { ...prev.swipeSolid[m], brightness: DEFAULT_GLASS_THEME.swipeSolid[m].brightness } } }))}
                    className="w-32"
                  />
                </label>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 max-w-md">
            {demoCopies.map(copy => (
              <OwnedCopyRow
                key={copy.id}
                copy={copy}
                condColor={{ NM: '#48bb78', LP: '#facc15', MP: '#fb923c', HP: '#f87171', Poor: '#9ca3af' }[copy.condition] ?? '#9ca3af'}
                binder={DEMO_BINDER}
                isDefaultBinder={false}
                assignableBinders={[DEMO_BINDER, DEMO_OTHER_BINDER]}
                isDeleting={false}
                onMarkReviewed={() => {
                  setDemoCopies(cs => cs.map(c => c.id === copy.id ? { ...c, needsReview: false } : c));
                  setDemoLog(`"${copy.id}" als geprüft markiert`);
                }}
                onMoveToBinder={(targetId) => setDemoLog(targetId ? `Verschoben nach "${targetId === DEMO_BINDER.id ? DEMO_BINDER.name : DEMO_OTHER_BINDER.name}"` : 'Nach "Unsortiert" verschoben')}
                onDelete={() => {
                  setDemoCopies(cs => cs.filter(c => c.id !== copy.id));
                  setDemoLog(`"${copy.id}" gelöscht`);
                }}
              />
            ))}
            {demoCopies.length === 0 && (
              <button
                onClick={() => setDemoCopies([
                  makeDemoCopy('demo-1', { needsReview: true }),
                  makeDemoCopy('demo-2', { condition: 'LP', language: 'en', needsReview: false }),
                  makeDemoCopy('demo-3', { condition: 'HP', language: 'jp', quantity: 3 }),
                ])}
                className="text-role-label text-glass-muted underline self-start"
              >
                Demo-Zeilen zurücksetzen
              </button>
            )}
          </div>

          <p className="text-role-label text-glass-muted pt-2">
            Sammlung-Pille mit der neuen <code>CustomSelect</code> (klein) statt der
            bisherigen Ad-hoc-Implementierung — zum Vergleich, einmal <code>primary</code>,
            einmal <code>secondary</code>. Nur hier per <code>sammlungSelectVariant</code>-Prop
            aktiviert, der echte Kartendetail-Aufruf ist unverändert.
          </p>
          <div className="flex flex-col gap-1.5 max-w-md">
            {showPrimaryDemo && (() => {
              const selected = [DEMO_BINDER, DEMO_OTHER_BINDER].find(b => b.id === primaryDemoBinderId);
              return (
                <OwnedCopyRow
                  copy={makeDemoCopy('demo-primary', {})}
                  condColor="#48bb78"
                  binder={selected}
                  isDefaultBinder={!selected}
                  assignableBinders={[DEMO_BINDER, DEMO_OTHER_BINDER]}
                  isDeleting={false}
                  onMarkReviewed={() => {}}
                  onMoveToBinder={setPrimaryDemoBinderId}
                  onDelete={() => setShowPrimaryDemo(false)}
                  sammlungSelectVariant="primary"
                />
              );
            })()}
            {showSecondaryDemo && (() => {
              const selected = [DEMO_BINDER, DEMO_OTHER_BINDER].find(b => b.id === secondaryDemoBinderId);
              return (
                <OwnedCopyRow
                  copy={makeDemoCopy('demo-secondary', {})}
                  condColor="#48bb78"
                  binder={selected}
                  isDefaultBinder={!selected}
                  assignableBinders={[DEMO_BINDER, DEMO_OTHER_BINDER]}
                  isDeleting={false}
                  onMarkReviewed={() => {}}
                  onMoveToBinder={setSecondaryDemoBinderId}
                  onDelete={() => setShowSecondaryDemo(false)}
                  sammlungSelectVariant="secondary"
                />
              );
            })()}
            {(!showPrimaryDemo || !showSecondaryDemo) && (
              <button
                onClick={() => { setShowPrimaryDemo(true); setShowSecondaryDemo(true); }}
                className="text-role-label text-glass-muted underline self-start"
              >
                Demo-Zeilen zurücksetzen
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* CardBadge — das runde Badge-Primitiv hinter allen vier Kachel-Badges
          oben (Set/Owned/Prüfen/Wunschliste). Immer rund, unabhängig vom
          Inhalt — auf Nutzerwunsch: "Badges sind immer rund". `background:
          false` ist der Fall, den das Wunschlisten-Herz nutzt (kein
          Kreis-Hintergrund, nur Icon + Schatten). */}
      <Section title="CardBadge">
        <div className="flex items-center gap-6 flex-wrap">
          <div className="relative w-16 h-16 rounded-[8px] glass-inner flex items-center justify-center">
            <CardBadge
              size={40}
              color={badgeColor}
              background={badgeBackground}
              style={{ position: 'static' }}
            >
              {badgeContent === 'icon' && <Star size={18} className="text-white" />}
              {badgeContent === 'number' && '×2'}
              {badgeContent === 'letter' && 'A'}
              {badgeContent === 'heart' && (
                <svg width="22" height="20" viewBox="0 0 24 22" fill={badgeBackground ? '#fff' : '#ef4444'} stroke={badgeBackground ? '#fff' : '#ef4444'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              )}
            </CardBadge>
          </div>

          <div className="flex-1 min-w-[220px] space-y-3">
            <div className="space-y-1">
              <span className="text-role-label text-glass-muted block">Inhalt</span>
              <ButtonGroup
                value={badgeContent}
                onChange={v => setBadgeContent(v as typeof badgeContent)}
                options={[
                  { value: 'icon', label: 'Icon' },
                  { value: 'number', label: 'Zahl' },
                  { value: 'letter', label: 'Buchstabe' },
                  { value: 'heart', label: 'Herz' },
                ]}
              />
            </div>
            <label className="flex items-center gap-2 text-role-label text-glass-muted">
              <span>Farbe</span>
              <input
                type="color" value={badgeColor.length === 7 ? badgeColor : '#35d15a'}
                onChange={e => setBadgeColor(e.target.value)}
                className="w-8 h-8 rounded border-none bg-transparent"
              />
            </label>
            <Checkbox
              checked={badgeBackground}
              onChange={setBadgeBackground}
              label={badgeContent === 'heart' ? 'Hintergrund (aus = wie echtes Wunschlisten-Herz)' : 'Hintergrund'}
            />
          </div>
        </div>
      </Section>

      <Section title="Switch & Checkbox">
        <div className="flex items-center gap-6 flex-wrap">
          <Switch checked={switchOn} onChange={setSwitchOn} label="Switch" activeTrackStyle={toggleDemoStyle('#e53e3e')} />
          <Switch checked={false} onChange={() => {}} label="Aus" disabled />
          <Checkbox checked={checked} onChange={setChecked} label="Checkbox" activeStyle={toggleDemoStyle('#e53e3e')} />
          <Checkbox checked={false} onChange={() => {}} label="Aus" disabled />
        </div>
        <p className="text-role-label text-glass-muted">
          Eigenes Theme, unabhängig von ButtonGroup (nächste Sektion) — die
          hat ihre eigenen Regler dort.
        </p>
        <GlassSliders
          alpha={draftGlassTheme.toggle.alpha}
          setAlpha={v => setDraftGlassTheme(prev => ({ ...prev, toggle: { ...prev.toggle, alpha: v } }))}
          blur={draftGlassTheme.toggle.blur}
          setBlur={v => setDraftGlassTheme(prev => ({ ...prev, toggle: { ...prev.toggle, blur: v } }))}
          saturate={draftGlassTheme.toggle.saturate}
          setSaturate={v => setDraftGlassTheme(prev => ({ ...prev, toggle: { ...prev.toggle, saturate: v } }))}
          color="var(--foreground)"
          defaults={DEFAULT_GLASS_THEME.toggle}
        />
        <label className="block text-role-label space-y-1" style={{ color: 'var(--foreground)' }}>
          <span>Innerer Glanz: {draftGlassTheme.toggle.insetHighlight.toFixed(2)}</span>
          <input
            type="range" min={0} max={1} step={0.01} value={draftGlassTheme.toggle.insetHighlight}
            onChange={e => setDraftGlassTheme(prev => ({ ...prev, toggle: { ...prev.toggle, insetHighlight: Number(e.target.value) } }))}
            onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, toggle: { ...prev.toggle, insetHighlight: DEFAULT_GLASS_THEME.toggle.insetHighlight } }))}
            className="w-full"
          />
        </label>
      </Section>

      <Section title="ButtonGroup (Segmented Control)">
        <ButtonGroup
          value={groupVal}
          onChange={setGroupVal}
          options={[
            { value: 'all', label: 'Alle' },
            { value: 'owned', label: 'Vorhanden', count: 12 },
            { value: 'missing', label: 'Fehlen', count: 0 },
          ]}
          activeStyle={buttonGroupTextDemoStyle('#3182ce')}
          trackStyle={buttonGroupTextTrackStyle}
        />
        {/* Eigenes Theme (`draftGlassTheme.buttonGroupText`) — unabhängig
            von Switch/Checkbox UND von der iconOnly-Variante unten. */}
        <GlassSliders
          alpha={draftGlassTheme.buttonGroupText.alpha}
          setAlpha={v => setDraftGlassTheme(prev => ({ ...prev, buttonGroupText: { ...prev.buttonGroupText, alpha: v } }))}
          blur={draftGlassTheme.buttonGroupText.blur}
          setBlur={v => setDraftGlassTheme(prev => ({ ...prev, buttonGroupText: { ...prev.buttonGroupText, blur: v } }))}
          saturate={draftGlassTheme.buttonGroupText.saturate}
          setSaturate={v => setDraftGlassTheme(prev => ({ ...prev, buttonGroupText: { ...prev.buttonGroupText, saturate: v } }))}
          color="var(--foreground)"
          defaults={DEFAULT_GLASS_THEME.buttonGroupText}
        />
        <label className="block text-role-label space-y-1" style={{ color: 'var(--foreground)' }}>
          <span>Innerer Glanz: {draftGlassTheme.buttonGroupText.insetHighlight.toFixed(2)}</span>
          <input
            type="range" min={0} max={1} step={0.01} value={draftGlassTheme.buttonGroupText.insetHighlight}
            onChange={e => setDraftGlassTheme(prev => ({ ...prev, buttonGroupText: { ...prev.buttonGroupText, insetHighlight: Number(e.target.value) } }))}
            onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, buttonGroupText: { ...prev.buttonGroupText, insetHighlight: DEFAULT_GLASS_THEME.buttonGroupText.insetHighlight } }))}
            className="w-full"
          />
        </label>
        {/* Schatten/Schein am aktiven Segment (`flat: false` seit diesem
            Regler-Satz) — kann am Track-Rand abgeschnitten wirken, siehe
            Kommentar in button-group.tsx, bei Bedarf auf 0 stellen. */}
        <label className="block text-role-label space-y-1" style={{ color: 'var(--foreground)' }}>
          <span>Schatten-Deckkraft: {draftGlassTheme.buttonGroupText.shadowOpacity.toFixed(2)}</span>
          <input
            type="range" min={0} max={1} step={0.01} value={draftGlassTheme.buttonGroupText.shadowOpacity}
            onChange={e => setDraftGlassTheme(prev => ({ ...prev, buttonGroupText: { ...prev.buttonGroupText, shadowOpacity: Number(e.target.value) } }))}
            onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, buttonGroupText: { ...prev.buttonGroupText, shadowOpacity: DEFAULT_GLASS_THEME.buttonGroupText.shadowOpacity } }))}
            className="w-full"
          />
        </label>
        <label className="block text-role-label space-y-1" style={{ color: 'var(--foreground)' }}>
          <span>Schatten Y-Versatz: {draftGlassTheme.buttonGroupText.shadowOffsetY}px</span>
          <input
            type="range" min={0} max={20} step={1} value={draftGlassTheme.buttonGroupText.shadowOffsetY}
            onChange={e => setDraftGlassTheme(prev => ({ ...prev, buttonGroupText: { ...prev.buttonGroupText, shadowOffsetY: Number(e.target.value) } }))}
            onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, buttonGroupText: { ...prev.buttonGroupText, shadowOffsetY: DEFAULT_GLASS_THEME.buttonGroupText.shadowOffsetY } }))}
            className="w-full"
          />
        </label>
        <label className="block text-role-label space-y-1" style={{ color: 'var(--foreground)' }}>
          <span>Schatten-Blur: {draftGlassTheme.buttonGroupText.shadowBlur}px</span>
          <input
            type="range" min={0} max={40} step={1} value={draftGlassTheme.buttonGroupText.shadowBlur}
            onChange={e => setDraftGlassTheme(prev => ({ ...prev, buttonGroupText: { ...prev.buttonGroupText, shadowBlur: Number(e.target.value) } }))}
            onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, buttonGroupText: { ...prev.buttonGroupText, shadowBlur: DEFAULT_GLASS_THEME.buttonGroupText.shadowBlur } }))}
            className="w-full"
          />
        </label>
        {/* Track-Transparenz im INAKTIVEN Zustand ("Vorhanden"/"Fehlen") —
            ersetzt die bisher fixe `.glass-inner-clear`-Deckkraft. */}
        <label className="block text-role-label space-y-1" style={{ color: 'var(--foreground)' }}>
          <span>Hintergrund-Deckkraft (inaktiv): {draftGlassTheme.buttonGroupText.trackAlpha.toFixed(2)}</span>
          <input
            type="range" min={0} max={1} step={0.01} value={draftGlassTheme.buttonGroupText.trackAlpha}
            onChange={e => setDraftGlassTheme(prev => ({ ...prev, buttonGroupText: { ...prev.buttonGroupText, trackAlpha: Number(e.target.value) } }))}
            onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, buttonGroupText: { ...prev.buttonGroupText, trackAlpha: DEFAULT_GLASS_THEME.buttonGroupText.trackAlpha } }))}
            className="w-full"
          />
        </label>

        {/* iconOnly-Variante — dieselbe Komponente, die oben im Header für
            den Light/Dark-Umschalter genutzt wird. Komplett eigenes Theme
            (`draftGlassTheme.buttonGroupIcon`), unabhängig vom Text-Segment
            oben. */}
        <div className="pt-2 border-t border-white/10 space-y-3">
          <span className="text-role-label text-glass-muted block">
            iconOnly — eigenes Theme, unabhängig vom Text-Segment oben
          </span>
          <ButtonGroup
            iconOnly
            value={groupIconVal}
            onChange={setGroupIconVal}
            options={[
              { value: 'a', label: <Star size={18} />, ariaLabel: 'A' },
              { value: 'b', label: <Waves size={18} />, ariaLabel: 'B' },
            ]}
            activeStyle={buttonGroupIconDemoStyle(draftGlassTheme.buttonGroupIcon.activeColor)}
            trackStyle={buttonGroupIconTrackStyle}
          />
          <p className="text-role-label text-glass-muted">
            iconOnly — identisch zum Light/Dark-Umschalter oben im Header.
          </p>
          <GlassSliders
            alpha={draftGlassTheme.buttonGroupIcon.alpha}
            setAlpha={v => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, alpha: v } }))}
            blur={draftGlassTheme.buttonGroupIcon.blur}
            setBlur={v => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, blur: v } }))}
            saturate={draftGlassTheme.buttonGroupIcon.saturate}
            setSaturate={v => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, saturate: v } }))}
            color="var(--foreground)"
            defaults={DEFAULT_GLASS_THEME.buttonGroupIcon}
          />
          <label className="block text-role-label text-glass-muted space-y-1">
            <span>Innerer Glanz: {draftGlassTheme.buttonGroupIcon.insetHighlight.toFixed(2)}</span>
            <input
              type="range" min={0} max={1} step={0.01} value={draftGlassTheme.buttonGroupIcon.insetHighlight}
              onChange={e => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, insetHighlight: Number(e.target.value) } }))}
              onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, insetHighlight: DEFAULT_GLASS_THEME.buttonGroupIcon.insetHighlight } }))}
              className="w-full"
            />
          </label>
          <label className="flex items-center gap-2 text-role-label text-glass-muted">
            <span>Aktive Farbe</span>
            <input
              type="color" value={draftGlassTheme.buttonGroupIcon.activeColor}
              onChange={e => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, activeColor: e.target.value } }))}
              className="w-8 h-8 rounded border border-white/40 bg-transparent"
            />
          </label>
          <label className="block text-role-label text-glass-muted space-y-1">
            <span>Schatten-Deckkraft: {draftGlassTheme.buttonGroupIcon.shadowOpacity.toFixed(2)}</span>
            <input
              type="range" min={0} max={1} step={0.01} value={draftGlassTheme.buttonGroupIcon.shadowOpacity}
              onChange={e => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, shadowOpacity: Number(e.target.value) } }))}
              onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, shadowOpacity: DEFAULT_GLASS_THEME.buttonGroupIcon.shadowOpacity } }))}
              className="w-full"
            />
          </label>
          <label className="block text-role-label text-glass-muted space-y-1">
            <span>Schatten Y-Versatz: {draftGlassTheme.buttonGroupIcon.shadowOffsetY}px</span>
            <input
              type="range" min={0} max={20} step={1} value={draftGlassTheme.buttonGroupIcon.shadowOffsetY}
              onChange={e => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, shadowOffsetY: Number(e.target.value) } }))}
              onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, shadowOffsetY: DEFAULT_GLASS_THEME.buttonGroupIcon.shadowOffsetY } }))}
              className="w-full"
            />
          </label>
          <label className="block text-role-label text-glass-muted space-y-1">
            <span>Schatten-Blur: {draftGlassTheme.buttonGroupIcon.shadowBlur}px</span>
            <input
              type="range" min={0} max={40} step={1} value={draftGlassTheme.buttonGroupIcon.shadowBlur}
              onChange={e => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, shadowBlur: Number(e.target.value) } }))}
              onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, shadowBlur: DEFAULT_GLASS_THEME.buttonGroupIcon.shadowBlur } }))}
              className="w-full"
            />
          </label>
          <label className="flex items-center gap-2 text-role-label text-glass-muted">
            <span>Hintergrundfarbe (inaktiv)</span>
            <input
              type="color" value={draftGlassTheme.buttonGroupIcon.trackColor}
              onChange={e => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, trackColor: e.target.value } }))}
              className="w-8 h-8 rounded border border-white/40 bg-transparent"
            />
          </label>
          <label className="block text-role-label text-glass-muted space-y-1">
            <span>Hintergrund-Deckkraft (inaktiv): {draftGlassTheme.buttonGroupIcon.trackAlpha.toFixed(2)}</span>
            <input
              type="range" min={0} max={1} step={0.01} value={draftGlassTheme.buttonGroupIcon.trackAlpha}
              onChange={e => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, trackAlpha: Number(e.target.value) } }))}
              onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, buttonGroupIcon: { ...prev.buttonGroupIcon, trackAlpha: DEFAULT_GLASS_THEME.buttonGroupIcon.trackAlpha } }))}
              className="w-full"
            />
          </label>
        </div>
      </Section>

      <Section title="Select">
        <p className="text-role-label text-glass-muted -mt-1">
          Natives {'<select>'} — Optik 1:1 vom secondary-Button (`secondaryGlassStyle()` + Hover-Lift/Press-Squish).
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <Select
            value={selectVal}
            onChange={setSelectVal}
            options={[{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }, { value: 'c', label: 'Option C' }]}
          />
          <Select
            height="sm"
            value={selectVal}
            onChange={setSelectVal}
            options={[{ value: 'a', label: 'Blatt 1' }, { value: 'b', label: 'Blatt 2' }]}
          />
          <Select
            variant="primary"
            value={selectVal}
            onChange={setSelectVal}
            options={[{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }, { value: 'c', label: 'Option C' }]}
          />
          {/* Echter Hex-Wert statt `var(--action-delete)` — siehe Kommentar
              bei den Button-Farbvarianten unten (`primaryGlassStyle` kann
              CSS-Variablen nicht auflösen, nur echte Hex-Strings). */}
          <Select
            variant="primary"
            accentColor="#c53030"
            height="sm"
            value={selectVal}
            onChange={setSelectVal}
            options={[{ value: 'a', label: 'Blatt 1' }, { value: 'b', label: 'Blatt 2' }]}
          />
        </div>

        <p className="text-role-label text-glass-muted pt-2">
          Custom Dropdown (Trigger-Button + Portal-Panel, z.B. für Icons pro Option) —
          verallgemeinert aus der Sammlung-Auswahl in <code>OwnedCopyRow</code>, dieselbe
          secondary-/primary-Button-Optik wie oben. Icon pro Option ist wie im echten
          Einsatz entweder ein normales Binder-Icon ODER (bei Vorlagen-/Master-Set-
          Bindern) das echte Set-Logo (`BinderIcon name="set:xxx"`) — hier "Fatale Flammen".
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <CustomSelect
            value={customSelectVal}
            onChange={setCustomSelectVal}
            options={[
              { value: 'a', label: 'Fatale Flammen', icon: <BinderIcon name="set:me2" size={16} className="shrink-0" /> },
              { value: 'b', label: 'Wunschzettel-Doppelte', icon: <Star size={13} className="shrink-0" /> },
              { value: 'c', label: 'Ein sehr langer Sammlungsname zum Testen', icon: <Star size={13} className="shrink-0" /> },
            ]}
          />
          <CustomSelect
            height="sm"
            value={null}
            onChange={setCustomSelectVal}
            placeholder="Unsortiert"
            options={[
              { value: 'a', label: 'Fatale Flammen', icon: <BinderIcon name="set:me2" size={14} className="shrink-0" /> },
              { value: 'b', label: 'Wunschzettel-Doppelte', icon: <Star size={13} className="shrink-0" /> },
            ]}
          />
          <CustomSelect
            variant="primary"
            value={customSelectVal}
            onChange={setCustomSelectVal}
            options={[
              { value: 'a', label: 'Fatale Flammen', icon: <BinderIcon name="set:me2" size={16} className="shrink-0" /> },
              { value: 'b', label: 'Wunschzettel-Doppelte', icon: <Star size={13} className="shrink-0" /> },
              { value: 'c', label: 'Ein sehr langer Sammlungsname zum Testen', icon: <Star size={13} className="shrink-0" /> },
            ]}
          />
        </div>
      </Section>

      <Section title="Chip / Filter-Pille">
        <div className="flex items-center gap-2 flex-wrap">
          <Chip active={chipA} onClick={() => setChipA(v => !v)} label="Aktiv" count={8} accentColor="var(--pokedex-red)" />
          <Chip active={chipB} onClick={() => setChipB(v => !v)} label="Inaktiv" count={3} />
          <Chip active={false} disabled onClick={() => {}} label="Disabled (0)" count={0} />
          <Chip active icon={<Star size={14} />} onClick={() => {}} label="Mit Icon" />
        </div>
      </Section>

      <Section title="Input">
        <div className="space-y-3 max-w-sm">
          <Input value={inputVal} onChange={setInputVal} placeholder="Standard-Input" onClear={() => setInputVal('')} style={inputGlassStyle(draftGlassTheme.input)} />
          <Input value={searchVal} onChange={setSearchVal} placeholder="Suchen …" variant="search" onClear={() => setSearchVal('')} style={inputGlassStyle(draftGlassTheme.input)} />

          <p className="text-role-label text-glass-muted pt-1 border-t border-white/10">
            Einstellungen (Entwurf — "Speichern" im Header übernimmt app-weit)
          </p>
          <GlassSliders
            alpha={draftGlassTheme.input.alpha}
            setAlpha={v => setDraftGlassTheme(prev => ({ ...prev, input: { ...prev.input, alpha: v } }))}
            blur={draftGlassTheme.input.blur}
            setBlur={v => setDraftGlassTheme(prev => ({ ...prev, input: { ...prev.input, blur: v } }))}
            saturate={draftGlassTheme.input.saturate}
            setSaturate={v => setDraftGlassTheme(prev => ({ ...prev, input: { ...prev.input, saturate: v } }))}
            color="var(--foreground)"
            defaults={DEFAULT_GLASS_THEME.input}
          />
          <label className="block text-role-label text-glass-muted space-y-1">
            <span>Rahmenbreite: {draftGlassTheme.input.borderWidth}px</span>
            <input
              type="range" min={0} max={3} step={0.5} value={draftGlassTheme.input.borderWidth}
              onChange={e => setDraftGlassTheme(prev => ({ ...prev, input: { ...prev.input, borderWidth: Number(e.target.value) } }))}
              onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, input: { ...prev.input, borderWidth: DEFAULT_GLASS_THEME.input.borderWidth } }))}
              className="w-full"
            />
          </label>
          <label className="block text-role-label text-glass-muted space-y-1">
            <span>Rahmen-Deckkraft: {draftGlassTheme.input.borderOpacity.toFixed(2)}</span>
            <input
              type="range" min={0} max={1} step={0.01} value={draftGlassTheme.input.borderOpacity}
              onChange={e => setDraftGlassTheme(prev => ({ ...prev, input: { ...prev.input, borderOpacity: Number(e.target.value) } }))}
              onDoubleClick={() => setDraftGlassTheme(prev => ({ ...prev, input: { ...prev.input, borderOpacity: DEFAULT_GLASS_THEME.input.borderOpacity } }))}
              className="w-full"
            />
          </label>
          <p className="text-role-label text-glass-muted">
            Kein Glanz/Schatten-Regler — würde den Pflicht-Fokus-Ring (Tab-Taste,
            Screenreader) per CSS-Kaskade dauerhaft verdecken.
          </p>
        </div>
      </Section>

      <Section title="Progress (linear)">
        <div className="space-y-2 max-w-sm">
          <Progress value={0} max={130} accentColor="var(--pokedex-blue)" trackStyle={progressTrackStyle(draftGlassTheme.progressTrack)} />
          <Progress value={65} max={130} accentColor="var(--pokedex-blue)" trackStyle={progressTrackStyle(draftGlassTheme.progressTrack)} />
          <Progress value={130} max={130} accentColor="var(--pokedex-blue)" trackStyle={progressTrackStyle(draftGlassTheme.progressTrack)} />

          <p className="text-role-label text-glass-muted pt-1 border-t border-white/10">
            Inaktiver Bereich (Entwurf — "Speichern" im Header übernimmt app-weit)
          </p>
          <GlassSliders
            alpha={draftGlassTheme.progressTrack.alpha}
            setAlpha={v => setDraftGlassTheme(prev => ({ ...prev, progressTrack: { ...prev.progressTrack, alpha: v } }))}
            blur={draftGlassTheme.progressTrack.blur}
            setBlur={v => setDraftGlassTheme(prev => ({ ...prev, progressTrack: { ...prev.progressTrack, blur: v } }))}
            saturate={draftGlassTheme.progressTrack.saturate}
            setSaturate={v => setDraftGlassTheme(prev => ({ ...prev, progressTrack: { ...prev.progressTrack, saturate: v } }))}
            color="var(--foreground)"
            defaults={DEFAULT_GLASS_THEME.progressTrack}
          />
        </div>
      </Section>

      <Section title="Modal (Sheet / Dialog)">
        <p className="text-role-label text-glass-muted">
          Nutzt exakt dasselbe Rezept wie das Panel oben (dieselben Regler,
          gemeinsamer State) — &bdquo;Panel ist die Basis&ldquo;, Sheet/Dialog sind nur
          eine weitere Glas-Fläche mit demselben Style.
        </p>
        <label className="block text-role-label text-glass-muted space-y-1">
          <span>Textfarbe ({mode === 'dark' ? 'Weißwert' : 'Schwarzwert'}): {glassTextGray}</span>
          <input
            type="range" min={0} max={255} step={1} value={glassTextGray}
            onChange={e => setGlassTextGray(Number(e.target.value))}
            onDoubleClick={() => setGlassTextGray(mode === 'dark' ? DEFAULT_GLASS_THEME.textColor.dark : DEFAULT_GLASS_THEME.textColor.light)}
            className="w-full"
          />
        </label>
        <GlassSliders
          alpha={glassAlpha} setAlpha={setGlassAlpha}
          blur={glassBlur} setBlur={setGlassBlur}
          saturate={glassSaturate} setSaturate={setGlassSaturate}
          color="var(--foreground)"
        />
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setSheetOpen(true)}>Sheet öffnen</Button>
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>Dialog öffnen</Button>
        </div>
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Beispiel-Sheet" style={glassOverrideStyle}>
          <p className="text-role-body" style={{ color: glassTextColor }}>
            Bottom-Sheet — schließt per Backdrop-Klick, Escape-Taste oder dem X.
          </p>
        </Sheet>
        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Beispiel-Dialog" style={glassOverrideStyle}>
          <p className="text-role-body" style={{ color: glassTextColor }}>
            Zentriertes Modal — gleiches Schließverhalten wie das Sheet.
          </p>
        </Dialog>
      </Section>
    </div>
  );
}
