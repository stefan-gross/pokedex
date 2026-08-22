'use client';

/**
 * Mehrstufige Scanner-Debug-Flags (in den Einstellungen ein/ausschaltbar):
 *   - scan  → Live-Erkennung/Qualität (Ampel-Rahmen, Metriken); KEIN Foto/Gemini.
 *   - ai    → Sendebild-Vorschau + Gemini-Antwort/Latenz + Lookup-Kette.
 * Persistiert in localStorage, reaktiv via `useScannerDebug()`. `dbg()` loggt nur,
 * wenn das jeweilige Flag an ist.
 */

import { useEffect, useState } from 'react';

export type ScannerDebugStage = 'scan' | 'ai' | 'test' | 'failonly';

export interface ScannerDebugFlags {
  scan: boolean;
  ai: boolean;
  test: boolean;
  /** Nur Fehlversuche (nicht erkannte Karten) in die Scan-Historie speichern —
   *  hält die gedeckelten 20 Plätze für Debug-relevante Fälle frei. */
  failonly: boolean;
}

const KEYS: Record<ScannerDebugStage, string> = {
  scan: 'scanner-debug-scan',
  ai: 'scanner-debug-ai',
  test: 'scanner-debug-test',
  failonly: 'scanner-debug-failonly',
};

const CHANGE_EVENT = 'scanner-debug-changed';

function readFlags(): ScannerDebugFlags {
  if (typeof window === 'undefined') return { scan: false, ai: false, test: false, failonly: false };
  const g = (s: ScannerDebugStage) => {
    try { return localStorage.getItem(KEYS[s]) === '1'; } catch { return false; }
  };
  return { scan: g('scan'), ai: g('ai'), test: g('test'), failonly: g('failonly') };
}

export function getScannerDebug(): ScannerDebugFlags {
  return readFlags();
}

export function setScannerDebug(stage: ScannerDebugStage, on: boolean): void {
  try { localStorage.setItem(KEYS[stage], on ? '1' : '0'); } catch { /* ignorieren */ }
  // Gleicher-Tab-Benachrichtigung (das native `storage`-Event feuert nur cross-tab).
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Reaktiver Hook. Startet mit `false` (SSR-sicher, keine Hydration-Mismatch),
 *  liest die echten Werte erst nach dem Mount. */
export function useScannerDebug(): ScannerDebugFlags {
  const [flags, setFlags] = useState<ScannerDebugFlags>({ scan: false, ai: false, test: false, failonly: false });
  useEffect(() => {
    const update = () => setFlags(readFlags());
    update();
    window.addEventListener('storage', update);
    window.addEventListener(CHANGE_EVENT, update);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener(CHANGE_EVENT, update);
    };
  }, []);
  return flags;
}

/** Konsolen-Log, nur wenn das Stage-Flag an ist. Präfix `[scan]/[ki]`. */
export function dbg(stage: ScannerDebugStage, ...args: unknown[]): void {
  if (!readFlags()[stage]) return;
  const prefix = stage === 'scan' ? '[scan]' : '[ki]';
  // eslint-disable-next-line no-console
  console.log(prefix, ...args);
}
