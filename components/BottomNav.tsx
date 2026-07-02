'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, BookOpen, Heart, Camera, Pause, LayoutGrid, IdCard, Layers, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CardPrice } from '@/components/card/CardPrice';

const FAB_SIZE = 72;

const navItems = [
  { href: '/', icon: Home, label: 'Home' },
  { href: '/collection', icon: Search, label: 'Suchen' },
  null, // FAB placeholder
  { href: '/binders', icon: BookOpen, label: 'Sammlungen' },
  { href: '/wishlist', icon: Heart, label: 'Wunschliste' },
];

// Auf /scanner werden Slot 2 + 4 mit Scanner-Controls überschrieben.
// Diese Events werden von app/(app)/scanner/page.tsx behandelt.
const SCAN_TOGGLE_EVENT       = 'scanner-toggle-pause';
const SCAN_GRID_TOGGLE_EVENT  = 'scanner-toggle-grid';
const SCAN_MODE_TOGGLE_EVENT  = 'scanner-toggle-mode';
const SCAN_STATE_EVENT        = 'scanner-state-changed';
const SCAN_ADD_EVENT          = 'scanner-add-recognized';

interface ScannerNavState {
  paused: boolean;        // Stream pausiert?
  scanMode: 'add' | 'recognize';
  jobsCount: number;      // Anzahl Add-Jobs (für Grid-Badge)
  gridVisible: boolean;   // Grid-Button anzeigen?
  reviewMode?: boolean;   // Scanner ist im Review-Grid → BottomNav komplett ausblenden
  canAdd?: boolean;       // Einzeln-Modus: erkannte Karte kann hinzugefügt werden → grüner +-Button erscheint über der FAB
  recognizedCardId?: string | null;    // tcgId der erkannten Karte, für Preis rechts neben dem +-Button
  recognizedNumber?: string | null;    // "053/172", links neben dem +-Button
  recognizedDex?: string | null;       // "#035", darunter
}

