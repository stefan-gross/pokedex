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
