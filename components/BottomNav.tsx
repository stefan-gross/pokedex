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
  // Glas-Tab-Bar auf allen Screens mit buntem Verlaufs-Hintergrund — das ist
  // inzwischen jede Route außer /scanner (eigenes dunkles Kamera-Chrome),
  // siehe GlassBackground.tsx / app/(app)/layout.tsx.
  const isHome = !isScanner;

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
  // Scanner-Aktionsknöpfe: getöntes Glas statt deckender Flächen (Handoff
  // design_handoff_scanner_glass, "Aktions-Buttons") — Kamera lila (primär,
  // am größten), Löschen rot, Hinzufügen grün. Gemeinsames Rezept: blur(10px)
  // saturate(1.4), helle Lichtkante, farbiger Glow.
  const SCAN_CAM_SIZE = 82;
  const SCAN_SIDE_SIZE = 66;
  const SCAN_GAP = 26;
  const scanGlassBase: React.CSSProperties = {
    backdropFilter: 'blur(10px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
    borderRadius: 999,
  };
  const scanCameraStyle: React.CSSProperties = {
    ...scanGlassBase,
    width: SCAN_CAM_SIZE, height: SCAN_CAM_SIZE,
    background: 'rgba(139,92,246,0.82)',
    border: '1.5px solid rgba(255,255,255,0.5)',
    boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.6), 0 0 26px rgba(139,92,246,0.55), 0 6px 20px rgba(0,0,0,0.4)',
  };
  const scanDeleteStyle: React.CSSProperties = {
    ...scanGlassBase,
    width: SCAN_SIDE_SIZE, height: SCAN_SIDE_SIZE,
    background: 'rgba(239,68,68,0.82)',
    border: '1.5px solid rgba(255,255,255,0.45)',
    boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.55), 0 6px 18px rgba(200,40,40,0.45)',
  };
  const scanAddStyle: React.CSSProperties = {
    ...scanGlassBase,
    width: SCAN_SIDE_SIZE, height: SCAN_SIDE_SIZE,
    background: 'rgba(34,197,94,0.82)',
    border: '1.5px solid rgba(255,255,255,0.45)',
    boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.55), 0 6px 18px rgba(20,150,70,0.45)',
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

        {/* Mitte: drei unabhängige getönte Glas-Kreise (Handoff
            design_handoff_scanner_glass) — Kamera/Pause-Button immer
            sichtbar, roter Löschen- (links) und grüner Hinzufügen-Button
            (rechts) erscheinen animiert daneben, sobald nutzbar. Kein
            Rahmen/Goo mehr dahinter — jeder Kreis trägt sein eigenes
            getöntes Glas mit Lichtkante + farbigem Glow. */}
        <div
          className="relative flex items-center justify-center transition-all duration-300"
          style={{ marginTop: -20, width: SCAN_CAM_SIZE, height: SCAN_CAM_SIZE }}
        >
          <div
            className="absolute top-1/2 flex items-center justify-center overflow-visible"
            style={{
              width: SCAN_SIDE_SIZE, height: SCAN_SIDE_SIZE, right: '100%', marginRight: SCAN_GAP,
              opacity: scanState.canDelete ? 1 : 0,
              transform: `translateY(-50%) scale(${scanState.canDelete ? 1 : 0.4})`,
              transition: 'opacity 220ms ease, transform 280ms cubic-bezier(.34,1.56,.64,1)',
              pointerEvents: scanState.canDelete ? 'auto' : 'none',
            }}
          >
            <button
              onClick={() => window.dispatchEvent(new Event(SCAN_REMOVE_EVENT))}
              aria-label="Aus Sammlung entfernen"
              className="flex items-center justify-center"
              style={scanDeleteStyle}
            >
              <Minus size={28} color="#fff" strokeWidth={3} />
            </button>
          </div>
          <button
            onClick={handleFabClick}
            className="relative flex items-center justify-center"
            style={scanCameraStyle}
            aria-label={scanState.paused ? 'Stream fortsetzen' : 'Stream pausieren'}
          >
            <FabIcon size={34} color={fabIconColor} fill={!scanState.paused ? '#fff' : 'none'} />
          </button>
          <div
            className="absolute top-1/2 flex items-center justify-center overflow-visible"
            style={{
              width: SCAN_SIDE_SIZE, height: SCAN_SIDE_SIZE, left: '100%', marginLeft: SCAN_GAP,
              opacity: scanState.canAdd ? 1 : 0,
              transform: `translateY(-50%) scale(${scanState.canAdd ? 1 : 0.4})`,
              transition: 'opacity 220ms ease, transform 280ms cubic-bezier(.34,1.56,.64,1)',
              pointerEvents: scanState.canAdd ? 'auto' : 'none',
            }}
          >
            <button
              onClick={() => window.dispatchEvent(new Event(SCAN_ADD_EVENT))}
              aria-label="Zur Sammlung hinzufügen"
              className="flex items-center justify-center"
              style={scanAddStyle}
            >
              <Plus size={28} color="#fff" strokeWidth={3} />
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

  // ── Home: schwebende Glas-Tab-Bar (iOS "Liquid Glass") ──────────────────
  // Nur auf `/`, da der Glas-Look einen bunten Verlaufs-Hintergrund dahinter
  // braucht (existiert nur auf dem Dashboard). Andere Routen behalten die
  // normale bg-card-Leiste weiter unten.
  if (isHome) {
    const homeFabStyle: React.CSSProperties = {
      width: 70,
      height: 70,
      marginTop: -30,
      borderRadius: 999,
      flexShrink: 0,
      background: 'rgba(229,62,62,0.82)',
      backdropFilter: 'blur(10px) saturate(1.4)',
      WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
      border: '1.5px solid rgba(255,255,255,0.5)',
      boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.65), 0 6px 20px rgba(220,38,38,0.5)',
    };
    return (
      <nav
        className="fixed z-50 grid items-center justify-items-center glass"
        style={{
          bottom: 12, left: 14, right: 14, height: 64,
          borderRadius: 26,
          gridTemplateColumns: 'repeat(5, 1fr)',
          backdropFilter: 'blur(28px) saturate(1.55)',
          WebkitBackdropFilter: 'blur(28px) saturate(1.55)',
        }}
      >
        {navItems.map((item, i) => {
          if (item === null) {
            return (
              <div key="fab" className="relative flex items-center justify-center" style={{ width: FAB_SIZE }}>
                <Link
                  href="/scanner"
                  className="flex items-center justify-center"
                  style={homeFabStyle}
                  aria-label="Karte scannen"
                >
                  <Camera size={28} color="#fff" />
                </Link>
              </div>
            );
          }
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center gap-0.5 px-3 min-w-[56px] text-[#1E2024] dark:text-white"
              style={{ opacity: active ? 1 : 0.75 }}
            >
              <Icon size={22} strokeWidth={active ? 2.6 : 1.8} fill={active ? 'currentColor' : 'none'} />
              <span className="text-[10px]" style={{ fontWeight: active ? 700 : 500 }}>{item.label}</span>
            </Link>
          );
        })}
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
