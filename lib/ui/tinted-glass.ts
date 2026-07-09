/**
 * Getönter Glas-Chip-Stil für Aktions-Buttons (Hinzufügen/Löschen/Speichern) —
 * dasselbe Rezept wie der Scan-FAB (components/BottomNav.tsx): blur + Sättigung
 * + heller Innenrand + farbiger Glow. Zentral hier statt pro Datei dupliziert
 * (Session-Vorgabe: ein gemeinsames "iOS Liquid Glass"-Theme für wiederkehrende
 * Elemente, nicht mehrere leicht abweichende Kopien).
 */

export function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

export function tintedGlassStyle(hex: string): React.CSSProperties {
  const rgb = hexToRgb(hex);
  return {
    background: `rgba(${rgb},0.85)`,
    backdropFilter: 'blur(10px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
    border: '1.5px solid rgba(255,255,255,0.5)',
    boxShadow: `inset 0 1px 2px rgba(255,255,255,0.6), 0 0 14px rgba(${rgb},0.5), 0 4px 12px rgba(0,0,0,0.3)`,
  };
}