export function BottomNav() {
  const pathname = usePathname();
  const [scanState, setScanState] = useState<ScannerNavState>({
    paused: false,
    scanMode: 'recognize',
    jobsCount: 0,
    gridVisible: false,
    reviewMode: false,
    canAdd: false,
  });

  const isScanner = pathname === '/scanner';

  // Scanner-State-Sync — Scanner-Page postet ihren Status hierher (muss VOR dem
  // early-return stehen, damit Hook-Reihenfolge konsistent bleibt)
  useEffect(() => {
    const onState = (e: Event) => {
      const detail = (e as CustomEvent<ScannerNavState>).detail;
      if (detail) setScanState(detail);
    };
    window.addEventListener(SCAN_STATE_EVENT, onState as EventListener);
    return () => window.removeEventListener(SCAN_STATE_EVENT, onState as EventListener);
  }, []);

  // Im Scanner-Review-Grid übernimmt die Bulk-Action-Row die Footer-Rolle.
  // BottomNav komplett verstecken, damit kein Konflikt mit der Bulk-Row entsteht.
  if (isScanner && scanState.reviewMode) return null;

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  // FAB-Style: rot, ragt deutlich oben aus der Nav heraus
  const fabStyle: React.CSSProperties = {
    width: FAB_SIZE,
    height: FAB_SIZE,
    marginTop: -20,
    flexShrink: 0,
    background: 'var(--pokedex-red)',
    boxShadow: '0 4px 20px rgba(220,38,38,0.45)',
  };

  // Kompaktere Höhe: 56 px Inhalt + Safe-Area
  const navStyle: React.CSSProperties = {
    gridTemplateColumns: 'repeat(5, 1fr)',
    height: 'calc(56px + env(safe-area-inset-bottom, 0px))',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    // Im Scanner soll die Toolbar genauso transparent sein wie der Rest des
    // Screens (reines Kamerabild ohne Tönung) — kein Hintergrund, kein Blur,
    // kein Schatten, der eine sichtbare Kante erzeugen würde.
    ...(isScanner
      ? { background: 'transparent' }
      : { boxShadow: '0 -4px 24px rgba(30,40,80,0.08), 0 -1px 0 rgba(30,40,80,0.05)' }),
  };

  // Items unten ausgerichtet; FAB (Slot 2) ragt durch marginTop:-20 oben raus
  const navClassName = isScanner
    ? 'fixed bottom-0 left-0 right-0 z-50 grid items-end justify-items-center'
    : 'fixed bottom-0 left-0 right-0 z-50 grid items-end justify-items-center bg-card/95 backdrop-blur-xl';

  // Klick-Handler für FAB
  const handleFabClick = () => {
    // Auf /scanner: Toggle Stream-Pause via Event
    if (isScanner) {
      window.dispatchEvent(new Event(SCAN_TOGGLE_EVENT));
    }
    // Off-Scanner: Link-Navigation, kein Handler nötig (Next.js Link)
  };

  const fabIconColor = '#fff';
  // Off-Scanner: Kamera-Icon. Auf /scanner: Pause wenn laufend, Kamera wenn pausiert.
  const FabIcon = !isScanner ? Camera : (scanState.paused ? Camera : Pause);

  // ── Scanner-Modus: Flex-Layout (links Grid, Mitte FAB, rechts Switch) ──
  // Vorteil ggü. 5-col-Grid: FAB ist garantiert horizontal zentriert
  // (zwischen zwei flex-1-Zonen), Switch kollidiert auf Mobile nicht mit der FAB.
  if (isScanner) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-end" style={navStyle}>
        {/* Links: Grid-Button (nur Mehrere-Modus mit Karten) — außerdem Nummer/Dex
            der erkannten Karte (Einzeln-Modus), mittig in dieser Zone (= horizontal
            zentriert zwischen Bildschirmrand und +-Button) und vertikal zentriert
            in dem Bereich, in dem die Kapsel über die Toolbar hinausragt. */}
        <div
          className="flex-1 flex justify-start items-end relative"
          style={{ paddingLeft: 16, paddingBottom: 10, alignSelf: 'stretch' }}
        >
          {scanState.gridVisible && (
            <button
              onClick={() => window.dispatchEvent(new Event(SCAN_GRID_TOGGLE_EVENT))}
              className="relative w-11 h-11 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-sm"
              aria-label="Übersicht öffnen"
            >
              <LayoutGrid size={20} color="#fff" />
              {scanState.jobsCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                  style={{ background: 'var(--pokedex-red)', color: '#fff' }}
                >
                  {scanState.jobsCount}
                </span>
              )}
            </button>
          )}
          {scanState.recognizedNumber && (
            <div
              className="absolute inset-x-0 flex flex-col items-center justify-center font-mono text-white/80 text-base"
              style={{ top: -92, height: 92 }}
            >
              <span>{scanState.recognizedNumber}</span>
              {scanState.recognizedDex && (
                <span className="text-sm text-white/60">{scanState.recognizedDex}</span>
              )}
            </div>
          )}
        </div>

        {/* Mitte: FAB-Kapsel — Kamera/Pause-Button immer sichtbar, grüner
            +-Button erscheint animiert darüber, sobald eine erkannte Karte
            hinzugefügt werden kann. Beide Buttons teilen sich einen Wrapper mit
            marginTop:-20 (statt vorher auf dem Button selbst) — wächst die
            Kapsel durch den +-Button, schiebt sich alles gemeinsam weiter nach
            oben aus der Toolbar heraus. */}
        <div
          className="relative flex flex-col items-center transition-all duration-300"
          style={{
            marginTop: -26,
            padding: 6,
            borderRadius: 999,
            background: 'rgba(0,0,0,0.35)',
            border: '1.5px solid rgba(255,255,255,0.18)',
          }}
        >
          <div
            className="relative flex items-center justify-center overflow-visible"
            style={{
              width: 56,
              height: scanState.canAdd ? 56 : 0,
              marginBottom: scanState.canAdd ? 8 : 0,
              opacity: scanState.canAdd ? 1 : 0,
              transform: scanState.canAdd ? 'scale(1)' : 'scale(0.4)',
              transition: 'height 280ms cubic-bezier(.34,1.56,.64,1), margin-bottom 280ms ease, opacity 220ms ease, transform 280ms cubic-bezier(.34,1.56,.64,1)',
              pointerEvents: scanState.canAdd ? 'auto' : 'none',
            }}
          >
            <button
              onClick={() => window.dispatchEvent(new Event(SCAN_ADD_EVENT))}
              aria-label="Zur Sammlung hinzufügen"
              className="w-full h-full flex items-center justify-center rounded-full shadow-xl"
              style={{ background: 'var(--action-add)' }}
            >
              <Plus size={26} color="#fff" strokeWidth={3} />
            </button>
          </div>
          <button
            onClick={handleFabClick}
            className="flex items-center justify-center rounded-full shadow-xl"
            style={{ ...fabStyle, marginTop: 0 }}
            aria-label={scanState.paused ? 'Stream fortsetzen' : 'Stream pausieren'}
          >
            <FabIcon size={28} color={fabIconColor} fill={!scanState.paused ? '#fff' : 'none'} />
          </button>
        </div>

        {/* Rechts: Mode-Switch */}
        <div
          className="flex-1 flex justify-end items-end relative"
          style={{ paddingRight: 16, paddingBottom: 10, alignSelf: 'stretch' }}
        >
          <div
            className="flex rounded-full p-0.5 bg-black/55 backdrop-blur-sm"
            style={{ border: '1px solid rgba(255,255,255,0.12)' }}
          >
            {(['recognize', 'add'] as const).map(m => {
              const Icon = m === 'add' ? Layers : IdCard;
              const isActive = scanState.scanMode === m;
              return (
                <button
                  key={m}
                  onClick={() => {
                    if (isActive) return;
                    window.dispatchEvent(new CustomEvent(SCAN_MODE_TOGGLE_EVENT, { detail: m }));
                  }}
                  className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                  aria-label={m === 'add' ? 'Mehrere' : 'Einzeln'}
                  style={{
                    background: isActive ? 'var(--pokedex-red)' : 'transparent',
                    color:      isActive ? '#fff' : 'rgba(255,255,255,0.65)',
                  }}
                >
                  <Icon size={18} />
                </button>
              );
            })}
          </div>
          {scanState.recognizedCardId && (
            <div
              className="absolute inset-x-0 flex items-center justify-center"
              style={{ top: -92, height: 92 }}
            >
              <div style={{ transform: 'scale(2)' }}>
                <CardPrice tcgId={scanState.recognizedCardId} className="text-blue-400!" />
              </div>
            </div>
          )}
        </div>
      </nav>
    );
  }

  // ── Off-Scanner: Original 5-col-Grid mit Nav-Items + zentriertem FAB ──
  return (
    <nav className={navClassName} style={navStyle}>
      {navItems.map((item, i) => {
        // ── Mittlerer Slot (Index 2): FAB ──────────────────────────────
        if (item === null) {
          return (
            <div key="fab" className="relative flex items-center justify-center" style={{ width: FAB_SIZE }}>
              {isScanner ? (
                <button
                  onClick={handleFabClick}
                  className="flex items-center justify-center rounded-full shadow-xl"
                  style={fabStyle}
                  aria-label={scanState.paused ? 'Stream fortsetzen' : 'Stream pausieren'}
                >
                  <FabIcon size={28} color={fabIconColor} fill={!scanState.paused && isScanner ? '#fff' : 'none'} />
                </button>
              ) : (
                <Link
                  href="/scanner"
                  className="flex items-center justify-center rounded-full shadow-xl"
                  style={fabStyle}
                  aria-label="Karte scannen"
                >
                  <Camera size={28} color={fabIconColor} />
                </Link>
              )}
            </div>
          );
        }

        // ── Auf /scanner: Slot 1 (Suchen) → Grid-Button, Slot 3 (Sammlungen) → Mode-Switch
        if (isScanner && i === 1) {
          // Grid-Button — nur sichtbar im Mehrere-Modus mit Karten
          if (!scanState.gridVisible) return <div key={`scan-${i}`} />;
          return (
            <button
              key={`scan-${i}`}
              onClick={() => window.dispatchEvent(new Event(SCAN_GRID_TOGGLE_EVENT))}
              className="relative w-11 h-11 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-sm"
              aria-label="Übersicht öffnen"
            >
              <LayoutGrid size={20} color="#fff" />
              {scanState.jobsCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                  style={{ background: 'var(--pokedex-red)', color: '#fff' }}
                >
                  {scanState.jobsCount}
                </span>
              )}
            </button>
          );
        }
        if (isScanner && (i === 0 || i === 4)) {
          // Auf /scanner: Home und Wunschliste ausblenden — nur Scanner-Controls sichtbar
          return <div key={`scan-empty-${i}`} />;
        }
        if (isScanner && i === 3) {
          // Mode-Switch [Einzeln | Mehrere]
          return (
            <div
              key={`scan-${i}`}
              className="flex rounded-full p-0.5 bg-black/55 backdrop-blur-sm"
              style={{ border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {(['recognize', 'add'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => {
                    if (m === scanState.scanMode) return;
                    window.dispatchEvent(new CustomEvent(SCAN_MODE_TOGGLE_EVENT, { detail: m }));
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                  style={{
                    background: scanState.scanMode === m ? 'var(--pokedex-red)' : 'transparent',
                    color:      scanState.scanMode === m ? '#fff' : 'rgba(255,255,255,0.65)',
                  }}
                >
                  {m === 'add' ? 'Mehrere' : 'Einzeln'}
                </button>
              ))}
            </div>
          );
        }

        // Normale Nav-Items
        const Icon = item.icon;
        const active = isActive(item.href);
        const itemColor = isScanner
          ? (active ? '#fff' : 'rgba(255,255,255,0.65)')
          : (active ? 'var(--pokedex-red)' : 'var(--muted-foreground)');
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-col items-center gap-0.5 px-3 min-w-[56px]"
            style={{ color: itemColor, paddingBottom: 6, paddingTop: 4 }}
          >
            <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// Exportiert für Scanner-Page, um State zu posten
export const SCANNER_NAV_EVENTS = {
  TOGGLE_PAUSE: SCAN_TOGGLE_EVENT,
  TOGGLE_GRID:  SCAN_GRID_TOGGLE_EVENT,
  TOGGLE_MODE:  SCAN_MODE_TOGGLE_EVENT,
  STATE:        SCAN_STATE_EVENT,
};
export type { ScannerNavState };
