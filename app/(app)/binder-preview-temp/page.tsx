'use client';

// TEMPORÄRE Debug-Seite — zeigt alle Binder/Box-Farbe×Icon-Kombinationen mit
// der echten BinderCover-Komponente zur visuellen Abnahme. Nicht verlinkt,
// wird nach der Abnahme wieder gelöscht.

import { useId } from 'react';
import { Fredoka } from 'next/font/google';
import { BinderCover } from '@/components/binder/BinderCover';

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
// Feste Kachelbreite auf dieser Testseite (kein Grid, kein Resize nötig).
const TILE_W = 260;
const TILE_H = TILE_W * 4 / 3; // aspect-[3/4]
// Radius der echten Kachel-Rundung (rounded-br-[20px] in ROUNDING.folder).
const TILE_RADIUS = 20;
const BANDEROLE_GAP = 6;
const BANDEROLE_HEIGHT = 36;

/** Banderole-Pfad (nur Ordner) — statt eines unabhängigen, eigenen
 *  Eckenradius (sah bei der geringen Bandhöhe stark überproportioniert aus)
 *  folgt die rechte Kante exakt demselben Kreisbogen wie die echte
 *  Kachel-Rundung (TILE_RADIUS), nur um 1px nach rechts verschoben. Da die
 *  Banderole viel niedriger ist als die Kachel, ist nur ein kleiner
 *  Bogen-Abschnitt sichtbar — daher die sanfte statt starke Rundung. */
/** Etwas hellere Variante der Binderfarbe für die Banderole (Nutzerwunsch:
 *  "gleiche Farbe, ein bisschen heller"). Einfache Mischung Richtung Weiß,
 *  analog zu embossTextColor() in BinderCover.tsx. */
function lightenColor(hex: string, amount: number): string {
  const full = hex.replace('#', '');
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * amount);
  return `#${[r, g, b].map(mix).map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// Sehr kleine Rundung an den "normalen" Ecken (oben links/rechts, unten
// links) — nur die Binder-Ecke unten rechts bekommt stattdessen die an die
// Kachel-Rundung angeglichene große Kurve (siehe unten).
const BANDEROLE_SMALL_RADIUS = 3;

function banderoleClipPath(): string {
  const w = TILE_W + 2; // Div-Breite: -1 bis TILE_W+1
  const h = BANDEROLE_HEIGHT;
  const sr = BANDEROLE_SMALL_RADIUS;
  const yc = BANDEROLE_HEIGHT + BANDEROLE_GAP - TILE_RADIUS; // Kreismittelpunkt, lokale Y
  const dy = h - yc;
  const dx = Math.sqrt(Math.max(TILE_RADIUS ** 2 - dy ** 2, 0));
  const xBottom = (w - TILE_RADIUS) + dx;
  return `path('M0 ${sr} A${sr} ${sr} 0 0 1 ${sr} 0 L${w - sr} 0 A${sr} ${sr} 0 0 1 ${w} ${sr} `
    + `L${w} ${yc} A${TILE_RADIUS} ${TILE_RADIUS} 0 0 1 ${xBottom} ${h} `
    + `L${sr} ${h} A${sr} ${sr} 0 0 1 0 ${h - sr} Z')`;
}

function PreviewTile({
  shape, color: c, icon: ic,
}: {
  shape: 'folder' | 'box';
  color: { name: string; hex: string };
  icon: { key: string; label: string; icon: string; name: string };
}) {
  const grainUid = useId().replace(/:/g, '');
  const isBox = shape === 'box';
  // Komplementärfarbe war schwer lesbar — erstmal zurück auf Weiß.
  const bandColor = lightenColor(c.hex, 0.14);

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
              <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.1 0.1 0.1 0 0" result="grain" />
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
            // (Nur bei Bindern) derselbe linke Schatten-Verlauf wie am
            // Ordner-Cover selbst (BinderCover.tsx: "Leichter vertikaler
            // Schatten links"), vor die etwas aufgehellte Binderfarbe
            // gelegt. Boxen bekommen keinen linken Schatten (dort gibt es
            // am Körper auch keinen vergleichbaren Schatten). Kein
            // Glanzlicht mehr (auf Nutzerwunsch wieder entfernt).
            background: [
              ...(isBox ? [] : ['linear-gradient(90deg, rgba(0,0,0,.3) 0px, rgba(0,0,0,0) 26px)']),
              bandColor,
            ].join(', '),
            boxShadow: '0 3px 6px rgba(0,0,0,.35)',
            filter: `url(#banderole-grain-${grainUid})`,
            // Box: einheitliche sehr kleine Rundung an allen 4 Ecken.
            // Binder: dieselbe kleine Rundung an 3 Ecken, nur unten rechts
            // folgt stattdessen dem Kreisbogen der echten Kachel-Rundung
            // (siehe banderoleClipPath).
            borderRadius: isBox ? BANDEROLE_SMALL_RADIUS : undefined,
            clipPath: isBox ? undefined : banderoleClipPath(),
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>≈ 42 €</span>
          <span style={{ fontSize: 12, color: '#fff', opacity: 0.85 }}>7 Karten</span>
        </div>
      </div>
    </div>
  );
}
