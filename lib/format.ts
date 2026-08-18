/** Gemeinsame Formatierungs-Helfer (vorher inline an vielen Stellen dupliziert). */

/** EUR-Betrag im deutschen Format. `maximumFractionDigits` steuert Nachkomma-
 *  stellen (Default 0 = ganze Euro, wie in den meisten Wert-Banderolen). */
export function formatEUR(value: number, maximumFractionDigits = 0): string {
  return value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits });
}
