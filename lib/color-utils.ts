/** Hochkontrast-Textfarbe für einen Hintergrund (Luminanz-basiert). Nicht-Hex
 *  (CSS-Var/rgba) → `fallback`, da die tatsächliche Helligkeit ohne DOM-
 *  Auswertung nicht bekannt ist. */
export function readableTextColor(bg: string | undefined, fallback: '#ffffff' | '#1a1a1a' = '#ffffff'): string {
  if (!bg?.startsWith('#')) return fallback;
  const hex = bg.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff';
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/** Wie `readableTextColor()`, aber kontrastiert gegen die tatsächlich
 *  SICHTBARE Fläche (Farbe mit `alpha` über dem Seitenhintergrund gemischt)
 *  statt gegen die volldeckende Rohfarbe. Bei niedriger Deckkraft (z.B.
 *  `secondary`-Button mit Grau + Alpha 0.2) ist die real gerenderte Fläche
 *  viel heller als der rohe Hex-Wert — `readableTextColor('#8e8e93')` würde
 *  trotzdem Weiß wählen (Luminanz des VOLLEN Grautons liegt unter der
 *  Schwelle), obwohl die tatsächlich sichtbare, stark aufgehellte Fläche
 *  dunklen Text bräuchte. Referenz-Hintergrund grob an `--background`
 *  (app/globals.css, oklch) angenähert — echte oklch→RGB-Konvertierung
 *  wäre hier unverhältnismäßig, die Näherung reicht für die Kontrastwahl. */
export function readableTextColorBlended(hex: string, alpha: number): string {
  // BEWUSST kein `document.documentElement.classList.contains('dark')`-
  // Check hier (früherer Versuch, zurückgenommen): das las den Light/Dark-
  // Zustand direkt im Render-Pfad einer SSR-fähigen Client-Komponente —
  // der Server kennt diesen Zustand nie, der Client (bei tatsächlich
  // aktivem System-Dark-Mode) schon VOR dem ersten Paint (`next-themes`
  // setzt die Klasse synchron vor der Hydration). Ergebnis: ein
  // Hydration-Mismatch, der sich nicht "von selbst" korrigiert, weil
  // React Inline-`style`-Diffs (anders als reinen Textinhalt) nicht
  // stillschweigend übernimmt. Diese Funktion ist daher bewusst eine
  // REINE Funktion von `hex`/`alpha` ohne DOM-Zugriff — nimmt immer den
  // hellen Referenzhintergrund an (im Dark Mode dadurch ggf. nicht
  // perfekter, aber niemals stiller Server/Client-Unterschied).
  const bg: [number, number, number] = [244, 245, 247];
  const [r, g, b] = hexToRgbTuple(hex);
  const blendedR = r * alpha + bg[0] * (1 - alpha);
  const blendedG = g * alpha + bg[1] * (1 - alpha);
  const blendedB = b * alpha + bg[2] * (1 - alpha);
  const luminance = (0.299 * blendedR + 0.587 * blendedG + 0.114 * blendedB) / 255;
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff';
}

/** Hellere Variante einer Hex-Farbe — mischt `amount` (0–1) Anteil Weiß dazu.
 *  Für Gradient-Stopps (z.B. Primary-Button-Verlauf aus einer einzigen
 *  Akzentfarbe statt zwei fest hinterlegten Tönen). */
export function lightenColor(hex: string, amount: number): string {
  const [r, g, b] = hexToRgbTuple(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Dunklere Variante einer Hex-Farbe — mischt `amount` (0–1) Anteil Schwarz dazu. */
export function darkenColor(hex: string, amount: number): string {
  const [r, g, b] = hexToRgbTuple(hex);
  const mix = (c: number) => Math.round(c * (1 - amount));
  return `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Sättigt eine Hex-Farbe stärker (HSL-Sättigung Richtung 100%, `amount`
 *  0–1 = Anteil der Strecke zum Maximum). Bei sehr niedriger Deckkraft
 *  (z.B. 0.07) macht sich der Farbton kaum bemerkbar — ein kräftiger
 *  gesättigter Ton bleibt auch bei wenig Alpha noch klar als "diese Farbe"
 *  erkennbar, ein blasser/entsättigter Ton verschwindet fast völlig. */
export function saturateColor(hex: string, amount: number): string {
  const [r, g, b] = hexToRgbTuple(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  const newS = s + (1 - s) * amount;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + newS) : l + newS - l * newS;
  const p = 2 * l - q;
  const rr = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const gg = Math.round(hue2rgb(p, q, h) * 255);
  const bb = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
  return `#${[rr, gg, bb].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Hex-Farbe als `rgba()`-String mit gegebener Deckkraft. */
export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgbTuple(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Komplementärfarbe (RGB-Invertierung) — deterministisch statt Luminanz-
 *  Schwellenwert (kein Umkipp-Risiko bei Farben nahe der 50%-Grenze, siehe
 *  BinderCover.tsx). Für kräftigen, gut sichtbaren Kontrast auf farbigem
 *  Untergrund, z.B. Text auf einer Banderole in der Sammlungsfarbe. */
export function complementaryColor(bg: string | undefined, fallback = '#ffffff'): string {
  if (!bg?.startsWith('#')) return fallback;
  const hex = bg.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `#${[r, g, b].map(v => (255 - v).toString(16).padStart(2, '0')).join('')}`;
}
