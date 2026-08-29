'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, Archive, Heart, Camera, Pause, LayoutGrid, Square, Layers } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ButtonGroup } from '@/components/ui/button-group';

const FAB_SIZE = 72;

const navItems = [
  { href: '/', icon: Home, label: 'Home' },
  { href: '/collection', icon: Search, label: 'Suchen' },
  null, // FAB placeholder
  { href: '/binders', icon: Archive, label: 'Meine Karten' },
  { href: '/wishlist', icon: Heart, label: 'Wunschliste' },
];

// Auf /scanner werden Slot 2 + 4 mit Scanner-Controls überschrieben.
// Diese Events werden von app/(app)/scanner/page.tsx behandelt.
const SCAN_TOGGLE_EVENT       = 'scanner-toggle-pause';
const SCAN_GRID_TOGGLE_EVENT  = 'scanner-toggle-grid';
const SCAN_MODE_TOGGLE_EVENT  = 'scanner-toggle-mode';
const SCAN_STATE_EVENT        = 'scanner-state-changed';
const SCAN_CAPTURE_TOGGLE_EVENT = 'scanner-toggle-capture';  // Auto ⇄ Manuell
const SCAN_SHUTTER_EVENT        = 'scanner-shutter';         // Manueller Auslöser (Foto)

interface ScannerNavState {
  paused: boolean;        // Stream pausiert?
  scanMode: 'add' | 'recognize';
  captureMode?: 'auto' | 'manual'; // Auslöse-Modus: Auto-Trigger vs. manuell (Foto per FAB)
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
    captureMode: 'auto',
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

