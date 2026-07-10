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
