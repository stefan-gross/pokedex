'use client';

/**
 * Mehrstufige Scanner-Debug-Flags (in den Einstellungen ein/ausschaltbar):
 *   - scan  → Live-Erkennung/Qualität (Ampel-Rahmen, Metriken); KEIN Foto/Gemini.
 *   - ai    → Gemini-Rohantwort + Latenz einblenden/loggen.
 *   - data  → Katalog-Lookup + Reconcile einblenden/loggen.
 * Persistiert in localStorage, reaktiv via `useScannerDebug()`. `dbg()` loggt nur,
 * wenn das jeweilige Flag an ist.
 */

import { useEffect, useState } from 'react';

export type ScannerDebugStage = 'scan' | 'ai' | 'data';

export interface ScannerDebugFlags {
  scan: boolean;
  ai: boolean;
  data: boolean;
}

const KEYS: Record<ScannerDebugStage, string> = {
  scan: 'scanner-debug-scan',
  ai: 'scanner-debug-ai',
  data: 'scanner-debug-data',
};

const CHANGE_EVENT = 'scanner-debug-changed';

function readFlags(): ScannerDebugFlags {
  if (typeof window === 'undefined') return { scan: false, ai: false, data: false };
  const g = (s: ScannerDebugStage) => {
    try { return localStorage.getItem(KEYS[s]) === '1'; } catch { return false; }
  };
  return { scan: g('scan'), ai: g('ai'), data: g('data') };
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
  const [flags, setFlags] = useState<ScannerDebugFlags>({ scan: false, ai: false, data: false });
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

/** Konsolen-Log, nur wenn das Stage-Flag an ist. Präfix `[scan]/[ki]/[daten]`. */
export function dbg(stage: ScannerDebugStage, ...args: unknown[]): void {
  if (!readFlags()[stage]) return;
  const prefix = stage === 'scan' ? '[scan]' : stage === 'ai' ? '[ki]' : '[daten]';
  // eslint-disable-next-line no-console
  console.log(prefix, ...args);
}
