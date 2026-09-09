/**
 * Testmodus/Debug-Schalter für den Scanner (pro Gerät, localStorage). Ist er an,
 * erscheint im Scanner oben mittig der „Test"-Button (ScanTestPanel: gespeicherte
 * Scans erneut durch die Pipeline, ohne Kamera). Standard AUS.
 */
const KEY = 'pokedex.scan.testmode';

export function isTestModeEnabled(): boolean {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}

export function setTestModeEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}
