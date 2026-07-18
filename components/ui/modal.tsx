'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

/** Sperrt das Scrollen von `<body>` während ein Modal offen ist — sonst
 *  scrollt der Hintergrund unter dem Overlay mit (iOS-Safari-typisches
 *  Problem bei `position: fixed`-Overlays). */
function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);
}

/** Schließt per Escape-Taste, solange das Modal offen ist. */
function useEscapeToClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onClose]);
}

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Überschreibt/ergänzt das `.glass-sheet`-Rezept (Deckkraft/Blur/Sättigung)
   *  — nur für die Design-System-Testseite gedacht (Live-Vergleich), im
   *  echten App-Code nicht gesetzt, daher ohne Auswirkung dort. */
  style?: React.CSSProperties;
}

/**
 * Bottom-Sheet — extrahiert aus dem bereits etablierten Drawer-Muster
 * (`CreateBinderModal.tsx`, `.glass-sheet`/`.glass-sheet-backdrop`).
 * Neu ggü. den bisherigen Ad-hoc-Kopien: Escape-Taste schließt zusätzlich
 * zum Backdrop-Klick, `<body>` wird während `open` scroll-gesperrt.
 */
export function Sheet({ open, onClose, title, children, style }: OverlayProps) {
  useBodyScrollLock(open);
  useEscapeToClose(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      <div className="absolute inset-0 transition-opacity duration-[250ms] glass-sheet-backdrop" onClick={onClose} />
      <div className="relative w-full rounded-t-2xl glass-sheet max-h-[93dvh] flex flex-col" style={style}>
        <div className="w-9 h-1 rounded-full bg-[rgba(46,46,50,0.2)] dark:bg-white/30 mx-auto mt-3 mb-1 shrink-0" />
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-2">
          {title && (
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">{title}</h2>
              <button onClick={onClose} className="w-11 h-11 rounded-full glass-inner flex items-center justify-center shrink-0" aria-label="Schließen">
                <X size={20} />
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Zentriertes Modal — gleiche Backdrop-Klasse wie `Sheet`, aber mittig statt
 * unten angedockt und auf allen vier Ecken gerundet. Für kürzere,
 * bestätigungsartige Inhalte (aktuell nutzt die App dafür noch natives
 * `confirm()` — `Dialog` ist die Grundlage für eine spätere Ablösung davon,
 * hier bewusst noch nicht migriert, siehe Scope-Abgrenzung im Plan).
 */
export function Dialog({ open, onClose, title, children, style }: OverlayProps) {
  useBodyScrollLock(open);
  useEscapeToClose(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 transition-opacity duration-[250ms] glass-sheet-backdrop" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl glass-sheet max-h-[85dvh] flex flex-col" style={style}>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-4">
          {title && (
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">{title}</h2>
              <button onClick={onClose} className="w-11 h-11 rounded-full glass-inner flex items-center justify-center shrink-0" aria-label="Schließen">
                <X size={20} />
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
