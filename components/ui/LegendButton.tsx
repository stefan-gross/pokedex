'use client';

import { useId, useState, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, Flag, X } from 'lucide-react';
import { WishlistHeart } from '@/components/card/Card';
import { AutomaticBadge, SystemBadge } from '@/components/binder/CollectionTypeBadge';
import { ExclamationMark } from '@/lib/binder-icons';
import { LanguageFlag } from '@/components/card/LanguageFlag';

/** Erklärbare Symbole der App. Jede Seite gibt an, welche sie zeigt →
 *  kontextbasierte Legende. */
export type LegendKey =
  | 'wishlist-heart'
  | 'unreviewed'
  | 'automatic'
  | 'system'
  | 'count'
  | 'foreign-lang'
  | 'pending'
  | 'scan-frame'
  | 'fake-suspect';

/** Kleines Eck-Badge (abgerundetes Quadrat wie die Karten-Badges) für die
 *  Legende — die echten `CardBadge` sind `absolute` positioniert und daher
 *  inline unpraktisch; Form/Farbe hier 1:1 nachgebildet. */
function SquareBadge({ color, textColor = '#fff', children }: { color: string; textColor?: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center justify-center font-bold shrink-0"
      style={{ width: 24, height: 24, borderRadius: '7px 2px 7px 2px', background: color, color: textColor, fontSize: 14 }}
    >
      {children}
    </span>
  );
}

interface Entry {
  title: string;
  desc: string;
  visual: (gradId: string) => ReactNode;
  /** Mehrere Unter-Zustände untereinander (je Symbol + Kurzbedeutung) statt
   *  einer Sammel-Beschreibung — z.B. die vier Herz-Zustände. */
  states?: (gradId: string) => { node: ReactNode; label: string }[];
}

/** Registry aller Symbole (feste, sinnvolle Reihenfolge). */
const ENTRIES: Record<LegendKey, Entry> = {
  'wishlist-heart': {
    title: 'Wunschlisten-Herz',
    desc: '',
    visual: (g) => <WishlistHeart manual auto={false} width={22} height={20} gradId={`${g}-m`} />,
    states: (g) => [
      { node: <WishlistHeart manual auto={false} width={22} height={20} gradId={`${g}-m`} />, label: 'Auf manueller Liste' },
      { node: <WishlistHeart manual={false} auto width={22} height={20} gradId={`${g}-a`} />, label: 'Auf automatischer Liste' },
      { node: <WishlistHeart manual auto width={22} height={20} gradId={`${g}-b`} />, label: 'Auf manueller und automatischer' },
      { node: <WishlistHeart manual={false} auto={false} width={22} height={20} gradId={`${g}-n`} />, label: 'Auf keiner Liste' },
    ],
  },
  'unreviewed': {
    title: 'Ungeprüft',
    desc: 'Dein Exemplar ist noch nicht bestätigt.',
    visual: () => (
      <SquareBadge color="var(--pokedex-yellow)">
        <ExclamationMark size={14} strokeWidth={3} className="text-white" />
      </SquareBadge>
    ),
  },
  'automatic': {
    title: 'Automatisch',
    desc: 'Sammlung bzw. Wunschliste wird per Regel gepflegt, nicht von Hand.',
    visual: () => <AutomaticBadge />,
  },
  'system': {
    title: 'Unsortiert',
    desc: 'Feste Standard-Sammlung für Karten ohne Zuordnung — nicht löschbar/umbenennbar.',
    visual: () => <SystemBadge />,
  },
  'count': {
    title: 'Anzahl',
    desc: 'So oft besitzt du die Karte (ab 2 Exemplaren).',
    visual: () => (
      <span
        className="inline-flex items-center justify-center font-bold shrink-0"
        style={{ width: 26, height: 24, borderRadius: '2px 7px 2px 7px', background: 'rgba(53,209,90,.9)', color: '#fff', fontSize: 12 }}
      >
        ×2
      </span>
    ),
  },
  'foreign-lang': {
    title: 'Fremdsprachig',
    desc: 'Karte nur in einer anderen Sprache vorhanden — auf Deutsch fehlt sie dir noch. Die Flagge zeigt die Sprache.',
    visual: () => <LanguageFlag lang="en" size={18} elevated />,
  },
  'pending': {
    title: 'Vorläufig',
    desc: 'Noch nicht im Katalog gefunden — als Platzhalter aufgenommen.',
    visual: () => <SquareBadge color="#e24b4a">?</SquareBadge>,
  },
  'scan-frame': {
    title: 'Scan-Rahmen',
    desc: 'Grün = erkannt · gelb = noch prüfen · rot = Problem beim Erkennen.',
    visual: () => (
      <span className="inline-flex items-center gap-1.5 shrink-0">
        {['#22c55e', '#eab308', '#ef4444'].map(c => (
          <span key={c} style={{ width: 18, height: 24, borderRadius: 4, border: `2.5px solid ${c}` }} />
        ))}
      </span>
    ),
  },
  'fake-suspect': {
    title: 'Fake-Verdacht',
    desc: 'Mögliche Fälschung — bitte genauer prüfen.',
    visual: () => (
      <SquareBadge color="#e24b4a">
        <Flag size={13} strokeWidth={2.5} className="text-white" />
      </SquareBadge>
    ),
  },
};

