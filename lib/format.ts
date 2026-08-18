/** Gemeinsame Formatierungs-Helfer (vorher inline an vielen Stellen dupliziert). */

/** EUR-Betrag im deutschen Format. `maximumFractionDigits` steuert Nachkomma-
 *  stellen (Default 0 = ganze Euro, wie in den meisten Wert-Banderolen). */
export function formatEUR(value: number, maximumFractionDigits = 0): string {
  return value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits });
}

/** Kartennummer wie auf der Karte: führende „x/y"-Angabe auf die reine Nummer
 *  reduziert, rein numerische Nummern dreistellig gepolstert und — falls
 *  `printedTotal` übergeben — als „007/094" ergänzt. Nicht-numerische Nummern
 *  (Promos wie „SWSH123") bleiben unverändert. Kein `printedTotal` (undefined/
 *  null/0) → nur die Basis (z.B. für Promos: Aufrufer übergibt dann kein total).
 *  Ersetzt die zuvor in CardDetailSheet + Wunschliste duplizierte Logik (B3). */
export function formatCardNumber(number: string | null | undefined, printedTotal?: number | null): string {
  const raw = (number ?? '').split('/')[0];
  if (!raw) return '';
  const isPlain = /^\d+$/.test(raw);
  const base = isPlain ? raw.padStart(3, '0') : raw;
  return isPlain && printedTotal ? `${base}/${String(printedTotal).padStart(3, '0')}` : base;
}
