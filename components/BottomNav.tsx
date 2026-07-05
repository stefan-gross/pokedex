'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, BookOpen, Heart, Camera, Pause, LayoutGrid, Plus, Minus } from 'lucide-react';
import { useEffect, useState } from 'react';

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
const SCAN_REMOVE_EVENT       = 'scanner-remove-recognized';

interface ScannerNavState {
  paused: boolean;        // Stream pausiert?
  scanMode: 'add' | 'recognize';
  jobsCount: number;      // Anzahl Add-Jobs (für Grid-Badge)
  gridVisible: boolean;   // Grid-Button anzeigen?
  reviewMode?: boolean;   // Scanner ist im Review-Grid → BottomNav komplett ausblenden
  canAdd?: boolean;       // Einzeln-Modus: erkannte Karte kann hinzugefügt werden → grüner +-Button erscheint über der FAB
  canDelete?: boolean;    // Einzeln-Modus: erkannte Karte ist bereits im Besitz → roter Löschen-Button erscheint neben dem +-Button
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
  // Kamera/Pause-Button in der Scanner-FAB-Kapsel: lila statt rot, damit er sich
  // klar von Löschen (rot) und Hinzufügen (grün) daneben abhebt.
  const scannerCameraColor = '#8b5cf6';
  // Rahmen-Kreise (Gooey-Schicht) sind etwas größer als die eigentlichen Buttons
  // (56px / FAB_SIZE) — der Überstand ergibt den sichtbaren "Ring" pro Kreis.
  const FRAME_PAD = 1;
  const FRAME_SIZE = 56 + FRAME_PAD * 2;
  const FRAME_SIZE_CAM = FAB_SIZE + FRAME_PAD * 2;

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
        {/* Links: Grid-Button (nur Mehrere-Modus mit Karten). Reine Symmetrie-
            Zone zur rechten Seite — die FAB-Kapsel zentriert sich unabhängig
            davon selbst (feste Breite, Löschen/Hinzufügen docken per Gooey-
            Effekt absolut positioniert an, siehe unten). */}
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
        </div>