  // FAB-Style: lila getöntes Glas, ragt deutlich oben aus der Nav heraus —
  // identisch zum Kamera-Button im Scanmodus (scanCameraStyle).
  const fabStyle: React.CSSProperties = {
    width: FAB_SIZE,
    height: FAB_SIZE,
    marginTop: -20,
    flexShrink: 0,
    background: 'rgba(139,92,246,0.85)',
    backdropFilter: 'blur(10px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
    border: '1.5px solid rgba(255,255,255,0.5)',
    boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.6), 0 0 26px rgba(139,92,246,0.55), 0 6px 20px rgba(0,0,0,0.4)',
  };
  // Scanner-Aktionsleiste "12a" (Handoff design_handoff_scanner_bar):
  // schwebende Glas-Leiste im Footernav-Stil, Kamera als überstehender FAB
  // in der Mitte (lila, getöntes Glas, identisch zum Home-FAB-Rezept),
  // −/+ als reine getönte Icons ohne Kreisfläche links/rechts.
  const SCAN_CAM_SIZE = 70;
  const scanCameraStyle: React.CSSProperties = {
    width: SCAN_CAM_SIZE, height: SCAN_CAM_SIZE,
    marginTop: -30,
    borderRadius: 999,
    background: 'rgba(139,92,246,0.85)',
    backdropFilter: 'blur(10px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
    border: '1.5px solid rgba(255,255,255,0.5)',
    boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.6), 0 0 26px rgba(139,92,246,0.55), 0 6px 20px rgba(0,0,0,0.4)',
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

  const isManual = isScanner && scanState.captureMode === 'manual';

  // Klick-Handler für FAB.
  //  - Manuell + Ergebnis sichtbar (pausiert): zurück in den Kamera-Modus (Resume).
  //  - Manuell + Kamera läuft: Foto auslösen.
  //  - Auto: Stream Pause/Resume wie bisher.
  const handleFabClick = () => {
    if (isScanner) {
      if (isManual && !scanState.paused) window.dispatchEvent(new Event(SCAN_SHUTTER_EVENT));
      else window.dispatchEvent(new Event(SCAN_TOGGLE_EVENT));
    }
    // Off-Scanner: Link-Navigation, kein Handler nötig (Next.js Link)
  };

  const fabIconColor = '#fff';
  // Off-Scanner: Kamera-Icon. Auf /scanner: Pause wenn laufend, Kamera wenn pausiert.
  // Manuell → immer Kamera (Auslöser). Auto → Pause (läuft) / Kamera (pausiert).
  const FabIcon = !isScanner ? Camera : (isManual ? Camera : (scanState.paused ? Camera : Pause));

  // ── Scanner-Modus: schwebende Glas-Leiste "12a" (Handoff
  // design_handoff_scanner_bar) — Footernav-Stil, 3 Spalten: −-Icon links,
  // Kamera als überstehender FAB in der Mitte, +-Icon rechts. Ersetzt die
  // vorherige freischwebende Kreis-Kapsel. Grid-Button (Mehrere-Modus-
  // Übersicht) sitzt als eigener kleiner Glas-Chip über der Leiste, da er
  // im 12a-Handoff nicht Teil der 3-Spalten-Leiste ist. */}
  if (isScanner) {
    return (
      <>
        {scanState.gridVisible && (
          <button
            onClick={() => window.dispatchEvent(new Event(SCAN_GRID_TOGGLE_EVENT))}
            className="fixed z-50 flex items-center justify-center rounded-full glass-overlay"
            aria-label="Übersicht öffnen"
            style={{ bottom: 90, left: 14, width: 44, height: 44 }}
          >
            <LayoutGrid size={19} color="#fff" />
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

        <nav
          className="fixed z-50 flex items-center justify-center"
          style={{
            bottom: 14, left: 14, right: 14, height: 64,
            borderRadius: 26,
            background: 'rgba(255,255,255,0.12)',
            backdropFilter: 'blur(28px) saturate(1.6)',
            WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
            border: '1px solid rgba(255,255,255,0.22)',
            boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.3), 0 8px 26px rgba(0,0,0,0.42)',
          }}
        >
          {/* Einzeln/Mehrere als Design-System-ButtonGroup (iconOnly size="sm",
              spiegelbildlich zum A|M rechts) — linksbündig in der Leiste. Einzeln
              = ein Kartensymbol, Mehrere = Stapel. */}
          <div className="absolute" style={{ left: 8, top: '50%', transform: 'translateY(-50%)' }}>
            <ButtonGroup
              iconOnly
              size="md"
              toggle
              value={scanState.scanMode}
              onChange={(v) => window.dispatchEvent(new CustomEvent(SCAN_MODE_TOGGLE_EVENT, { detail: v }))}
              options={[
                { value: 'recognize', label: <Square size={17} />, ariaLabel: 'Einzelscan' },
                { value: 'add',       label: <Layers size={17} />, ariaLabel: 'Mehrfachscan' },
              ]}
            />
          </div>

          {/* Mittig: nur der Scan-FAB. Karten-Aktionen (Hinzufügen/Entfernen)
              leben jetzt im Kartenblatt (RecognizedAddBar) — der Footer ist rein
              zum Scannen/Navigieren. Auto = Pause/Weiter, Manuell = Auslöser. */}
          <div className="flex items-center">
            <button
              onClick={handleFabClick}
              className="flex items-center justify-center transition-transform duration-150 active:scale-90"
              style={scanCameraStyle}
              aria-label={isManual ? (scanState.paused ? 'Weiter scannen' : 'Foto aufnehmen') : (scanState.paused ? 'Stream fortsetzen' : 'Stream pausieren')}
            >
              <FabIcon size={30} color={fabIconColor} fill={!isManual && !scanState.paused ? '#fff' : 'none'} />
            </button>
          </div>

          {/* Auto/Manuell als Design-System-ButtonGroup (iconOnly size="md",
              Gooey-Indikator wie der Set-Ansicht-Umschalter im Dashboard) —
              rechtsbündig innerhalb der Leiste, vertikal zentriert. Manuell =
              FAB wird zum Foto-Auslöser. */}
          <div className="absolute" style={{ right: 8, top: '50%', transform: 'translateY(-50%)' }}>
            <ButtonGroup
              iconOnly
              size="md"
              toggle
              value={scanState.captureMode ?? 'auto'}
              onChange={(v) => window.dispatchEvent(new CustomEvent(SCAN_CAPTURE_TOGGLE_EVENT, { detail: v }))}
              options={[
                { value: 'auto',   label: <span className="text-sm font-bold">A</span>, ariaLabel: 'Automatisch' },
                { value: 'manual', label: <span className="text-sm font-bold">M</span>, ariaLabel: 'Manuell' },
              ]}
            />
          </div>
        </nav>
      </>
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
      background: 'rgba(139,92,246,0.85)',
      backdropFilter: 'blur(10px) saturate(1.4)',
      WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
      border: '1.5px solid rgba(255,255,255,0.5)',
      boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.6), 0 0 26px rgba(139,92,246,0.55), 0 6px 20px rgba(0,0,0,0.4)',
    };
    return (
      <nav
        className="fixed z-50 grid items-center justify-items-center glass"
        style={{
          bottom: 12, left: 14, right: 14, height: 64,
          borderRadius: 26,
          gridTemplateColumns: 'repeat(5, 1fr)',
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
              className="flex flex-col items-center gap-0.5 px-3 min-w-[56px] text-glass"
              style={{ opacity: active ? 1 : 0.75 }}
            >
              <Icon
                size={22}
                strokeWidth={active ? 2 : 1.8}
                fill={active ? 'var(--pokedex-blue)' : 'none'}
                color={active ? '#fff' : undefined}
              />
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
                  aria-label={isManual ? 'Foto aufnehmen' : (scanState.paused ? 'Stream fortsetzen' : 'Stream pausieren')}
                >
                  <FabIcon size={28} color={fabIconColor} fill={!isManual && !scanState.paused && isScanner ? '#fff' : 'none'} />
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
        if (isScanner && i === 0) {
          // Home-Slot links: leer (nur Scanner-Controls sichtbar)
          return <div key={`scan-empty-${i}`} />;
        }
        if (isScanner && i === 4) {
          // Rechter Slot: Auto ⇄ Manuell-Switch (Auslöse-Modus)
          return (
            <button
              key={`scan-${i}`}
              onClick={() => window.dispatchEvent(new CustomEvent(SCAN_CAPTURE_TOGGLE_EVENT, { detail: isManual ? 'auto' : 'manual' }))}
              className="flex flex-col items-center gap-1"
              role="switch"
              aria-checked={isManual}
              aria-label="Manueller Auslöser"
            >
              <span
                className="relative rounded-full transition-colors"
                style={{ width: 42, height: 25, background: isManual ? '#3182ce' : 'rgba(255,255,255,0.28)' }}
              >
                <span
                  className="absolute rounded-full bg-white transition-all"
                  style={{ width: 19, height: 19, top: 3, left: isManual ? 20 : 3 }}
                />
              </span>
              <span className="text-[10px] font-medium" style={{ color: isManual ? '#fff' : 'rgba(255,255,255,0.7)' }}>
                {isManual ? 'Manuell' : 'Auto'}
              </span>
            </button>
          );
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
        // Label bleibt in der normalen Textfarbe (aktiv: kräftig, sonst gedimmt);
        // der aktive Zustand steckt in der gefüllten blauen Icon-Pille (weißes Icon).
        const labelColor = isScanner
          ? (active ? '#fff' : 'rgba(255,255,255,0.65)')
          : (active ? 'var(--foreground)' : 'var(--muted-foreground)');
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-col items-center gap-0.5 px-3 min-w-[56px]"
            style={{ color: labelColor, paddingBottom: 6, paddingTop: 4 }}
          >
            <Icon
              size={22}
              strokeWidth={active ? 2 : 1.8}
              fill={active ? 'var(--pokedex-blue)' : 'none'}
              color={active ? '#fff' : undefined}
            />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// Exportiert für Scanner-Page, um State zu posten
export const SCANNER_NAV_EVENTS = {
  TOGGLE_PAUSE:   SCAN_TOGGLE_EVENT,
  TOGGLE_GRID:    SCAN_GRID_TOGGLE_EVENT,
  TOGGLE_MODE:    SCAN_MODE_TOGGLE_EVENT,
  TOGGLE_CAPTURE: SCAN_CAPTURE_TOGGLE_EVENT,
  SHUTTER:        SCAN_SHUTTER_EVENT,
  STATE:          SCAN_STATE_EVENT,
};
export type { ScannerNavState };