const ORDER: LegendKey[] = [
  'wishlist-heart', 'unreviewed', 'automatic', 'system', 'count', 'foreign-lang', 'pending', 'scan-frame', 'fake-suspect',
];

/**
 * Sticky Hilfe-„?"-FAB + kontextbasierte Legende (Bottom-Sheet). Spiegelt den
 * `ScrollToTopButton` (unten rechts) nach unten LINKS, damit beide nie
 * kollidieren; im Scanner via `position="top-left"`. `symbols` steuert, welche
 * Einträge die Legende zeigt (nur die auf dieser Seite tatsächlich vorkommenden).
 */
export function LegendButton({ symbols, position = 'bottom-left' }: {
  symbols: LegendKey[];
  position?: 'bottom-left' | 'top-left';
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const gradBase = useId();
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const shown = ORDER.filter(k => symbols.includes(k));
  if (shown.length === 0) return null;

  const top = position === 'top-left';
  // FAB-Position (44px hoch); das Panel dockt mit 8px Abstand darüber (unten)
  // bzw. darunter (Scanner/oben) an — klappt „aus dem Button" auf wie das
  // „…"-Menü, statt als Bottom-Sheet.
  const fabStyle = top
    ? { top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }
    : { bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))' };
  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    left: 12,
    width: 'min(360px, calc(100vw - 24px))',
    maxHeight: '70vh',
    overflowY: 'auto',
    ...(top
      ? { top: 'calc(env(safe-area-inset-top, 0px) + 64px)' }
      : { bottom: 'calc(84px + env(safe-area-inset-bottom, 0px) + 52px)' }),
  };

  return (
    <>
      <button
        type="button"
        aria-label="Legende / Hilfe"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="glass fixed left-3 z-40 flex items-center justify-center w-11 h-11 rounded-full text-glass shadow-[0_6px_20px_rgba(0,0,0,0.28)]"
        style={fabStyle}
      >
        <HelpCircle size={22} strokeWidth={2.2} />
      </button>

      {mounted && open && createPortal(
        <>
          <div className="glass-sheet-backdrop fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Legende"
            className={`menu-goo-open z-50 glass-sheet rounded-2xl p-3 ${top ? 'origin-top-left' : 'origin-bottom-left'}`}
            style={panelStyle}
          >
            <div className="flex items-center justify-between px-1 pb-0.5">
              <span className="text-role-title text-glass">Legende</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Schließen" className="text-glass-muted -mr-1 p-1">
                <X size={18} />
              </button>
            </div>
            <p className="text-role-label text-glass-muted px-1 pb-1">Symbole auf dieser Seite</p>
            <div className="flex flex-col">
              {shown.map(k => {
                const e = ENTRIES[k];
                const states = e.states?.(`${gradBase}-${k}`);
                if (states) {
                  // Mehrere Zustände untereinander: je Symbol + Kurzbedeutung.
                  return (
                    <div key={k} className="py-2.5 border-t border-[var(--border)]">
                      <span className="block text-role-body text-glass">{e.title}</span>
                      <div className="flex flex-col gap-1.5 mt-1.5">
                        {states.map((s, i) => (
                          <span key={i} className="flex items-center gap-2.5">
                            <span className="shrink-0 flex items-center">{s.node}</span>
                            <span className="text-role-label text-glass-muted">{s.label}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={k} className="flex items-start gap-3 py-2.5 border-t border-[var(--border)]">
                    <span className="shrink-0 flex items-center gap-1.5 pt-0.5">{e.visual(`${gradBase}-${k}`)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-role-body text-glass">{e.title}</span>
                      <span className="block text-role-label text-glass-muted leading-relaxed">{e.desc}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