        {/* Mitte: FAB-Kapsel — Kamera/Pause-Button immer sichtbar, roter Löschen-
            (links) und grüner Hinzufügen-Button (rechts) erscheinen animiert
            daneben, sobald nutzbar. Zwei übereinanderliegende Schichten mit
            identischem Slot-Raster: eine geblurrte "Rahmen"-Schicht (dunkle
            Kreise, etwas größer als die Buttons) darunter erzeugt per Gooey-
            Effekt den Eindruck von drei überlappenden, ineinander übergehenden
            Kreisen — die eigentlichen Buttons obendrüber bleiben scharf und in
            ihren normalen Farben (Rot/Grün/Lila), keine Weichzeichnung auf den
            Buttons selbst. */}
        <div
          className="relative flex items-center justify-center transition-all duration-300"
          style={{ marginTop: -20, width: FRAME_SIZE_CAM, height: FRAME_SIZE_CAM }}
        >
          {/* SVG-Goo-Filter statt CSS blur+contrast — sauberere, kontrolliertere
              Metaball-Verschmelzung (klassische "Gooey"-Technik). */}
          <svg width="0" height="0" style={{ position: 'absolute' }}>
            <defs>
              <filter id="fab-goo">
                <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
                <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" result="goo" />
              </filter>
            </defs>
          </svg>
          {/* Rahmen-Schicht — verschmilzt per Goo-Filter zu einer Form. Löschen-
              und Hinzufügen-Kreis docken ABSOLUT links/rechts an den Kamera-
              Kreis an, statt als Flex-Geschwister Breite einzunehmen — so
              bleibt die Kapsel (und damit der Kamera-Button) immer exakt
              FRAME_SIZE_CAM breit und dadurch stets zentriert, unabhängig
              davon, ob gerade 0, 1 oder 2 Zusatz-Buttons sichtbar sind. */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ filter: 'url(#fab-goo)' }}
          >
            <div
              className="absolute top-1/2 rounded-full"
              style={{
                width: FRAME_SIZE, height: FRAME_SIZE, right: '100%', marginRight: 6,
                transform: `translateY(-50%) scale(${scanState.canDelete ? 1 : 0})`,
                opacity: scanState.canDelete ? 1 : 0,
                background: 'rgba(0,0,0,0.55)',
                transition: 'transform 280ms cubic-bezier(.34,1.56,.64,1), opacity 220ms ease',
              }}
            />
            <div className="rounded-full" style={{ width: FRAME_SIZE_CAM, height: FRAME_SIZE_CAM, background: 'rgba(0,0,0,0.55)' }} />
            <div
              className="absolute top-1/2 rounded-full"
              style={{
                width: FRAME_SIZE, height: FRAME_SIZE, left: '100%', marginLeft: 6,
                transform: `translateY(-50%) scale(${scanState.canAdd ? 1 : 0})`,
                opacity: scanState.canAdd ? 1 : 0,
                background: 'rgba(0,0,0,0.55)',
                transition: 'transform 280ms cubic-bezier(.34,1.56,.64,1), opacity 220ms ease',
              }}
            />
          </div>

          {/* Icon-Schicht — scharf, Originalfarben, ebenfalls absolut angedockt */}
          <div
            className="absolute top-1/2 flex items-center justify-center overflow-visible"
            style={{
              width: FRAME_SIZE, height: FRAME_SIZE, right: '100%', marginRight: 6,
              opacity: scanState.canDelete ? 1 : 0,
              transform: `translateY(-50%) scale(${scanState.canDelete ? 1 : 0.4})`,
              transition: 'opacity 220ms ease, transform 280ms cubic-bezier(.34,1.56,.64,1)',
              pointerEvents: scanState.canDelete ? 'auto' : 'none',
            }}
          >
            <button
              onClick={() => window.dispatchEvent(new Event(SCAN_REMOVE_EVENT))}
              aria-label="Aus Sammlung entfernen"
              className="flex items-center justify-center rounded-full shadow-xl"
              style={{ width: 56, height: 56, background: '#ef4444' }}
            >
              <Minus size={26} color="#fff" strokeWidth={3} />
            </button>
          </div>
          <button
            onClick={handleFabClick}
            className="relative flex items-center justify-center rounded-full shadow-xl"
            style={{ ...fabStyle, width: FAB_SIZE, height: FAB_SIZE, marginTop: 0, background: scannerCameraColor }}
            aria-label={scanState.paused ? 'Stream fortsetzen' : 'Stream pausieren'}
          >
            <FabIcon size={28} color={fabIconColor} fill={!scanState.paused ? '#fff' : 'none'} />
          </button>
          <div
            className="absolute top-1/2 flex items-center justify-center overflow-visible"
            style={{
              width: FRAME_SIZE, height: FRAME_SIZE, left: '100%', marginLeft: 6,
              opacity: scanState.canAdd ? 1 : 0,
              transform: `translateY(-50%) scale(${scanState.canAdd ? 1 : 0.4})`,
              transition: 'opacity 220ms ease, transform 280ms cubic-bezier(.34,1.56,.64,1)',
              pointerEvents: scanState.canAdd ? 'auto' : 'none',
            }}
          >
            <button
              onClick={() => window.dispatchEvent(new Event(SCAN_ADD_EVENT))}
              aria-label="Zur Sammlung hinzufügen"
              className="flex items-center justify-center rounded-full shadow-xl"
              style={{ width: 56, height: 56, background: 'var(--action-add)' }}
            >
              <Plus size={26} color="#fff" strokeWidth={3} />
            </button>
          </div>
        </div>

        {/* Rechts: reine Symmetrie-Zone (Dex/Preis sitzen jetzt unter dem
            Kartennamen in RecognizedCardLarge, Mode-Switch oben im Header). */}
        <div
          className="flex-1 flex justify-end items-end relative"
          style={{ paddingRight: 16, paddingBottom: 10, alignSelf: 'stretch' }}
        />
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
