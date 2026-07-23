'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/** Sperrt das Scrollen von `<body>` während ein Modal offen ist — sonst
 *  scrollt der Hintergrund unter dem Overlay mit (iOS-Safari-typisches
 *  Problem bei `position: fixed`-Overlays). Reines `overflow: hidden`
 *  reicht dafür NICHT — iOS Safari lässt den Hintergrund trotzdem per Touch
 *  scrollen (`overflow: hidden` blockiert dort nur Maus-/Trackpad-Scroll).
 *  Der zuverlässige Trick: `<body>` selbst auf `position: fixed` setzen
 *  (per gemerktem `scrollY` als negativer `top`-Offset), das macht den
 *  Hintergrund für Touch-Gesten komplett unbeweglich; beim Schließen wird
 *  die Scroll-Position exakt wiederhergestellt. */
function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const scrollY = window.scrollY;
    const { position, top, width, overflow } = document.body.style;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.position = position;
      document.body.style.top = top;
      document.body.style.width = width;
      document.body.style.overflow = overflow;
      window.scrollTo(0, scrollY);
    };
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

interface SheetProps extends OverlayProps {
  /** Eigener Header-Bereich (z.B. Kartenkopf mit Name/KP/Typ-Icons) statt der
   *  einfachen `title`+Schließen-Zeile — ersetzt sie komplett, bleibt wie
   *  `title` außerhalb des scrollenden Inhalts (`shrink-0`). */
  header?: React.ReactNode;
  /** Aktiviert Swipe-Down-zum-Schließen am Ziehgriff (z.B. `CardDetailSheet`) —
   *  ohne diese Prop ist der Griff rein dekorativ (bisheriges Verhalten). */
  dragToClose?: boolean;
  /** Klassen für den scrollenden Innenbereich — Default passt für einfache
   *  Inhalte mit `title`; Aufrufer mit eigenem Innenabstand pro Sektion (z.B.
   *  `CardDetailSheet`s `drawer-panel`-Karten mit `mx-4`) übergeben eigene
   *  Klassen ohne horizontales Padding, um doppelten Abstand zu vermeiden. */
  bodyClassName?: string;
}

/**
 * Bottom-Sheet — extrahiert aus dem bereits etablierten Drawer-Muster
 * (`CreateBinderModal.tsx`, `.glass-sheet`/`.glass-sheet-backdrop`).
 * Neu ggü. den bisherigen Ad-hoc-Kopien: Escape-Taste schließt zusätzlich
 * zum Backdrop-Klick, `<body>` wird während `open` scroll-gesperrt, plus
 * eigene Ein-/Ausblend-Animation (Slide-up/-down, 250ms) und optionales
 * Swipe-Down-Schließen — vorher jeweils individuell in `CardDetailSheet`
 * nachgebaut, jetzt hier zentral für jeden `Sheet`-Aufrufer verfügbar.
 */
export function Sheet({ open, onClose, title, header, dragToClose, children, style, bodyClassName = 'px-4 pb-4 pt-2' }: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    setDragY(0);
    const t = setTimeout(() => setMounted(false), 250);
    return () => clearTimeout(t);
  }, [open]);

  useBodyScrollLock(mounted);
  useEscapeToClose(mounted, onClose);
  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      <div
        className="absolute inset-0 transition-opacity duration-[250ms] glass-sheet-backdrop"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={onClose}
      />
      <div
        className="relative w-full rounded-t-2xl glass-sheet max-h-[93dvh] flex flex-col"
        style={{
          ...style,
          transform: visible ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: dragStartYRef.current != null ? 'none' : 'transform 250ms ease-out',
        }}
      >
        <div
          className={`flex items-center justify-center pt-3 pb-2 shrink-0 ${dragToClose ? 'cursor-grab touch-none' : ''}`}
          style={dragToClose ? { touchAction: 'none' } : undefined}
          onPointerDown={e => {
            if (!dragToClose) return;
            dragStartYRef.current = e.clientY;
            setDragY(0);
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            if (!dragToClose || dragStartYRef.current == null) return;
            const dy = e.clientY - dragStartYRef.current;
            setDragY(Math.max(0, dy));
          }}
          onPointerUp={e => {
            if (!dragToClose || dragStartYRef.current == null) return;
            const dy = e.clientY - dragStartYRef.current;
            dragStartYRef.current = null;
            try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            if (dy > 80) onClose(); else setDragY(0);
          }}
          onPointerCancel={() => {
            if (!dragToClose) return;
            dragStartYRef.current = null;
            setDragY(0);
          }}
        >
          <div className="w-9 h-1 rounded-full bg-[rgba(46,46,50,0.2)] dark:bg-white/30" />
        </div>
        {header}
        <div className={`flex-1 min-h-0 overflow-y-auto ${bodyClassName}`}>
          {!header && title && (
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
