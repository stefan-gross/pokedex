'use client';

// TEMPORÄRE Debug-Seite — zeigt alle Binder/Box-Farbe×Icon-Kombinationen mit
// der echten BinderCover-Komponente zur visuellen Abnahme. Nicht verlinkt,
// wird nach der Abnahme wieder gelöscht.

import { useId } from 'react';
import { Fredoka } from 'next/font/google';
import { BinderCover } from '@/components/binder/BinderCover';
import { complementaryColor } from '@/lib/color-utils';

// NUR zum Testen auf dieser temporären Seite — Kandidat für eine besser
// zur Prägung passende Schrift (kräftig, rund), unabhängig vom App-Font.
const fredoka = Fredoka({ subsets: ['latin'], weight: ['600', '700'] });

const COLORS: { name: string; hex: string }[] = [
  { name: 'Schwarz', hex: '#1a1a1a' },
  { name: 'Weiß',    hex: '#ffffff' },
  { name: 'Rot',     hex: '#e53e3e' },
  { name: 'Blau',    hex: '#4299e1' },
  { name: 'Gelb',    hex: '#ecc94b' },
  { name: 'Grün',    hex: '#48bb78' },
  { name: 'Lila',    hex: '#667eea' },
];

const ICONS: { key: string; label: string; icon: string; name: string }[] = [
  { key: 'basis', label: 'Basis-Icon', icon: 'folder',    name: 'Meine Sammlung' },
  { key: 'typ',   label: 'Typ-Icon',   icon: 'type:Fire',  name: 'Feuer-Karten' },
  { key: 'set',   label: 'Set-Symbol', icon: 'set:swsh9',  name: 'Dschungel' },
];

export default function BinderPreviewPage() {
  return (
    <div className={fredoka.className} style={{ padding: 16, background: '#e7e8ec', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 20 }}>Binder/Box-Vorschau (temporär) — Testfont: Fredoka</h1>
      {(['folder', 'box'] as const).map(shape => (
        COLORS.map(c => (
          ICONS.map(ic => (
            <PreviewTile key={`${shape}-${c.hex}-${ic.key}`} shape={shape} color={c} icon={ic} />
          ))
        ))
      ))}
    </div>
  );
}

/** Eigene Komponente statt Inline-JSX in der map()-Schleife, da die
 *  Banderolen-Körnung ihre eigene useId()-Instanz pro Kachel braucht (Hooks
 *  dürfen nicht in Callbacks/Schleifen aufgerufen werden). */
function PreviewTile({
  shape, color: c, icon: ic,
}: {
  shape: 'folder' | 'box';
  color: { name: string; hex: string };
  icon: { key: string; label: string; icon: string; name: string };
}) {
  const grainUid = useId().replace(/:/g, '');
  const isBox = shape === 'box';
  const textColor = complementaryColor(c.hex);

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        {shape === 'folder' ? 'Binder' : 'Box'} · {c.name} ({c.hex}) · {ic.label}
      </div>
      <div style={{ width: 260, position: 'relative' }}>
        <BinderCover color={c.hex} name={ic.name} icon={ic.icon} shape={shape} />
        {/* Banderole — 1:1 aus app/(app)/binders/page.tsx (BinderTile)
            übernommen, zum Testen über alle Farb-/Icon-Kombinationen. */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            <filter id={`banderole-grain-${grainUid}`}>
              <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" result="noise" />
              <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.15 0.15 0.15 0 0" result="grain" />
              <feComposite in="grain" in2="SourceAlpha" operator="in" result="grainClipped" />
              <feBlend in="SourceGraphic" in2="grainClipped" mode="multiply" />
            </filter>
          </defs>
        </svg>
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            left: isBox ? 'calc(4 / 300 * 100% - 1px)' : -1,
            right: isBox ? 'calc(4 / 300 * 100% - 1px)' : -1,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            padding: '10px 14px',
            background: c.hex,
            boxShadow: '0 3px 6px rgba(0,0,0,.35)',
            filter: `url(#banderole-grain-${grainUid})`,
            // Box: keine Eckenrundung. Binder: nur unten rechts, angeglichen
            // an die Kachel-Rundung (21 statt 20, gleicht den 1px-Überstand
            // aus). Unten links bleibt bei Binder eckig.
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: isBox ? 0 : 21,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: textColor }}>≈ 42 €</span>
          <span style={{ fontSize: 12, color: textColor, opacity: 0.85 }}>7 Karten</span>
        </div>
      </div>
    </div>
  );
}
