'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, Trash2, Loader2, AlertCircle, Check, Plus, ChevronLeft, AlertTriangle, EyeOff, SearchX, LayoutGrid, Square, Flag, Bug } from 'lucide-react';
import { CameraCapture } from '@/components/scanner/CameraCapture';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { AddToCollectionModal } from '@/components/scanner/AddToCollectionModal';
import { getCardBySetCodeAndNumberRest as getCardBySetCodeAndNumber,
         getCardsByDexNumberRest      as getCardsByDexNumber,
         getCardsByNameAndNumberRest  as getCardsByNameAndNumber } from '@/lib/firestore/catalog-rest';
import { addCard, getCardsByTcgId } from '@/lib/firestore/cards';
import { addCardToBinder, ensureDefaultBinder, ensureInboxBinder } from '@/lib/firestore/binders';
import { BulkAddToCollectionModal } from '@/components/scanner/BulkAddToCollectionModal';
import { CardPrice } from '@/components/card/CardPrice';
import { ValueBadge } from '@/components/card/ValueBadge';
import { catalogCardToInfo } from '@/lib/card-info';
import type { CardInfo } from '@/lib/card-info';
import type { CardCondition as PersistedCondition, CardDoc, CardLanguage, CardVariant } from '@/types';
import { CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';

// Gemini liefert Condition in Kurzform (lowercase). Für Persistence wird in
// die offizielle CardCondition (uppercase) gemappt.
export type CardCondition = 'nm' | 'lp' | 'mp' | 'hp' | 'd';

const GEMINI_TO_PERSISTED: Record<CardCondition, PersistedCondition> = {
  nm: 'NM', lp: 'LP', mp: 'MP', hp: 'HP', d: 'Poor',
};

// Fake-Risk → Border-Color der Tile
const FAKE_RISK_BORDER: Record<'low' | 'medium' | 'high', string> = {
  low:    'rgba(72,187,120,.70)',
  medium: 'rgba(234,179,8,.70)',
  high:   'rgba(239,68,68,.80)',
};

const PERSISTED_CONDITION_COLOR: Record<PersistedCondition, { bg: string; text: string }> = {
  NM:   { bg: 'rgba(34,197,94,.85)',  text: '#fff' },
  LP:   { bg: 'rgba(132,204,22,.85)', text: '#fff' },
  MP:   { bg: 'rgba(234,179,8,.85)',  text: '#000' },
  HP:   { bg: 'rgba(249,115,22,.85)', text: '#fff' },
  Poor: { bg: 'rgba(239,68,68,.85)',  text: '#fff' },
};

interface GeminiResponse {
  setCode?: string;                      // gedrucktes Set-Kürzel (z.B. "ASC", "SSP")
  number?: string;
  name?: string;                         // gedruckter Karten-Name (Pokémon/Trainer/Energy)
  language?: string;
  confidence?: string;
  nationalDexNumber?: number | null;
  condition?: CardCondition;
  fakeRisk?: 'low' | 'medium' | 'high';
  fakeReasons?: string[];
  error?: string;
  // Debug-Info zum Schritt-2-Symbolabgleich — IMMER gesetzt (auch wenn nicht ausgelöst),
  // damit im Debug-Modal sichtbar ist, warum ein Match ggf. nicht versucht wurde.
  _symbolMatch?: {
    triggered: boolean;
    reason?: string;                       // gesetzt wenn triggered=false
    error?: string;                        // gesetzt wenn Schritt 2 fehlgeschlagen ist
    matchedSetCode?: string | null;
    rejectedMatch?: string;                // gesetzt wenn Gemini einen Code lieferte, der auf keinem Blatt existiert
    matchConfidence?: string | null;
    matchAmbiguous?: boolean;
    sheetsUsed?: string[];
    sheetBuildMs?: number;                 // Kaltstart-Kosten (Icon-Fetch + Sharp-Komposition)
    model?: string;
    ms?: number;                           // reine Gemini-Zeit für Schritt 2
    rawText?: string;
  };
}

interface ScanState {
  card: CardInfo | null;
  language: CardLanguage;
  variant?: CardVariant;
  ownedCount?: number;
  condition?: CardCondition;
  fakeRisk?: 'low' | 'medium' | 'high';
  fakeReasons?: string[];
}

interface ScanDebug {
  imageBase64?: string;          // Bild das an Gemini geschickt wurde
  mimeType?: string;
  imageSizeKb?: number;
  geminiModel?: string;          // Welches Gemini-Modell hat geantwortet
  geminiMs?: number;             // Reines Gemini-Modell (server-gemessen)
  uploadMs?: number;             // Wire-Time: fetch-Roundtrip minus Gemini-Modell
  lookupMs?: number;             // Catalog-Lookups (setCode/number + dexNr-Fallback)
  ownedMs?: number;              // getCardsByTcgId Owned-Count (asynchron)
  totalMs?: number;              // Gesamtdauer Scan→Render (ohne ownedMs)
  geminiRaw?: string;            // Rohantwort von Gemini (vor JSON-Parse)
  geminiParsed?: unknown;        // Geparste Gemini-Antwort
  lookupSteps?: string[];        // Welche DB-Lookups wurden probiert
  catalogMatch?: { id: string; name: string; setId: string; number: string } | null;
  error?: string;
}

interface ScanJob {
  id: string;
  origin: 'add' | 'recognize';   // aus welchem Modus stammt der Snap — steuert Slider/Review-Sichtbarkeit
  status: 'processing' | 'done' | 'error';
  result: ScanState | null;
  added?: boolean;
  debugInfo?: string;           // Kurz-Status (z.B. unten am Thumbnail)
  debug?: ScanDebug;            // Detail-Debug für Modal (enthält imageBase64 als einzige Quelle)
  // User-bearbeitbare Felder (initialisiert aus Gemini-Result, danach Pill-Editierbar)
  editedVariant?:   CardVariant;
  editedCondition?: PersistedCondition;
  // Slider-Markierung (User-Tap im Stapel-Scan = "bitte später nochmal prüfen")
  flaggedManual?: boolean;
  // Bild-Verifikation per pHash (kommt mit Phase 5) — niedrig=match, hoch=mismatch
  pHashDistance?: number;
}

type BorderStatus = 'none' | 'manual-yellow' | 'auto-yellow' | 'auto-red' | 'error';

/** Berechnet den visuellen Status (Rahmenfarbe) eines Jobs.
 *  Reihenfolge der Priorität: error > pHash-mismatch > pHash-unsure > manual-flag > none. */
function computeBorderStatus(job: ScanJob): BorderStatus {
  if (job.status === 'error') return 'error';
  const dist = job.pHashDistance;
  if (typeof dist === 'number') {
    if (dist >= 20) return 'auto-red';
    if (dist >= 12) return 'auto-yellow';
  }
  if (job.flaggedManual) return 'manual-yellow';
  return 'none';
}

/** Rahmen-Farbe und -Breite für ein Tile abhängig vom BorderStatus. */
function borderStyleFor(status: BorderStatus, fakeRisk?: string): { border: string } {
  if (status === 'auto-red')                     return { border: '2.5px solid #ef4444' };
  if (status === 'auto-yellow' || status === 'manual-yellow') return { border: '2.5px solid #facc15' };
  if (fakeRisk) {
    const c = (fakeRisk in FAKE_RISK_BORDER) ? FAKE_RISK_BORDER[fakeRisk as keyof typeof FAKE_RISK_BORDER] : 'rgba(255,255,255,0.15)';
    return { border: `2.5px solid ${c}` };
  }
  return { border: '2.5px solid rgba(255,255,255,0.15)' };
}

function cardImgUrl(job: ScanJob): string | null {
  // Während Verarbeitung: aufgenommenes Bild als Vorschau zeigen
  // (Image base64 ist die einzige Quelle — kein Duplikat im State).
  if (job.status === 'processing' && job.debug?.imageBase64)
    return `data:${job.debug.mimeType ?? 'image/jpeg'};base64,${job.debug.imageBase64}`;
  const card = job.result?.card;
  if (!card) return null;
  const lang = job.result?.language ?? 'en';
  // DE-First: gespeicherte DE-Bild-URL aus dem Catalog nehmen (Enrichment-
  // Output). Vorherige Lösung baute on-the-fly tcgdex-URLs — 404 bei Sets
  // ohne DE-Assets (z.B. Pokémon TCG Classic `me2pt5`). Fallback EN.
  if (lang === 'de' && card.imgSmallDe) return card.imgSmallDe;
  return card.imgSmall ?? null;
}

/** Wie cardImgUrl, aber bevorzugt imgLarge*-URLs für die zentrale
 *  Erkennen-Anzeige (~600 px Höhe sonst sichtbar unscharf). */
function cardImgUrlLarge(job: ScanJob): string | null {
  if (job.status === 'processing' && job.debug?.imageBase64)
    return `data:${job.debug.mimeType ?? 'image/jpeg'};base64,${job.debug.imageBase64}`;
  const card = job.result?.card;
  if (!card) return null;
  const lang = job.result?.language ?? 'en';
  if (lang === 'de' && card.imgLargeDe) return card.imgLargeDe;
  if (card.imgLarge) return card.imgLarge;
  if (lang === 'de' && card.imgSmallDe) return card.imgSmallDe;
  return card.imgSmall ?? null;
}

/** Klassifiziert einen Error-Job und gibt thematische Karten-Daten zurück.
 *  Wird sowohl vom großen Error-Sheet (Einzelmodus) als auch von der
 *  Mini-Error-Karte im Review-Grid genutzt. */
type ErrorKind = 'gemini-blind' | 'gemini-thin' | 'catalog-miss' | 'non-western';
interface ErrorClass {
  kind: ErrorKind;
  Icon: typeof EyeOff;
  iconColor: string;
  cardName: string;
  attackTitle: string;
  attackText: string;
}
function classifyJobError(job: ScanJob): ErrorClass {
  const gp = job.debug?.geminiParsed as
    | { error?: string; setCode?: string | null; number?: string | null;
        language?: string; nationalDexNumber?: number | null }
    | undefined;
  const lang = gp?.language;
  const isNonWestern = lang && !['de', 'en', 'fr', 'es', 'it', 'pt'].includes(lang);

  if (gp?.error || job.debug?.error === 'No card detected') {
    return {
      kind: 'gemini-blind',
      Icon: EyeOff,
      iconColor: '#facc15',
      cardName: 'Blindfish',
      attackTitle: 'Keine Karte im Bild',
      attackText: 'Halte die Karte deutlicher in den Rahmen.',
    };
  }
  if (!gp?.setCode && !gp?.number && !gp?.nationalDexNumber) {
    return {
      kind: 'gemini-thin',
      Icon: AlertTriangle,
      iconColor: '#fb923c',
      cardName: 'Glitchmander',
      attackTitle: 'Karten-Text unlesbar',
      attackText: 'Beleuchte die Karte stärker oder rücke näher heran.',
    };
  }
  if (isNonWestern) {
    return {
      kind: 'non-western',
      Icon: AlertTriangle,
      iconColor: '#fb923c',
      cardName: 'Errorchu',
      attackTitle: `Nicht-Western-Karte (${lang?.toUpperCase()})`,
      attackText: lang === 'ja'
        ? 'Japanische Karten nutzen ein eigenes Code-System und sind im Katalog nicht enthalten.'
        : 'Der Katalog enthält aktuell nur Western-Sets (DE/EN/FR/ES/IT/PT).',
    };
  }
  return {
    kind: 'catalog-miss',
    Icon: SearchX,
    iconColor: '#f87171',
    cardName: 'Errorchu',
    attackTitle: 'Im Katalog nicht gefunden',
    attackText: 'Möglicherweise ein Set, das noch nicht synchronisiert wurde. Versuche es nochmal oder synchronisiere die Daten.',
  };
}

/** Inline-SVG-Artwork „MissingNo." — pixelated Glitch-Pokémon-Silhouette als
 *  Error-Karten-Artwork. Skaliert via `size`. */
function MissingNoArtwork({ size = 96, color = '#1a1a1a', tint = '#ef4444' }: { size?: number; color?: string; tint?: string }) {
  // 16×16 Pixel-Grid — Pokémon-artige Form mit Glitch-Streifen.
  // 0 = leer, 1 = Hauptkörper, 2 = Glitch-Akzent (rot)
  const grid: number[][] = [
    [0,0,0,0,1,1,1,1,1,1,1,0,0,0,0,0],
    [0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0],
    [0,0,1,1,2,2,1,1,1,2,2,1,1,1,0,0],
    [0,1,1,1,2,2,1,1,1,2,2,1,1,1,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,1,1,1,1,1,2,2,2,2,1,1,1,1,1,0],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,2,2,2,2,2,2,2,2,2,2,2,2,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,2,2,2,2,2,2,2,2,1,1,1,1],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,0,1,1,1,1,0,0,0,0,1,1,1,1,0,0],
    [0,0,1,1,1,0,0,0,0,0,0,1,1,1,0,0],
    [0,0,1,1,0,0,0,0,0,0,0,0,1,1,0,0],
    [0,1,1,1,0,0,0,0,0,0,0,0,1,1,1,0],
  ];
  const cells: React.ReactElement[] = [];
  const cell = size / 16;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const v = grid[y][x];
      if (v === 0) continue;
      cells.push(
        <rect
          key={`${x}-${y}`}
          x={x * cell}
          y={y * cell}
          width={cell}
          height={cell}
          fill={v === 2 ? tint : color}
        />
      );
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      {cells}
    </svg>
  );
}

export default function ScannerPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeOwnedCopies, setActiveOwnedCopies] = useState<CardDoc[]>([]);
  const [debugJobId, setDebugJobId] = useState<string | null>(null);
  const [mode, setMode] = useState<'scanning' | 'review'>('scanning');
  // Review-Modus-Ansichten: grid (Default, 2-Spalten) / single (eine Karte groß + Swipe)
  const [viewMode, setViewMode] = useState<'grid' | 'single'>('grid');
  // Status-Filter im Review: alle / erfolgreich (kein Rahmen) / gelb / rot+error
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'yellow' | 'red'>('all');
  // Single-View-Index — welche Karte gerade angezeigt wird (0 = neueste, N-1 = älteste)
  const [singleIdx, setSingleIdx] = useState<number>(0);
  // Ref für Horizontal-Swipe-Geste im Single-View (Pointer-Start-X)
  const swipeStartXRef = useRef<number | null>(null);
  // Live-Drag-Offset während der Geste (Karte folgt dem Finger)
  const [singleDragX, setSingleDragX] = useState<number>(0);
  // Animationsphase nach Pointer-Up:
  //  'commit-next'  → Top-Panel fliegt nach rechts raus, danach idx+1
  //  'commit-prev'  → Eingehendes Prev-Panel gleitet auf 0, danach idx-1
  //  'snap-out'     → Top-Panel snappt zurück auf 0 (Right-Drag abgebrochen)
  //  'snap-in'      → Eingehendes Prev-Panel snappt zurück auf width  (Left-Drag abgebrochen)
  const [singleAnim, setSingleAnim] = useState<
    'commit-next' | 'commit-prev' | 'snap-out' | 'snap-in' | null
  >(null);
  // Index-Delta für Commit (1 = nächste, -1 = vorherige)
  const singleCommitDeltaRef = useRef<number>(0);
  // Gemessene Panel-Breite für px-genaue Translate-Berechnung der eingehenden Karte
  const [singlePanelWidth, setSinglePanelWidth] = useState<number>(0);
  const singlePanelRef = useCallback((node: HTMLDivElement | null) => {
    if (node) setSinglePanelWidth(node.offsetWidth);
  }, []);
  // Long-Press für Markieren (>= 500ms ohne signifikante Bewegung)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef<boolean>(false);
  // Scanner-Workflow: Hinzufügen (Slider-Sammlung) vs. Erkennen (Lookup-Anzeige).
  const [scanMode, setScanMode] = useState<'add' | 'recognize'>('recognize');
  // Stream-Lifecycle: Auto-Start beim Mount — der BottomNav-FAB navigiert
  // direkt hierher, der User erwartet sofort Kamera. Kein Re-Tap nötig.
  const [cameraActive, setCameraActive] = useState<boolean>(true);
  const [streamPaused, setStreamPaused] = useState(false);
  // Im Erkennen-Modus: ID des aktuell zentral angezeigten Jobs. Wird beim
  // erfolgreichen Recognize-Scan gesetzt; Resume-Tap räumt ihn zurück.
  const [recognizedJobId, setRecognizedJobId] = useState<string | null>(null);
  // Ref für scanMode — handleCapture hat empty-deps useCallback,
  // ohne Ref wäre der Wert stale.
  const scanModeRef = useRef(scanMode);
  useEffect(() => { scanModeRef.current = scanMode; }, [scanMode]);

  // Quick-Add via +-Button: öffnet AddToCollectionModal direkt (kein
  // CardDetailSheet-Zwischenschritt). preVariant/preCondition aus dem Job.
  const [quickAddJobId, setQuickAddJobId] = useState<string | null>(null);
  const quickAddJob = jobs.find(j => j.id === quickAddJobId) ?? null;

  // Fehler-Diagnose-Modal (tappbar im Slider + Review-Grid)
  const [errorDetailJobId, setErrorDetailJobId] = useState<string | null>(null);
  const errorDetailJob = jobs.find(j => j.id === errorDetailJobId) ?? null;

  // Fake-Reasons-Popup: zeigt Gemini-Begründungen warum die Karte als
  // medium/high fake-risk eingestuft wurde.
  const [fakeReasonsJobId, setFakeReasonsJobId] = useState<string | null>(null);
  const fakeReasonsJob = jobs.find(j => j.id === fakeReasonsJobId) ?? null;
  // FIFO-Queue für Uploads: parallele Scans senden nacheinander statt
  // gleichzeitig — verhindert Bandbreiten-Konkurrenz auf schwachem Mobilnetz.
  const uploadChainRef = useRef<Promise<unknown>>(Promise.resolve());

  // Slider-Ref + Auto-Scroll-to-end-Effekt: neuester Job sitzt rechts am Rand,
  // bei jedem neuen Job wird der Slider an die rechte Position gescrollt.
  const sliderRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sliderRef.current) {
      sliderRef.current.scrollTo({ left: sliderRef.current.scrollWidth, behavior: 'smooth' });
    }
  }, [jobs.length]);

  // ── BottomNav-Bridge ────────────────────────────────────────────────────
  // Stream-Pause-Toggle vom BottomNav-FAB
  const toggleStreamPaused = useCallback(() => {
    if (!cameraActive) { setCameraActive(true); setStreamPaused(false); return; }
    setStreamPaused(prev => {
      if (prev) {
        // Resume: alten Recognize-Job aufräumen
        setRecognizedJobId(null);
        setJobs(p => p.filter(j => j.origin !== 'recognize'));
        return false;
      }
      return true;
    });
  }, [cameraActive]);

  // Mode-Switch vom BottomNav
  const switchScanMode = useCallback((m: 'add' | 'recognize') => {
    setJobs(prev => prev.filter(j => j.origin !== 'recognize'));
    setRecognizedJobId(null);
    setStreamPaused(false);
    setScanMode(m);
  }, []);

  // Grid-Toggle vom BottomNav
  const toggleGridMode = useCallback(() => {
    setMode(m => m === 'scanning' ? 'review' : 'scanning');
  }, []);

  // Events vom BottomNav abonnieren
  useEffect(() => {
    const onTogglePause = () => toggleStreamPaused();
    const onToggleMode  = (e: Event) => {
      const m = (e as CustomEvent<'add' | 'recognize'>).detail;
      if (m) switchScanMode(m);
    };
    const onToggleGrid  = () => toggleGridMode();
    window.addEventListener('scanner-toggle-pause', onTogglePause);
    window.addEventListener('scanner-toggle-mode',  onToggleMode as EventListener);
    window.addEventListener('scanner-toggle-grid',  onToggleGrid);
    return () => {
      window.removeEventListener('scanner-toggle-pause', onTogglePause);
      window.removeEventListener('scanner-toggle-mode',  onToggleMode as EventListener);
      window.removeEventListener('scanner-toggle-grid',  onToggleGrid);
    };
  }, [toggleStreamPaused, switchScanMode, toggleGridMode]);

  // State an BottomNav schicken — paused/scanMode/jobsCount/gridVisible/reviewMode
  const addJobsCount = jobs.filter(j => j.origin === 'add').length;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('scanner-state-changed', {
      detail: {
        paused: streamPaused,
        scanMode,
        jobsCount: addJobsCount,
        gridVisible: scanMode === 'add' && addJobsCount > 0,
        reviewMode: mode === 'review',
      },
    }));
  }, [streamPaused, scanMode, addJobsCount, mode]);

  // Beim Unmount: Reset, damit andere Seiten nicht den Scan-Pause-FAB sehen
  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent('scanner-state-changed', {
        detail: { paused: false, scanMode: 'recognize', jobsCount: 0, gridVisible: false, reviewMode: false },
      }));
    };
  }, []);

  const debugJob = jobs.find(j => j.id === debugJobId) ?? null;

  const pendingCount = jobs.filter(j => j.status === 'processing').length;
  const doneJobs = jobs.filter(j => j.status === 'done' && j.result?.card);
  const activeJob = jobs.find(j => j.id === activeJobId) ?? null;

  // ── Memory-Wächter ─────────────────────────────────────────────────────────
  // Zählt unerledigte Add-Jobs (noch nicht in Sammlung übernommen). Ab 30 →
  // Warn-Banner; ab 40 → kritisch + Auto-Pause des Streams. Hysterese: erst
  // wenn < 25 wieder unten → Stream darf wieder laufen.
  const unaddedCount = jobs.filter(j =>
    j.origin === 'add' && (j.status !== 'done' || !j.added)
  ).length;
  const memoryLevel: 'ok' | 'warn' | 'critical' =
    unaddedCount >= 40 ? 'critical' :
    unaddedCount >= 30 ? 'warn' : 'ok';

  // Auto-Pause bei critical, Auto-Resume erst bei < 25 Jobs (Hysterese).
  const autoPausedRef = useRef(false);
  useEffect(() => {
    if (memoryLevel === 'critical' && !streamPaused) {
      autoPausedRef.current = true;
      setStreamPaused(true);
    } else if (autoPausedRef.current && unaddedCount < 25 && streamPaused) {
      autoPausedRef.current = false;
      setStreamPaused(false);
    }
  }, [memoryLevel, streamPaused, unaddedCount]);

  const removeJob = useCallback((id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id));
    setActiveJobId(prev => (prev === id ? null : prev));
  }, []);

  const markAdded = useCallback((id: string) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, added: true } : j));
    setActiveJobId(null);
    // Memory-Cleanup: 3s nach dem Hinzufügen wird das Job-Tile aus dem In-Memory-
    // State entfernt. Die Karte selbst ist persistent in Firestore — nur das Slider/
    // Review-Thumbnail verschwindet. Verhindert Heap-Anstieg in langen Sessions.
    setTimeout(() => {
      setJobs(prev => prev.filter(j => j.id !== id));
    }, 3000);
  }, []);

  /** Memory-Cleanup: nach 60s wird das Base64-Bild aus einem Job entfernt (Error
   *  ODER erfolgreich erkannt). Das Bild hatte nur als Diagnose-Hilfe Sinn (Debug-
   *  Modal, pHash-Vergleich) — der User hat genug Zeit, es sich anzuschauen.
   *  Verhindert, dass viele Snaps × 50-250 KB dauerhaft im Heap bleiben. */
  const scheduleImageCleanup = useCallback((id: string) => {
    setTimeout(() => {
      setJobs(prev => prev.map(j =>
        j.id === id && j.debug?.imageBase64
          ? { ...j, debug: { ...j.debug, imageBase64: undefined } }
          : j
      ));
    }, 60_000);
  }, []);

  /** Toggle manueller Gelb-Markierung — Slider-Tap-Toggle. */
  const toggleManualFlag = useCallback((id: string) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, flaggedManual: !j.flaggedManual } : j));
  }, []);

  const setJobVariant = useCallback((id: string, variant: CardVariant) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, editedVariant: variant } : j));
  }, []);

  const setJobCondition = useCallback((id: string, condition: PersistedCondition) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, editedCondition: condition } : j));
  }, []);

  // „Alle hinzufügen" öffnet jetzt ein Bulk-Modal zur Bestätigung der Werte.
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const openBulkAdd = useCallback(() => {
    const targets = jobs.filter(j => j.status === 'done' && !!j.result?.card && !j.added);
    if (targets.length === 0) return;
    setBulkModalOpen(true);
  }, [jobs]);

  // Auto-Save beim Verlassen des Scanners → Inbox-Binder „Neue Karten"
  const [closingSaving, setClosingSaving] = useState(false);
  const handleClose = useCallback(async () => {
    if (closingSaving) return;
    const targets = jobs.filter(j =>
      j.origin === 'add' && j.status === 'done' && !!j.result?.card && !j.added
    );
    if (targets.length === 0) { router.push('/'); return; }
    setClosingSaving(true);
    try {
      const inboxId = await ensureInboxBinder();
      for (const job of targets) {
        const card = job.result!.card!;
        const v = (job.editedVariant ?? card.variants?.[0] ?? 'standard') as CardVariant;
        const c = job.editedCondition ?? 'NM';
        const lang = job.result!.language ?? 'de';
        try {
          const cardId = await addCard({
            tcgId: card.id,
            name: card.name,
            setId: card.setId,
            setName: card.setName,
            series: card.series,
            number: card.number,
            rarity: card.rarity,
            pokemonType: card.types?.[0],
            supertype: card.supertype,
            variant: v,
            condition: c,
            language: lang,
            isFoil: v === 'holo',
            isFirstEd: v === '1st-ed',
            quantity: 1,
            tcgImageUrl: card.imgLargeDe || card.imgLarge,
          });
          await addCardToBinder(inboxId, cardId);
        } catch (err) {
          console.error('[scanner-close] save error for job', job.id, err);
        }
      }
    } finally {
      router.push('/');
    }
  }, [closingSaving, jobs, router]);

  const clearAllJobs = useCallback(() => {
    setJobs([]);
    setActiveJobId(null);
    setQuickAddJobId(null);
    setFakeReasonsJobId(null);
    setRecognizedJobId(null);
  }, []);

  // Owned-Copies frisch laden, wenn ein Job ausgewählt wird (für das CardDetailSheet).
  useEffect(() => {
    if (!activeJobId) { setActiveOwnedCopies([]); return; }
    const job = jobs.find(j => j.id === activeJobId);
    const card = job?.result?.card;
    if (!card) { setActiveOwnedCopies([]); return; }
    let cancelled = false;
    getCardsByTcgId(card.id)
      .then(copies => { if (!cancelled) setActiveOwnedCopies(copies); })
      .catch(() => { if (!cancelled) setActiveOwnedCopies([]); });
    return () => { cancelled = true; };
  }, [activeJobId, jobs]);

  const handleCapture = useCallback(async (imageBase64: string, mimeType: string) => {
    const id = Math.random().toString(36).slice(2);
    const t0 = Date.now();
    const imageSizeKb = Math.round((imageBase64.length * 3 / 4) / 1024);
    const debug: ScanDebug = { imageBase64, mimeType, imageSizeKb, lookupSteps: [] };

    // Bild wird nur EINMAL gespeichert (in debug.imageBase64) — verhindert
    // doppelten Speicherverbrauch (vorher: capturedImageBase64 + debug.imageBase64
    // hat iOS PWA bei vielen Scans gecrasht).
    const origin = scanModeRef.current;
    setJobs(prev => {
      // Im Einzeln-Modus immer nur EIN Recognize-Job gleichzeitig: alte raus.
      const base = origin === 'recognize'
        ? prev.filter(j => j.origin !== 'recognize')
        : prev;
      return [...base, { id, origin, status: 'processing', result: null, debug }];
    });
    // Im Einzeln-Modus Stream SOFORT pausieren — verhindert Folge-Snaps während
    // Gemini noch arbeitet. User tippt Scan-FAB für nächste Karte.
    if (origin === 'recognize') {
      setStreamPaused(true);
    }

    try {
      // ── FIFO-Upload-Queue: warten bis vorheriger Upload fertig ist ────────
      // (verhindert Bandbreiten-Konkurrenz auf schwachem Mobilnetz)
      const prevUpload = uploadChainRef.current;
      const tFetch = Date.now();
      const myUpload = prevUpload.then(async () => {
        // ── AbortController: 90s Timeout (Gemini hat gelegentlich 20-30s
        // Latenz; iOS-PWA-Standalone kann Page kurz pausieren) ────────────
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 90_000);
        try {
          return await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64, mimeType }),
            signal: ac.signal,
          });
        } finally {
          clearTimeout(to);
        }
      });
      uploadChainRef.current = myUpload.catch(() => {}); // Chain-Bruch verhindern
      const res = await myUpload;
      const gemini: GeminiResponse & { _debug?: { model: string; ms: number; rawText: string } }
        = await res.json();
      const fetchMs = Date.now() - tFetch;

      debug.geminiModel = gemini._debug?.model;
      debug.geminiMs    = gemini._debug?.ms ?? fetchMs;
      // Wire-Overhead = Upload+Server-Parse+Download (alles außer Modell-Call)
      debug.uploadMs    = gemini._debug?.ms != null ? fetchMs - gemini._debug.ms : undefined;
      debug.geminiRaw   = gemini._debug?.rawText;
      debug.geminiParsed = { ...gemini, _debug: undefined };
      console.log('[scanner] Gemini response:', { fetchMs, uploadMs: debug.uploadMs, gemini });

      // Gemini-Antwort als Debug-Info aufzeichnen
      const fakeTag = gemini.fakeRisk && gemini.fakeRisk !== 'low' ? ` ⚠️${gemini.fakeRisk}` : '';
      const geminiSummary = gemini.error
        ? `Gemini: ${gemini.error}`
        : `Gemini: ${gemini.setCode ?? '?'}/${gemini.number ?? '?'} ${gemini.language ?? '?'} (${gemini.confidence ?? '?'})${fakeTag}`;

      // Im Mehrere-Modus: "No card detected" stillschweigend verwerfen, statt
      // den Slider mit nutzlosen Error-Tiles zu fluten. Im Einzeln-Modus zeigen
      // wir den Fehler weiterhin (User will Feedback).
      if (gemini.error === 'No card detected' && scanModeRef.current === 'add') {
        setJobs(prev => prev.filter(j => j.id !== id));
        return;
      }

      // Hard-Fail nur wenn Gemini explizit „kein Karte" sagt ODER alle Identifier
      // fehlen. Mit dem neuen Prompt ist setCode=null bei Pre-S&V-Karten normal.
      const hasUsefulInfo = !!(gemini.setCode || gemini.number || gemini.nationalDexNumber || gemini.name);
      if (gemini.error || !hasUsefulInfo) {
        debug.error = gemini.error ?? 'Kein lesbarer Karten-Text';
        debug.totalMs = Date.now() - t0;
        const errDebug: ScanDebug = { ...debug };
        setJobs(prev => prev.map(j => j.id === id
          ? { ...j, status: 'error', result: { card: null, language: (gemini.language ?? 'de') as CardLanguage }, debugInfo: geminiSummary, debug: errDebug }
          : j));
        scheduleImageCleanup(id);
        return;
      }

      const rawNumber = typeof gemini.number === 'string' && gemini.number.includes('/')
        ? gemini.number.split('/')[0]
        : (gemini.number ?? '');

      // ── Catalog-Lookups (lookupMs misst diesen ganzen Block) ─────────────
      const tLookup = Date.now();
      let catalogCard = null as Awaited<ReturnType<typeof getCardBySetCodeAndNumber>>;
      let dexCandidateCount = 0;

      // 1) Direkter SetCode+Number-Lookup (nur wenn beide vorhanden)
      if (gemini.setCode && rawNumber) {
        debug.lookupSteps!.push(`getCardBySetCodeAndNumber("${gemini.setCode}", "${rawNumber}")`);
        catalogCard = await getCardBySetCodeAndNumber(gemini.setCode, rawNumber);
        debug.lookupSteps![debug.lookupSteps!.length - 1] += catalogCard ? ` → ${catalogCard.id}` : ' → null';

        // 2) Nummernformat-Variante: "005" ↔ "5"
        if (!catalogCard) {
          const alt = /^\d+$/.test(rawNumber)
            ? String(parseInt(rawNumber, 10))
            : rawNumber.padStart(3, '0');
          if (alt !== rawNumber) {
            debug.lookupSteps!.push(`getCardBySetCodeAndNumber("${gemini.setCode}", "${alt}")`);
            catalogCard = await getCardBySetCodeAndNumber(gemini.setCode, alt);
            debug.lookupSteps![debug.lookupSteps!.length - 1] += catalogCard ? ` → ${catalogCard.id}` : ' → null';
          }
        }

        // Dex-Nummer-Gegenprobe: Gemini liest Dex-Nr. unabhängig vom setCode
        // (eigenes Feld im Prompt). Weicht sie von der gefundenen Karte ab, war
        // der setCode falsch (z.B. Symbolabgleich hat ein ähnliches, aber
        // falsches Set getroffen) — verwerfen und auf Name/Dex-Fallback
        // unten durchfallen lassen, statt der falschen Karte zu vertrauen.
        if (catalogCard && gemini.nationalDexNumber && catalogCard.nationalDexNumber
            && catalogCard.nationalDexNumber !== gemini.nationalDexNumber) {
          debug.lookupSteps!.push(
            `verworfen: Dex-Nr. passt nicht (Katalog=${catalogCard.nationalDexNumber}, Gemini=${gemini.nationalDexNumber})`,
          );
          catalogCard = null;
        }
      }

      // 3) Name+Number-Fallback — bestes Identifier-Paar wenn setCode fehlt
      //    (Trainer haben keinen Dex; bei Karten ohne Letter-Code ist der
      //    gedruckte Karten-Name eindeutig pro Number).
      if (!catalogCard && gemini.name && rawNumber) {
        debug.lookupSteps!.push(`getCardsByNameAndNumber("${gemini.name}", "${rawNumber}")`);
        const nameCards = await getCardsByNameAndNumber(gemini.name, rawNumber);
        debug.lookupSteps![debug.lookupSteps!.length - 1] += ` → ${nameCards.length} Kandidaten`;

        if (nameCards.length === 0) {
          // Format-Variante probieren
          const alt = /^\d+$/.test(rawNumber)
            ? String(parseInt(rawNumber, 10))
            : rawNumber.padStart(3, '0');
          if (alt !== rawNumber) {
            debug.lookupSteps!.push(`getCardsByNameAndNumber("${gemini.name}", "${alt}")`);
            const altCards = await getCardsByNameAndNumber(gemini.name, alt);
            debug.lookupSteps![debug.lookupSteps!.length - 1] += ` → ${altCards.length} Kandidaten`;
            if (altCards.length > 0) catalogCard = altCards[0];
          }
        } else {
          catalogCard = nameCards[0];
          if (nameCards.length > 1) {
            debug.lookupSteps!.push(`name+number mehrdeutig: ${nameCards.length} — erster gewählt`);
          }
        }
      }

      // 4) Fallback: Pokédex-Nummer mit Number-Filter — kein blindes [0]
      if (!catalogCard && gemini.nationalDexNumber) {
        debug.lookupSteps!.push(`getCardsByDexNumber(${gemini.nationalDexNumber}, 100)`);
        const dexCards = await getCardsByDexNumber(gemini.nationalDexNumber, 100);
        dexCandidateCount = dexCards.length;
        debug.lookupSteps![debug.lookupSteps!.length - 1] += ` → ${dexCards.length} Kandidaten`;

        if (dexCards.length > 0) {
          // Filtere auf number === rawNumber (oder Format-Variante)
          let filtered = dexCards;
          if (rawNumber) {
            const altNumber = /^\d+$/.test(rawNumber)
              ? String(parseInt(rawNumber, 10))
              : rawNumber.padStart(3, '0');
            filtered = dexCards.filter(c => c.number === rawNumber || c.number === altNumber);
            debug.lookupSteps!.push(`filter by number=${rawNumber} → ${filtered.length} übrig`);
          }
          if (filtered.length === 0) filtered = dexCards;

          // Falls Gemini einen Letter-Code lieferte (sollte zwar oben gematcht haben,
          // aber falls Set noch nicht gesynct ist): bevorzuge Karten mit gleichem setCode
          if (filtered.length > 1 && gemini.setCode) {
            const byCode = filtered.filter(c => c.setCode === gemini.setCode);
            if (byCode.length > 0) {
              filtered = byCode;
              debug.lookupSteps!.push(`filter by setCode=${gemini.setCode} → ${filtered.length} übrig`);
            }
          }

          if (filtered.length > 0) {
            catalogCard = filtered[0];
            if (filtered.length > 1) {
              debug.lookupSteps!.push(`mehrdeutig: ${filtered.length} Kandidaten — erster gewählt`);
            }
          }
        }
      }

      debug.lookupMs = Date.now() - tLookup;
      debug.catalogMatch = catalogCard
        ? { id: catalogCard.id, name: catalogCard.name, setId: catalogCard.setId, number: catalogCard.number }
        : null;
      debug.totalMs = Date.now() - t0;

      const catalogInfo = catalogCard
        ? `Katalog: ${catalogCard.name} (${catalogCard.setId}/${catalogCard.number})`
        : `Katalog: nicht gefunden (setCode=${gemini.setCode ?? 'null'}/${rawNumber || 'null'}, dex=${gemini.nationalDexNumber ?? 'null'}, ${dexCandidateCount} Kandidaten)`;

      // Memory-Cleanup beim Finalisieren:
      //  - geminiParsed + lookupSteps bleiben erhalten — werden fürs Debug-Modal
      //    gebraucht (kleine JSON-Objekte, kein nennenswerter Speicherverbrauch)
      //  - imageBase64: bleibt zunächst stehen (Debug-Modal + pHash-Vergleich
      //    brauchen es), wird aber per scheduleImageCleanup() nach 60s gestrippt —
      //    sowohl bei Erfolg als auch bei Error (verhindert, dass viele Snaps
      //    dauerhaft Bild-Bytes im Heap halten).
      const finalDebug: ScanDebug = { ...debug };

      // Karte SOFORT rendern, ownedCount kommt asynchron nach.
      // Spart 5-15s Render-Verzögerung auf schwacher Firebase-Verbindung.
      const initialVariant: CardVariant = (catalogCard?.variants?.[0]) ?? 'standard';
      const initialCondition: PersistedCondition = gemini.condition
        ? GEMINI_TO_PERSISTED[gemini.condition]
        : 'NM';
      setJobs(prev => prev.map(j => j.id === id ? {
        ...j,
        status: catalogCard ? 'done' : 'error',
        debugInfo: `${geminiSummary} | ${catalogInfo}`,
        debug: finalDebug,
        editedVariant:   initialVariant,
        editedCondition: initialCondition,
        result: {
          card: catalogCard ? catalogCardToInfo(catalogCard) : null,
          language: (gemini.language ?? 'de') as CardLanguage,
          ownedCount: undefined, // wird non-blocking nachgeladen
          condition: gemini.condition,
          fakeRisk: gemini.fakeRisk,
          fakeReasons: gemini.fakeReasons,
        },
      } : j));

      // Erkennen-Modus: nach erfolgreichem Catalog-Match Job zentral anzeigen.
      // Stream wurde bereits beim Snap pausiert (handleCapture oben).
      if (catalogCard && scanModeRef.current === 'recognize') {
        setRecognizedJobId(id);
      }
      scheduleImageCleanup(id);

      // ── Owned-Count non-blocking nachladen ────────────────────────────────
      if (catalogCard) {
        const tOwned = Date.now();
        getCardsByTcgId(catalogCard.id)
          .then(copies => {
            setJobs(prev => prev.map(j => j.id === id && j.result
              ? {
                  ...j,
                  result: { ...j.result, ownedCount: copies.length },
                  debug: { ...j.debug, ownedMs: Date.now() - tOwned } as ScanDebug,
                }
              : j));
          })
          .catch(() => {
            // Auth/Permission-Fehler → ownedCount bleibt undefined (Badge blendet aus)
            setJobs(prev => prev.map(j => j.id === id && j.debug
              ? { ...j, debug: { ...j.debug, ownedMs: Date.now() - tOwned } }
              : j));
          });
      }

      // ── pHash-Bild-Verifikation non-blocking nachladen ─────────────────────
      // Vergleicht das aufgenommene Foto mit dem Katalog-Bild der gefundenen Karte
      // (server-seitig, da images.pokemontcg.io keine CORS-Header sendet). Nutzt
      // `debug.imageBase64` — die lokale Variable, NICHT `finalDebug`, da Letzteres
      // das Bild bei Erfolg bereits stripped. Rein diagnostisch: Fehler hier
      // beeinträchtigen den eigentlichen Scan nicht, `pHashDistance` bleibt dann
      // einfach unbesetzt (kein gelber/roter Rahmen).
      if (catalogCard && debug.imageBase64) {
        const cardInfoForHash = catalogCardToInfo(catalogCard);
        const lang = (gemini.language ?? 'de') as CardLanguage;
        const catalogImageUrl = (lang === 'de' && cardInfoForHash.imgLargeDe) || cardInfoForHash.imgLarge
          || (lang === 'de' && cardInfoForHash.imgSmallDe) || cardInfoForHash.imgSmall || null;
        if (catalogImageUrl) {
          fetch('/api/scan/verify-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: debug.imageBase64, catalogImageUrl }),
          })
            .then(r => r.json())
            .then(({ distance }) => {
              if (typeof distance === 'number') {
                setJobs(prev => prev.map(j => j.id === id ? { ...j, pHashDistance: distance } : j));
              }
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      console.error('Scan error:', err);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const msg = isAbort ? 'Upload-Timeout 90s' : err instanceof Error ? err.message : String(err);
      debug.error = msg;
      debug.totalMs = Date.now() - t0;
      const errDebug: ScanDebug = { ...debug, geminiParsed: undefined, lookupSteps: undefined };
      setJobs(prev => prev.map(j => j.id === id
        ? { ...j, status: 'error', result: { card: null, language: 'de' }, debugInfo: `Netzwerkfehler: ${msg}`, debug: errDebug }
        : j));
      scheduleImageCleanup(id);
    }
  }, [scheduleImageCleanup]);

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">

      {/* ── Kamera fullscreen (nur im Scan-Modus) ──────────────────
          Beim Wechsel zu Review wird CameraCapture unmounted → Stream stoppt.
          Beim Zurück-Wechsel mountet die Komponente neu und zeigt initial
          das „Kamera starten"-Overlay — getUserMedia erst nach Tap. */}
      {mode === 'scanning' && (
        <div className="absolute inset-0">
          <CameraCapture
            onCapture={handleCapture}
            pendingCount={pendingCount}
            active={cameraActive}
            paused={streamPaused}
            hideFrame={scanMode === 'recognize' && streamPaused}
          />
        </div>
      )}

      {/* ── Review-Modus: schwarzer Hintergrund, scrollbar ──────── */}
      {mode === 'review' && (() => {
        const addJobs = jobs.filter(j => j.origin === 'add');
        // Filter anwenden basierend auf statusFilter — addJobs bleibt unverändert
        // (wichtig für korrekte depthFromTop-Berechnung), filtered ist die sichtbare Liste
        const matchesFilter = (job: ScanJob): boolean => {
          if (statusFilter === 'all') return true;
          const s = computeBorderStatus(job);
          if (statusFilter === 'success') return s === 'none';
          if (statusFilter === 'yellow')  return s === 'manual-yellow' || s === 'auto-yellow';
          if (statusFilter === 'red')     return s === 'auto-red' || s === 'error';
          return true;
        };
        const filtered = addJobs.filter(matchesFilter);

        // Die Liste/Single zeigen "neueste oben" — wir reversen die Reihenfolge für die Anzeige
        const filteredReversed = [...filtered].reverse();

        return (
        <div
          className="absolute inset-0 overflow-y-auto bg-black px-4"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 130px)',
            paddingBottom: viewMode === 'single'
              ? 'calc(env(safe-area-inset-bottom, 0px) + 20px)'
              : 'calc(env(safe-area-inset-bottom, 0px) + 130px)',
          }}
        >
          {/* View-Toggle + Status-Filter — direkt unter dem Header */}
          <div
            className="fixed left-0 right-0 z-20 px-4 flex items-center gap-2 flex-wrap"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 56px)' }}
          >
            {/* View-Mode-Toggle (Grid / Single) */}
            <div className="flex rounded-full p-1 bg-black/65 backdrop-blur-sm border border-white/10">
              {([
                ['grid', LayoutGrid, 'Grid'],
                ['single', Square, 'Einzeln'],
              ] as const).map(([mode, Icon, label]) => (
                <button
                  key={mode}
                  onClick={() => { setViewMode(mode); if (mode === 'single') setSingleIdx(0); }}
                  className="w-11 h-11 flex items-center justify-center rounded-full"
                  aria-label={label}
                  style={{
                    background: viewMode === mode ? 'var(--pokedex-red)' : 'transparent',
                    color: viewMode === mode ? '#fff' : 'rgba(255,255,255,0.65)',
                  }}
                >
                  <Icon size={20} />
                </button>
              ))}
            </div>
            {/* Filter-Chips */}
            <div className="flex rounded-full p-1 bg-black/65 backdrop-blur-sm border border-white/10">
              {([
                ['all', 'Alle'],
                ['success', '✓'],
                ['yellow', '!'],
                ['red', '✕'],
              ] as const).map(([f, label]) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className="min-w-[44px] px-3.5 h-11 text-sm font-semibold rounded-full"
                  style={{
                    background:
                      statusFilter === f
                        ? (f === 'yellow' ? '#facc15' : f === 'red' ? '#ef4444' : f === 'success' ? '#22c55e' : 'var(--pokedex-red)')
                        : 'transparent',
                    color: statusFilter === f ? (f === 'yellow' ? '#1a1a1a' : '#fff') : 'rgba(255,255,255,0.65)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-base text-white/75 font-mono ml-auto px-2">
              {viewMode === 'single' && filteredReversed.length > 0
                ? `${filteredReversed.length - Math.min(singleIdx, filteredReversed.length - 1)}/${filteredReversed.length}`
                : `${filtered.length}/${addJobs.length}`}
            </span>
          </div>

          {viewMode === 'grid' && (
          <div className="grid grid-cols-2 gap-3">
            {(() => {
              return filteredReversed.map((job) => {
                const origIdx = addJobs.indexOf(job);
                const idx = origIdx; // for depth calc — but our depth uses addJobs index
                const img = cardImgUrl(job);
                const card = job.result?.card;
                const canOpen = job.status === 'done' && !!card;
                const isError = job.status === 'error';
                const borderStatus = computeBorderStatus(job);
                const depthFromTop = addJobs.length - idx;
                const onCardClick = () => {
                  if (canOpen) setActiveJobId(job.id);
                  else if (isError) setErrorDetailJobId(job.id);
                };
              return (
                <div key={job.id} className="relative flex flex-col">
                  <div
                    className="relative rounded-md overflow-hidden"
                    style={{
                      background: '#1a1a1a',
                      aspectRatio: '63/88',
                      ...borderStyleFor(borderStatus, job.result?.fakeRisk),
                      cursor: (canOpen || isError) ? 'pointer' : 'default',
                    }}
                    onClick={onCardClick}
                  >
                    {/* Depth-Badge im Review-Grid */}
                    {(borderStatus === 'manual-yellow' || borderStatus === 'auto-yellow' || borderStatus === 'auto-red') && (
                      <div
                        className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold z-10"
                        style={{
                          background: borderStatus === 'auto-red' ? 'rgba(239,68,68,0.92)' : 'rgba(250,204,21,0.92)',
                          color: borderStatus === 'auto-red' ? '#fff' : '#1a1a1a',
                        }}
                      >
                        #{depthFromTop}
                      </div>
                    )}
                    {job.status === 'processing' ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 size={24} color="rgba(255,255,255,0.4)" className="animate-spin" />
                      </div>
                    ) : isError ? (() => {
                      const ec = classifyJobError(job);
                      const ErrIcon = ec.Icon;
                      return (
                        <div
                          className="w-full h-full flex flex-col"
                          style={{
                            background: 'linear-gradient(180deg, #f5d97c 0%, #e8b942 100%)',
                            padding: 4,
                          }}
                        >
                          <div
                            className="flex-1 flex flex-col"
                            style={{
                              background: 'linear-gradient(180deg, #fef5d2 0%, #fce8a8 100%)',
                              borderRadius: 4,
                              overflow: 'hidden',
                            }}
                          >
                            {/* Mini-Header */}
                            <div
                              className="flex items-center justify-between px-1.5 py-1 gap-1"
                              style={{ background: 'rgba(220,38,38,0.12)' }}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                <span
                                  className="text-[7px] font-bold px-1 rounded text-white shrink-0"
                                  style={{ background: 'var(--pokedex-red)' }}
                                >
                                  ERR
                                </span>
                                <span className="text-[10px] font-extrabold leading-none truncate" style={{ color: '#1a1a1a' }}>
                                  {ec.cardName}
                                </span>
                              </div>
                              <span className="text-[9px] font-extrabold shrink-0" style={{ color: 'var(--pokedex-red)' }}>
                                404
                              </span>
                            </div>
                            {/* Mini-Artwork: Snap-Foto wenn da, sonst MissingNo */}
                            <div
                              className="flex-1 mx-1 my-1 relative overflow-hidden"
                              style={{
                                background: 'linear-gradient(135deg, rgba(220,38,38,0.18) 0%, rgba(220,38,38,0.05) 100%)',
                                border: '2px solid rgba(0,0,0,0.55)',
                                borderRadius: 2,
                              }}
                            >
                              {job.debug?.imageBase64 ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  src={`data:${job.debug.mimeType ?? 'image/jpeg'};base64,${job.debug.imageBase64}`}
                                  alt="Scan"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <MissingNoArtwork size={72} color="#1a1a1a" tint={ec.iconColor} />
                                </div>
                              )}
                              {/* Klein-Icon oben rechts als sekundärer Hint zum Fehler-Typ */}
                              <div
                                className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full flex items-center justify-center"
                                style={{ background: 'rgba(0,0,0,0.65)' }}
                              >
                                <ErrIcon size={14} color={ec.iconColor} strokeWidth={2} />
                              </div>
                            </div>
                            {/* Mini-Footer */}
                            <div
                              className="px-1.5 py-0.5 text-[8px] font-mono flex items-center justify-between"
                              style={{ background: 'rgba(0,0,0,0.06)', color: '#1a1a1a' }}
                            >
                              <span className="font-bold" style={{ color: 'var(--pokedex-red)' }}>ERR</span>
                              <span>404/404</span>
                            </div>
                          </div>
                        </div>
                      );
                    })() : !img ? (
                      <div className="w-full h-full flex items-center justify-center bg-red-500/10">
                        <AlertCircle size={24} color="#f87171" />
                      </div>
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={img} alt={card?.name ?? ''} className="w-full h-full object-cover" />
                    )}
                    {job.added && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(72,187,120,.9)' }}>
                          <Check size={20} color="#fff" strokeWidth={3} />
                        </div>
                      </div>
                    )}
                    {/* Fake-Warnung oben links */}
                    {(job.result?.fakeRisk === 'medium' || job.result?.fakeRisk === 'high') && (
                      <button
                        onClick={e => { e.stopPropagation(); setFakeReasonsJobId(job.id); }}
                        className="absolute top-2 left-2 w-9 h-9 rounded-full flex items-center justify-center"
                        style={{ background: 'rgba(0,0,0,0.7)' }}
                        aria-label="Fake-Verdacht"
                      >
                        <AlertTriangle size={16} color={job.result.fakeRisk === 'high' ? '#ef4444' : '#facc15'} fill={job.result.fakeRisk === 'high' ? '#ef4444' : '#facc15'} />
                      </button>
                    )}
                    {/* Condition-Pill unten links auf der Karte */}
                    {job.result?.condition && (() => {
                      const p = GEMINI_TO_PERSISTED[job.result.condition];
                      const c = PERSISTED_CONDITION_COLOR[p];
                      return (
                        <span className="absolute bottom-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md shadow-md"
                          style={{ background: c.bg, color: c.text }}>
                          {p}
                        </span>
                      );
                    })()}
                    {/* Wert-Badge oben rechts auf Grid-Tile (nur ab 'wertvoll') */}
                    {card && (
                      <div className="absolute top-1 right-1">
                        <ValueBadge tcgId={card.id} iconOnly />
                      </div>
                    )}
                    {/* Trash + Quick-Add unten rechts */}
                    <div
                      className="absolute flex items-end gap-1"
                      style={{ right: 2, bottom: 2 }}
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        onClick={e => { e.stopPropagation(); removeJob(job.id); }}
                        className="w-8 h-8 rounded-md flex items-center justify-center shadow-md text-white"
                        style={{ background: 'var(--action-delete)' }}
                        aria-label="Entfernen"
                      >
                        <Trash2 size={14} />
                      </button>
                      {canOpen && !job.added && (
                        <button
                          onClick={e => { e.stopPropagation(); setQuickAddJobId(job.id); }}
                          className="w-11 h-11 rounded-md flex items-center justify-center shadow-md text-white"
                          style={{ background: 'var(--action-add)' }}
                          aria-label="Zur Sammlung hinzufügen"
                        >
                          <Plus size={22} strokeWidth={3} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2 mt-2 px-1">
                    {card?.setCode && (
                      <div
                        className="shrink-0 flex flex-col items-center leading-tight rounded-md border px-1.5 py-0.5 font-mono"
                        style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}
                      >
                        <span className="text-[10px] font-bold">{card.setCode}</span>
                        {card.number && (
                          <span className="text-[9px] text-white/75">{card.number}</span>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-white/90 truncate">
                      {card?.name ?? (job.status === 'processing' ? '…' : 'Fehler')}
                    </p>
                  </div>
                </div>
              );
              });
            })()}
          </div>
          )}

          {viewMode === 'single' && (() => {
            if (filteredReversed.length === 0) {
              return (
                <p className="text-center text-white/55 text-sm py-8">
                  Keine Karten in dieser Auswahl.
                </p>
              );
            }
            const safeIdx = Math.min(singleIdx, filteredReversed.length - 1);
            const job = filteredReversed[safeIdx];
            const prevJob = safeIdx > 0 ? filteredReversed[safeIdx - 1] : null;
            const nextJob = safeIdx < filteredReversed.length - 1 ? filteredReversed[safeIdx + 1] : null;

            // Drag-Richtung bestimmt, welche Schicht sichtbar/animiert ist:
            //  - Rechts (dx > 0): Top-Panel folgt Finger, fliegt raus → idx+1
            //  - Links  (dx < 0): Prev-Panel gleitet von rechts ein → idx-1
            const isRightDrag = singleDragX > 0 || singleAnim === 'commit-next' || singleAnim === 'snap-out';
            const isLeftDrag  = singleDragX < 0 || singleAnim === 'commit-prev' || singleAnim === 'snap-in';
            const showBelow   = isRightDrag && !!nextJob;
            const showIncoming = isLeftDrag && !!prevJob && singlePanelWidth > 0;

            // Top-Panel-Transform: bewegt sich nur bei Right-Drag/Commit/Snap-Out
            const topTransform =
              singleAnim === 'commit-next' ? `translateX(${singlePanelWidth + 50}px)` :
              singleAnim === 'snap-out'    ? 'translateX(0px)' :
              isRightDrag && singleDragX > 0 ? `translateX(${singleDragX}px)` :
              undefined;
            const topTransition = (singleAnim === 'commit-next' || singleAnim === 'snap-out')
              ? 'transform 200ms ease-out' : undefined;

            // Incoming-Panel-Transform: nur bei Left-Drag/Commit-Prev/Snap-In
            const incomingTransform =
              singleAnim === 'commit-prev' ? 'translateX(0px)' :
              singleAnim === 'snap-in'     ? `translateX(${singlePanelWidth}px)` :
              showIncoming                 ? `translateX(${singlePanelWidth + singleDragX}px)` :
              `translateX(${singlePanelWidth}px)`;
            const incomingTransition = (singleAnim === 'commit-prev' || singleAnim === 'snap-in')
              ? 'transform 200ms ease-out' : undefined;

            // Inneres Karten-Bild — geteilt von allen Panels
            const renderFace = (j: typeof job) => {
              const jCard = j.result?.card;
              const jIsError = j.status === 'error';
              const jImg = jIsError
                ? (j.debug?.imageBase64 ? `data:${j.debug.mimeType ?? 'image/jpeg'};base64,${j.debug.imageBase64}` : null)
                : cardImgUrlLarge(j);
              if (jIsError) {
                const ec = classifyJobError(j);
                const ErrIcon = ec.Icon;
                return jImg ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={jImg} alt="Scan" className="w-full h-full object-contain pointer-events-none" draggable={false} />
                    <div className="absolute top-2 right-2 w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
                      <ErrIcon size={18} color={ec.iconColor} strokeWidth={2} />
                    </div>
                    <div className="absolute top-2 left-2 px-2 py-1 rounded text-xs font-extrabold text-white" style={{ background: 'var(--pokedex-red)' }}>
                      {ec.cardName}
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <MissingNoArtwork size={144} color="#1a1a1a" tint={ec.iconColor} />
                  </div>
                );
              }
              return jImg ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={jImg} alt={jCard?.name ?? ''} className="w-full h-full object-contain pointer-events-none" draggable={false} />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Loader2 size={28} color="rgba(255,255,255,0.4)" className="animate-spin" />
                </div>
              );
            };

            // Ein vollständiges Panel — Karte + Meta in einem Rahmen.
            // Karte sitzt bündig am oberen Panel-Rand, darunter Set/Name/Dropdowns.
            // Der Border (Manual-Yellow / Auto-Yellow / Error) umschließt das ganze Panel.
            const renderPanel = (j: typeof job, interactive: boolean) => {
              const jCard = j.result?.card;
              const jIsError = j.status === 'error';
              const jCanOpen = j.status === 'done' && !!jCard;
              const jVariants = jCard?.variants?.length ? jCard.variants : (['standard'] as CardVariant[]);
              const jCurVariant   = j.editedVariant   ?? jVariants[0];
              const jCurCondition = j.editedCondition ?? 'NM';
              const jCondColor = PERSISTED_CONDITION_COLOR[jCurCondition];
              return (
                <div
                  className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden"
                  style={{
                    ...borderStyleFor(computeBorderStatus(j), j.result?.fakeRisk),
                    background: '#1a1a1a',
                    pointerEvents: interactive ? undefined : 'none',
                  }}
                >
                  {/* Karten-Bild — bündig oben im Panel */}
                  <div className="flex-1 min-h-0 relative flex items-center justify-center">
                    {renderFace(j)}

                    {/* Wert-Badge oben links auf der Karte (nur ab 'wertvoll') */}
                    {jCard && (
                      <div className="absolute top-2 left-2">
                        <ValueBadge tcgId={jCard.id} />
                      </div>
                    )}

                    {/* Trash + Plus unten rechts auf der Karte */}
                    <div
                      className="absolute flex items-end gap-2"
                      style={{ right: 10, bottom: 10 }}
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          removeJob(j.id);
                          if (safeIdx >= filteredReversed.length - 1 && safeIdx > 0) {
                            setSingleIdx(safeIdx - 1);
                          }
                        }}
                        className="w-11 h-11 rounded-md flex items-center justify-center shadow-md text-white"
                        style={{ background: 'var(--action-delete)' }}
                        aria-label="Entfernen"
                      >
                        <Trash2 size={18} />
                      </button>
                      {jCanOpen && !j.added && (
                        <button
                          onClick={e => { e.stopPropagation(); setQuickAddJobId(j.id); }}
                          className="w-16 h-16 rounded-md flex items-center justify-center shadow-lg text-white"
                          style={{ background: 'var(--action-add)' }}
                          aria-label="Zur Sammlung hinzufügen"
                        >
                          <Plus size={32} strokeWidth={3} />
                        </button>
                      )}
                    </div>

                    {/* Added-Overlay */}
                    {j.added && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
                        <Check size={48} color="#48bb78" strokeWidth={3} />
                      </div>
                    )}
                  </div>

                  {/* Meta-Zeile im selben Panel: Set-Frame · Name (zentriert) · Dropdowns */}
                  <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 shrink-0 px-2 py-2 border-t border-white/10">
                    {jCard?.setCode ? (
                      <div
                        className="flex flex-col items-center leading-tight rounded-md border px-2 py-1 font-mono"
                        style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}
                      >
                        <span className="text-[11px] font-bold">{jCard.setCode}</span>
                        {jCard.number && (
                          <span className="text-[10px] text-white/75">{jCard.number}</span>
                        )}
                      </div>
                    ) : <div />}

                    <p className="text-sm font-semibold text-white text-center truncate">
                      {jCard?.name ?? (jIsError ? classifyJobError(j).cardName : '…')}
                    </p>

                    {jCard ? (
                      <div className="flex items-center gap-1.5">
                        <div className="relative">
                          <span
                            className="text-xs font-bold px-2 py-1.5 rounded inline-block border"
                            style={{
                              background: 'rgba(255,255,255,0.10)',
                              color: '#fff',
                              borderColor: 'rgba(255,255,255,0.20)',
                            }}
                          >
                            {VARIANT_LABELS[jCurVariant]}
                          </span>
                          {jVariants.length > 1 && (
                            <select
                              value={jCurVariant}
                              onPointerDown={e => e.stopPropagation()}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setJobVariant(j.id, e.target.value as CardVariant)}
                              className="absolute inset-0 opacity-0 cursor-pointer"
                              aria-label="Variante ändern"
                            >
                              {jVariants.map(v => (
                                <option key={v} value={v}>{VARIANT_LABELS[v]}</option>
                              ))}
                            </select>
                          )}
                        </div>
                        <div className="relative">
                          <span
                            className="text-xs font-bold px-2 py-1.5 rounded inline-block"
                            style={{ background: jCondColor.bg, color: jCondColor.text }}
                          >
                            {jCurCondition}
                          </span>
                          <select
                            value={jCurCondition}
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setJobCondition(j.id, e.target.value as PersistedCondition)}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                            aria-label="Zustand ändern"
                          >
                            {CONDITIONS.map(c => (
                              <option key={c.value} value={c.value}>{c.short}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : <div />}
                  </div>
                </div>
              );
            };

            const clearLongPress = () => {
              if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
            };

            const handlePointerUp = (e: React.PointerEvent) => {
              const start = swipeStartXRef.current;
              swipeStartXRef.current = null;
              clearLongPress();
              if (longPressFiredRef.current) {
                // Long-Press hat schon getoggelt — Drag/Tap-Logik unterdrücken
                longPressFiredRef.current = false;
                setSingleDragX(0);
                return;
              }
              if (start == null) return;
              const dx = e.clientX - start;
              if (Math.abs(dx) < 40) {
                setSingleDragX(0);
                // Kurzer Tap → Detail-Sheet (Markieren erfolgt jetzt per Long-Press)
                if (canOpen) setActiveJobId(job.id);
                else if (isError) setErrorDetailJobId(job.id);
                return;
              }
              if (dx > 0) {
                if (nextJob) {
                  singleCommitDeltaRef.current = +1;
                  setSingleAnim('commit-next');
                } else {
                  setSingleAnim('snap-out');
                }
              } else {
                if (prevJob) {
                  singleCommitDeltaRef.current = -1;
                  setSingleAnim('commit-prev');
                } else {
                  setSingleAnim('snap-out');
                }
              }
            };

            // Outer container — feste Höhe, alles passt rein, keine Scroll
            const containerHeight = 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 170px)';
            const canOpen = job.status === 'done' && !!job.result?.card;
            const isError = job.status === 'error';

            // Dim-Faktor für Below/Incoming Panels — bei 0 (kein Drag) maximal
            // abgedunkelt, bei voller Drag-Strecke wieder original-hell.
            const dimProgress = singlePanelWidth > 0
              ? Math.min(1, Math.abs(singleDragX) / singlePanelWidth)
              : (singleAnim === 'commit-next' || singleAnim === 'commit-prev' ? 1 : 0);
            const dimOverlayOpacity = 0.55 * (1 - dimProgress);
            const dimTransition = singleAnim ? 'opacity 200ms ease-out' : undefined;

            return (
              <div
                ref={singlePanelRef}
                className="relative w-full touch-pan-y select-none overflow-hidden"
                style={{ height: containerHeight, minHeight: '320px' }}
                onPointerDown={e => {
                  if (singleAnim) return;
                  swipeStartXRef.current = e.clientX;
                  longPressFiredRef.current = false;
                  try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
                  // Long-Press-Timer: nach 500ms ohne signifikante Bewegung → Markierung togglen
                  clearLongPress();
                  if (canOpen) {
                    longPressTimerRef.current = setTimeout(() => {
                      longPressFiredRef.current = true;
                      toggleManualFlag(job.id);
                      longPressTimerRef.current = null;
                    }, 500);
                  }
                }}
                onPointerMove={e => {
                  const start = swipeStartXRef.current;
                  if (start == null || singleAnim) return;
                  const dx = e.clientX - start;
                  // Bei signifikanter Bewegung Long-Press abbrechen — der Nutzer swiped
                  if (Math.abs(dx) > 8) clearLongPress();
                  setSingleDragX(dx);
                }}
                onPointerUp={handlePointerUp}
                onPointerCancel={() => {
                  swipeStartXRef.current = null;
                  clearLongPress();
                  longPressFiredRef.current = false;
                  if (singleDragX > 0)      setSingleAnim('snap-out');
                  else if (singleDragX < 0 && prevJob) setSingleAnim('snap-in');
                  else if (singleDragX < 0) setSingleAnim('snap-out');
                }}
              >
                {/* Below-Layer (nächste Karte) — startet dunkel, hellt bei Right-Drag auf */}
                {showBelow && nextJob && (
                  <div className="absolute inset-0">
                    {renderPanel(nextJob, false)}
                    <div
                      className="absolute inset-0 pointer-events-none rounded-2xl"
                      style={{
                        background: '#000',
                        opacity: dimOverlayOpacity,
                        transition: dimTransition,
                      }}
                    />
                  </div>
                )}

                {/* Top-Layer (aktuelle Karte) */}
                <div
                  className="absolute inset-0"
                  style={{
                    transform: topTransform,
                    transition: topTransition,
                    willChange: 'transform',
                    zIndex: 2,
                  }}
                  onTransitionEnd={ev => {
                    if (ev.propertyName !== 'transform') return;
                    if (singleAnim === 'commit-next') {
                      setSingleIdx(idx => idx + 1);
                      setSingleDragX(0);
                      setSingleAnim(null);
                    } else if (singleAnim === 'snap-out') {
                      setSingleDragX(0);
                      setSingleAnim(null);
                    }
                  }}
                >
                  {renderPanel(job, !singleAnim && singleDragX === 0)}
                </div>

                {/* Incoming-Layer (vorherige Karte gleitet bei Left-Drag von rechts rein) */}
                {showIncoming && prevJob && (
                  <div
                    className="absolute inset-0"
                    style={{
                      transform: incomingTransform,
                      transition: incomingTransition,
                      willChange: 'transform',
                      zIndex: 3,
                    }}
                    onTransitionEnd={ev => {
                      if (ev.propertyName !== 'transform') return;
                      if (singleAnim === 'commit-prev') {
                        setSingleIdx(idx => Math.max(0, idx - 1));
                        setSingleDragX(0);
                        setSingleAnim(null);
                      } else if (singleAnim === 'snap-in') {
                        setSingleDragX(0);
                        setSingleAnim(null);
                      }
                    }}
                  >
                    {renderPanel(prevJob, false)}
                    <div
                      className="absolute inset-0 pointer-events-none rounded-2xl"
                      style={{
                        background: '#000',
                        opacity: dimOverlayOpacity,
                        transition: dimTransition,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
        );
      })()}

      {/* ── Header (schwebt oben) ──────────────────────────────────
          Im Review-Modus links Back-Arrow zurück zum Scan,
          rechts X-Close zum vollständigen Schließen. */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        {mode === 'review' ? (
          <button
            onClick={() => setMode('scanning')}
            className="flex items-center gap-1 h-9 px-3 rounded-full bg-white/10 backdrop-blur-sm text-white text-sm font-medium"
            aria-label="Zurück zum Scannen"
          >
            <ChevronLeft size={18} color="#fff" />
            Scannen
          </button>
        ) : <span />}
        {mode === 'scanning' && (
          <button
            onClick={handleClose}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-black/55 backdrop-blur-sm"
            aria-label="Scanner schließen"
          >
            <X size={18} color="#fff" />
          </button>
        )}
      </div>

      {/* Memory-Wächter-Banner — sichtbar wenn der Stapel zu groß wird */}
      {memoryLevel !== 'ok' && (
        <div
          className="absolute left-0 right-0 z-30 px-4 flex justify-center pointer-events-none"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 60px)' }}
        >
          <div
            className="pointer-events-auto rounded-lg px-3 py-2 text-sm font-semibold shadow-lg max-w-md text-center"
            style={{
              background: memoryLevel === 'critical' ? '#ef4444' : '#facc15',
              color: memoryLevel === 'critical' ? '#fff' : '#1a1a1a',
            }}
          >
            {memoryLevel === 'critical' ? (
              <>
                <div className="font-bold mb-0.5">Speicher fast voll ({unaddedCount} Karten)</div>
                <div className="text-xs font-normal opacity-90">
                  Bitte „Alle hinzufügen" oder „Alle löschen", dann kann der Scan weitergehen.
                </div>
              </>
            ) : (
              <>
                <div className="font-bold mb-0.5">{unaddedCount} Karten im Stapel</div>
                <div className="text-xs font-normal opacity-80">
                  Bitte zur Sammlung übernehmen oder löschen, bevor du weiterscannst.
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Hinzufügen-Modus: Thumbnail-Slider unten ──────────────────
          4 Tiles immer sichtbar, Rest per Swipe mit scroll-snap. */}
      {mode === 'scanning' && scanMode === 'add' && jobs.length > 0 && (
        <div
          className="absolute left-0 right-0 z-10 px-4"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)' }}
        >
          <div
            ref={sliderRef}
            className="flex gap-2 overflow-x-auto pb-3 pt-3"
            style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}
          >
            {(() => {
              // Nur Add-Origin-Jobs im Slider (recognize sind temporär + werden gepurged)
              const addJobs = jobs.filter(j => j.origin === 'add');
              return addJobs.map((job, idx) => (
                <ScannedCardTile
                  key={job.id}
                  job={job}
                  isLatest={idx === addJobs.length - 1}
                  onToggleFlag={() => toggleManualFlag(job.id)}
                  onRemove={() => removeJob(job.id)}
                  depthFromTop={addJobs.length - idx}
                  onFakeReasons={() => setFakeReasonsJobId(job.id)}
                  onVariantChange={v => setJobVariant(job.id, v)}
                  onConditionChange={c => setJobCondition(job.id, c)}
                />
              ));
            })()}
          </div>
        </div>
      )}

      {/* ── Erkennen-Modus: Processing-Spinner während Gemini lädt ──────
          Zeigt sich sofort nach dem Snap (Stream ist pausiert, Karte wird
          noch erkannt). Verschwindet, sobald `recognizedJobId` gesetzt ist
          und die große Karten-Anzeige übernimmt. */}
      {mode === 'scanning' && scanMode === 'recognize' && !recognizedJobId && (() => {
        const processing = jobs.find(j => j.origin === 'recognize' && j.status === 'processing');
        if (!processing) return null;
        return (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 pointer-events-none">
            <div
              className="flex flex-col items-center gap-3 px-6 py-5 rounded-2xl"
              style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
            >
              <Loader2 size={36} color="#fff" className="animate-spin" />
              <p className="text-white text-sm font-medium">Karte wird erkannt …</p>
            </div>
          </div>
        );
      })()}

      {/* ── Erkennen-Modus: Fehler-Anzeige mit differenzierter Diagnose ────
          Drei Fälle:
          - Gemini sah keine Karte (error="No card detected")
          - Gemini erkannte zu wenig (kein setCode + number + nationalDexNumber)
          - Catalog-Miss (Gemini-Werte ok, aber kein DB-Treffer)
          Debug-Box zeigt die strukturierten Gemini-Felder. */}
      {mode === 'scanning' && scanMode === 'recognize' && !recognizedJobId && (() => {
        const errored = jobs.find(j => j.origin === 'recognize' && j.status === 'error');
        if (!errored) return null;
        const { Icon: HeaderIcon, iconColor, cardName, attackTitle, attackText } = classifyJobError(errored);

        const retry = () => {
          setJobs(prev => prev.filter(j => j.id !== errored.id));
          setStreamPaused(false);
        };

        return (
          <div
            className="absolute inset-x-0 z-10 flex flex-col items-center px-6 gap-3 pointer-events-none"
            style={{
              top: 'calc(env(safe-area-inset-top, 0px) + 56px)',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
            }}
          >
            {/* Pokémon-Karten-Look: Error-Edition */}
            <div
              className="relative pointer-events-auto"
              style={{
                aspectRatio: '63 / 88',
                height: 'min(70vh, 100%)',
                maxWidth: '100%',
                borderRadius: 14,
                background: 'linear-gradient(180deg, #f5d97c 0%, #e8b942 100%)',
                padding: 8,
                boxShadow: '0 10px 40px rgba(0,0,0,0.55)',
              }}
            >
              {/* Innerer Kartenrahmen */}
              <div
                className="w-full h-full flex flex-col"
                style={{
                  borderRadius: 8,
                  background: 'linear-gradient(180deg, #fef5d2 0%, #fce8a8 100%)',
                  overflow: 'hidden',
                }}
              >
                {/* Header: Name + HP + Nummer */}
                <div
                  className="flex items-center justify-between px-3 py-2 gap-2"
                  style={{ background: 'rgba(220,38,38,0.12)' }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white shrink-0"
                      style={{ background: 'var(--pokedex-red)' }}
                    >
                      ERR
                    </span>
                    <span className="text-base font-extrabold leading-none truncate" style={{ color: '#1a1a1a' }}>
                      {cardName}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-0.5 shrink-0">
                    <span className="text-[10px] font-bold" style={{ color: '#1a1a1a' }}>KP</span>
                    <span className="text-base font-extrabold" style={{ color: 'var(--pokedex-red)' }}>404</span>
                  </div>
                </div>

                {/* Artwork-Bereich: MissingNo-Pokémon + Fehlertyp-Icon */}
                <div
                  className="flex-1 mx-3 my-2 relative flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, rgba(220,38,38,0.18) 0%, rgba(220,38,38,0.05) 100%)',
                    border: '3px solid rgba(0,0,0,0.55)',
                    borderRadius: 4,
                    minHeight: 100,
                  }}
                >
                  <MissingNoArtwork size={144} color="#1a1a1a" tint={iconColor} />
                  {/* Sekundäres Fehler-Icon oben rechts (klein) */}
                  <div className="absolute top-2 right-2">
                    <HeaderIcon size={24} color={iconColor} strokeWidth={2} />
                  </div>
                </div>

                {/* Beschreibungs-Banner — Stufe + Pokédex-Nr.-Stil */}
                <div className="px-3 py-1 text-[10px] italic flex items-center gap-1.5" style={{ color: '#1a1a1a' }}>
                  <span className="font-mono">Nr. 0404</span>
                  <span>·</span>
                  <span>Fehler-Pokémon</span>
                  <span>·</span>
                  <span>Größe ?,? m</span>
                </div>

                {/* Attacken-Box */}
                <div className="px-3 py-2 flex-grow-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{attackTitle}</span>
                    <span className="text-xs font-extrabold" style={{ color: 'var(--pokedex-red)' }}>HTTP</span>
                  </div>
                  <p className="text-[11px] leading-snug" style={{ color: '#3a3a3a' }}>
                    {attackText}
                  </p>
                </div>

                {/* Footer: Set-Code + Nummer (echtes Pokémon-Layout) */}
                <div
                  className="flex items-center justify-between px-3 py-1 text-[10px] font-mono"
                  style={{ background: 'rgba(0,0,0,0.06)', color: '#1a1a1a' }}
                >
                  <span className="flex items-center gap-1">
                    <span className="font-bold" style={{ color: 'var(--pokedex-red)' }}>ERR</span>
                    <span>404/404</span>
                  </span>
                  <span className="text-[9px]">©Pokédex Error-Edition</span>
                </div>
              </div>
            </div>

            {/* Erneut-scannen-Button */}
            <button
              onClick={retry}
              className="pointer-events-auto w-full h-12 rounded-full text-white font-semibold flex items-center justify-center gap-2 shadow-lg"
              style={{ background: 'var(--pokedex-red)' }}
            >
              Erneut scannen
            </button>
          </div>
        );
      })()}

      {/* ── Erkennen-Modus: zentrale große Karten-Anzeige ──────────────
          Zeigt nur den zuletzt erfolgreich gescannten Job. Neuer Scan
          überschreibt visuell, aber alle Scans bleiben in `jobs`. */}
      {mode === 'scanning' && scanMode === 'recognize' && recognizedJobId && (() => {
        const recognized = jobs.find(j => j.id === recognizedJobId) ?? null;
        if (!recognized?.result?.card) return null;
        return (
          <RecognizedCardLarge
            job={recognized}
            onCardTap={() => setActiveJobId(recognized.id)}
            onAdd={() => setQuickAddJobId(recognized.id)}
            onVariantChange={v => setJobVariant(recognized.id, v)}
            onConditionChange={c => setJobCondition(recognized.id, c)}
            onDebugTap={() => setDebugJobId(recognized.id)}
          />
        );
      })()}

      {/* ── Bulk-Action-Row: Alle hinzufügen / Alle löschen ─────────────
          Sichtbar wenn Karten im Slider (Add-Modus) oder im Review-Grid.
          Im Add-Modus zwischen Slider und Toolbar.
          Im Review-Modus direkt über der Safe-Area (Toolbar ist dort weg). */}
      {(() => {
        const visible = mode === 'review' && jobs.length > 0 && viewMode !== 'single';
        if (!visible) return null;
        const unaddedCount = jobs.filter(j => j.status === 'done' && !!j.result?.card && !j.added).length;
        return (
          <div
            className="absolute left-0 right-0 z-40 flex gap-2 px-4"
            style={{
              // BottomNav ist im Review-Modus ausgeblendet → Bulk-Row übernimmt
              // die Footer-Rolle, sitzt direkt am unteren Rand + Safe-Area.
              bottom: 0,
              paddingTop: 10,
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)',
              background: 'rgba(0,0,0,0.85)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            <button
              onClick={clearAllJobs}
              className="flex-1 h-11 rounded-md text-sm font-semibold text-white flex items-center justify-center gap-1.5"
              style={{ background: 'var(--action-delete)' }}
            >
              <Trash2 size={15} color="#fff" />
              Alle löschen
            </button>
            <button
              onClick={openBulkAdd}
              disabled={unaddedCount === 0}
              className="flex-1 h-11 rounded-md text-sm font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
              style={{ background: 'var(--action-add)' }}
            >
              <Plus size={16} strokeWidth={3} />
              {`Alle hinzufügen${unaddedCount > 0 ? ` (${unaddedCount})` : ''}`}
            </button>
          </div>
        );
      })()}


      {/* Footer wird jetzt von der globalen BottomNav übernommen.
          Stream-Pause, Mode-Switch und Grid-Button laufen über Custom-Events
          (siehe useEffect am Anfang der Component). */}

      {/* ── Bulk-Add-Modal: „Alle hinzufügen" fragt Werte ab ─────────── */}
      {bulkModalOpen && (() => {
        const targets = jobs.filter(j => j.status === 'done' && !!j.result?.card && !j.added);
        const bulkJobs = targets.map(j => ({
          id: j.id,
          card: j.result!.card!,
          language: j.result!.language,
          editedVariant: j.editedVariant,
          editedCondition: j.editedCondition,
        }));
        return (
          <BulkAddToCollectionModal
            jobs={bulkJobs}
            onClose={() => setBulkModalOpen(false)}
            onJobSaved={(id) => markAdded(id)}
            onAllSaved={() => setBulkModalOpen(false)}
          />
        );
      })()}

      {/* ── Fehler-Diagnose-Modal — tappbar von jeder Error-Tile ──────── */}
      {errorDetailJob && (() => {
        const job = errorDetailJob;
        const gp = job.debug?.geminiParsed as
          | { error?: string; setCode?: string | null; number?: string | null;
              language?: string; confidence?: string; nationalDexNumber?: number | null;
              _symbolMatch?: GeminiResponse['_symbolMatch'] }
          | undefined;

        let HeaderIcon = AlertCircle;
        let iconColor = '#f87171';
        let title = 'Karte konnte nicht erkannt werden';
        let hint = 'Halte die Karte deutlicher in den Rahmen oder versuche eine andere Belichtung.';
        let kind: 'gemini-blind' | 'gemini-thin' | 'catalog-miss' = 'catalog-miss';
        if (gp?.error || job.debug?.error === 'No card detected') {
          kind = 'gemini-blind';
          HeaderIcon = EyeOff;
          iconColor = '#facc15';
          title = 'Keine Karte im Bild';
          hint = 'Bitte Karte deutlicher in den Rahmen halten.';
        } else if (!gp?.setCode && !gp?.number && !gp?.nationalDexNumber) {
          kind = 'gemini-thin';
          HeaderIcon = AlertTriangle;
          iconColor = '#fb923c';
          title = 'Karten-Text konnte nicht gelesen werden';
          hint = 'Beleuchte die Karte stärker oder rücke näher heran.';
        } else {
          kind = 'catalog-miss';
          HeaderIcon = SearchX;
          iconColor = '#f87171';
          title = 'Karte nicht im Katalog gefunden';
          hint = 'Möglicherweise ein Set, das noch nicht synchronisiert ist.';
        }

        const close = () => setErrorDetailJobId(null);
        const removeAndClose = () => {
          setJobs(prev => prev.filter(j => j.id !== job.id));
          close();
        };

        return (
          <div
            className="fixed inset-0 z-[70] flex items-end"
            onClick={close}
          >
            <div className="absolute inset-0 bg-black/60" />
            <div
              className="relative w-full rounded-t-2xl bg-card border-t border-border p-5 pb-safe flex flex-col gap-3"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full bg-border mx-auto" />
              <div className="flex flex-col items-center gap-2 text-center">
                <HeaderIcon size={36} color={iconColor} />
                <p className="text-base font-semibold leading-tight">{title}</p>
                <p className="text-sm text-muted-foreground leading-snug max-w-xs">{hint}</p>
              </div>

              {gp && kind !== 'gemini-blind' && (
                <div
                  className="rounded-lg px-3 py-2.5"
                  style={{ background: 'var(--secondary)', fontFamily: 'monospace' }}
                >
                  <div className="text-[10px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Gemini
                  </div>
                  <div className="grid grid-cols-[80px_1fr] gap-x-2 text-[12px] leading-snug">
                    <span className="text-muted-foreground">Set-Code</span>
                    <span>
                      {gp.setCode ?? <span className="text-muted-foreground">— (Symbol)</span>}
                      {gp.setCode && gp._symbolMatch?.triggered && (
                        <span className="text-muted-foreground text-[10px]"> (Symbol-Abgleich, {gp._symbolMatch.matchConfidence ?? '?'}{gp._symbolMatch.matchAmbiguous ? ', mehrdeutig' : ''})</span>
                      )}
                    </span>
                    <span className="text-muted-foreground">Nummer</span>
                    <span>{gp.number ?? <span className="text-muted-foreground">—</span>}</span>
                    <span className="text-muted-foreground">Sprache</span>
                    <span>{gp.language ?? '—'}</span>
                    <span className="text-muted-foreground">Dex-Nr.</span>
                    <span>{gp.nationalDexNumber ?? <span className="text-muted-foreground">—</span>}</span>
                    <span className="text-muted-foreground">Confidence</span>
                    <span>{gp.confidence ?? '—'}</span>
                  </div>
                  {kind === 'catalog-miss' && job.debugInfo && (
                    <div className="text-[11px] text-muted-foreground mt-1.5 break-words">
                      {job.debugInfo.split('|').slice(-1)[0].trim()}
                    </div>
                  )}
                </div>
              )}

              {/* An Gemini hochgeladenes Bild — zeigt, was tatsächlich gesnappt wurde
                  (Karte sauber / abgeschnitten / leerer Frame mit Hand?) */}
              {job.debug?.imageBase64 && (
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--secondary)' }}>
                  <p className="text-[10px] text-muted-foreground px-2 py-1 uppercase tracking-wide font-mono">
                    An Gemini gesendet{job.debug.imageSizeKb ? ` · ${job.debug.imageSizeKb} KB` : ''}
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:${job.debug.mimeType ?? 'image/jpeg'};base64,${job.debug.imageBase64}`}
                    alt="Scan-Crop"
                    className="w-full object-contain bg-black"
                    style={{ maxHeight: 280 }}
                  />
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={removeAndClose}
                  className="flex-1 h-11 rounded-full font-semibold text-sm flex items-center justify-center gap-1.5"
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    color: 'var(--foreground)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <Trash2 size={15} color="#ef4444" />
                  Entfernen
                </button>
                <button
                  onClick={close}
                  className="flex-1 h-11 rounded-full font-semibold text-sm text-white"
                  style={{ background: 'var(--pokedex-red)' }}
                >
                  Schließen
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Closing-Overlay: Karten werden in Inbox gespeichert ──────── */}
      {closingSaving && (
        <div className="fixed inset-0 z-[70] bg-black/85 flex flex-col items-center justify-center gap-3">
          <Loader2 size={32} color="#fff" className="animate-spin" />
          <p className="text-white text-sm">Karten werden gespeichert …</p>
        </div>
      )}

      {/* ── Debug-Modal ──────────────────────────────────────────── */}
      {debugJob?.debug && (
        <div
          className="fixed inset-0 z-50 bg-black/90 overflow-y-auto"
          onClick={() => setDebugJobId(null)}
        >
          <div
            className="min-h-full px-4 py-6"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold text-base">Debug-Info</h2>
              <button
                onClick={() => setDebugJobId(null)}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10"
                aria-label="Schließen"
              >
                <X size={18} color="#fff" />
              </button>
            </div>

            {/* Aufgenommenes Bild */}
            {debugJob.debug.imageBase64 && (
              <div className="mb-4">
                <p className="text-white/60 text-xs mb-2 font-mono">An Gemini gesendetes Bild ({debugJob.debug.imageSizeKb} KB)</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:${debugJob.debug.mimeType ?? 'image/jpeg'};base64,${debugJob.debug.imageBase64}`}
                  alt="Captured"
                  className="w-full rounded-lg border border-white/20"
                />
              </div>
            )}

            {/* Timing */}
            <div className="mb-4 p-3 rounded-lg bg-white/5 text-xs font-mono text-white/80">
              <div>Modell: <span className="text-blue-300">{debugJob.debug.geminiModel ?? '—'}</span></div>
              <div>Payload: <span className="text-blue-300">{debugJob.debug.imageSizeKb ?? '—'} KB</span></div>
              <div>Upload (wire): <span className="text-blue-300">{debugJob.debug.uploadMs ?? '—'} ms</span></div>
              <div>Gemini: <span className="text-blue-300">{debugJob.debug.geminiMs ?? '—'} ms</span></div>
              <div>Lookup: <span className="text-blue-300">{debugJob.debug.lookupMs ?? '—'} ms</span></div>
              <div>Owned: <span className="text-blue-300">{debugJob.debug.ownedMs ?? '—'} ms</span> <span className="text-white/40">(async)</span></div>
              <div className="pt-1 border-t border-white/10 mt-1">
                Gesamt (Render): <span className="text-blue-300">{debugJob.debug.totalMs ?? '—'} ms</span>
              </div>
              {debugJob.debug.error && (
                <div className="text-red-300 mt-1">Fehler: {debugJob.debug.error}</div>
              )}
            </div>

            {/* Symbol-Abgleich (Schritt 2) — immer sichtbar, auch wenn nicht ausgelöst */}
            {(() => {
              const sm = (debugJob.debug.geminiParsed as { _symbolMatch?: GeminiResponse['_symbolMatch'] } | undefined)?._symbolMatch;
              return (
                <div className="mb-4">
                  <p className="text-white/60 text-xs mb-2 font-mono">Symbol-Abgleich (Schritt 2)</p>
                  <div className="p-3 rounded-lg bg-white/5 text-xs font-mono text-white/80 space-y-0.5">
                    <div>Ausgelöst: <span className={sm?.triggered ? 'text-yellow-300' : 'text-white/40'}>{sm?.triggered ? 'ja' : 'nein'}</span></div>
                    {!sm?.triggered && sm?.reason && (
                      <div className="text-white/50">Grund: {sm.reason}</div>
                    )}
                    {sm?.triggered && (
                      <>
                        <div>Modell: <span className="text-blue-300">{sm.model ?? '—'}</span></div>
                        <div>Gemini (Schritt 2): <span className="text-blue-300">{sm.ms ?? '—'} ms</span></div>
                        <div>Referenzblätter bauen: <span className="text-blue-300">{sm.sheetBuildMs ?? '—'} ms</span> <span className="text-white/40">(0 ms = bereits gecacht)</span></div>
                        <div>Blätter geprüft: <span className="text-blue-300">{sm.sheetsUsed?.length ?? 0}</span></div>
                        <div>Match: <span className="text-blue-300">{sm.matchedSetCode ?? '— (kein Match)'}</span></div>
                        {sm.rejectedMatch && (
                          <div className="text-orange-300">Verworfen: &quot;{sm.rejectedMatch}&quot; ist auf keinem Blatt ein echter Set-Code (vermutlich Typ-Icon verwechselt)</div>
                        )}
                        <div>Confidence: <span className="text-blue-300">{sm.matchConfidence ?? '—'}</span>{sm.matchAmbiguous && <span className="text-orange-300"> · mehrdeutig</span>}</div>
                        {sm.error && <div className="text-red-300">Fehler: {sm.error}</div>}
                      </>
                    )}
                  </div>
                  {sm?.rawText && (
                    <pre className="mt-2 p-3 rounded-lg bg-white/5 text-[10px] text-green-200 overflow-x-auto font-mono whitespace-pre-wrap break-all">
{sm.rawText}
                    </pre>
                  )}
                </div>
              );
            })()}

            {/* Gemini-Antwort */}
            <div className="mb-4">
              <p className="text-white/60 text-xs mb-2 font-mono">Gemini-Antwort (geparst)</p>
              <pre className="p-3 rounded-lg bg-white/5 text-[10px] text-green-200 overflow-x-auto font-mono whitespace-pre-wrap break-all">
{JSON.stringify(debugJob.debug.geminiParsed, null, 2)}
              </pre>
            </div>

            {/* Rohantwort */}
            {debugJob.debug.geminiRaw && (
              <div className="mb-4">
                <p className="text-white/60 text-xs mb-2 font-mono">Gemini-Rohantwort</p>
                <pre className="p-3 rounded-lg bg-white/5 text-[10px] text-white/70 overflow-x-auto font-mono whitespace-pre-wrap break-all">
{debugJob.debug.geminiRaw}
                </pre>
              </div>
            )}

            {/* DB-Lookup */}
            <div className="mb-4">
              <p className="text-white/60 text-xs mb-2 font-mono">Firestore-Lookups</p>
              <div className="p-3 rounded-lg bg-white/5 text-[10px] font-mono text-white/80 space-y-1">
                {debugJob.debug.lookupSteps && debugJob.debug.lookupSteps.length > 0 ? (
                  debugJob.debug.lookupSteps.map((step, i) => (
                    <div key={i} className={step.endsWith('null') ? 'text-red-300' : 'text-green-300'}>
                      {i + 1}. {step}
                    </div>
                  ))
                ) : (
                  <div className="text-white/40">Kein Lookup durchgeführt</div>
                )}
                <div className="pt-2 border-t border-white/10 mt-2">
                  Ergebnis: {debugJob.debug.catalogMatch
                    ? <span className="text-green-300">{debugJob.debug.catalogMatch.name} ({debugJob.debug.catalogMatch.setId}/{debugJob.debug.catalogMatch.number})</span>
                    : <span className="text-red-300">nicht gefunden</span>}
                </div>
              </div>
            </div>

            {/* Bild-Verifikation (pHash) — vergleicht Foto gegen Katalog-Bild */}
            {debugJob.debug.catalogMatch && (() => {
              const dist = debugJob.pHashDistance;
              const cls = dist == null ? null : dist <= 11 ? 'match' : dist <= 19 ? 'unsure' : 'mismatch';
              const clsColor = cls === 'match' ? 'text-green-300' : cls === 'unsure' ? 'text-yellow-300' : cls === 'mismatch' ? 'text-red-300' : 'text-white/40';
              const catalogImg = cardImgUrl(debugJob) ?? cardImgUrlLarge(debugJob);
              return (
                <div className="mb-4">
                  <p className="text-white/60 text-xs mb-2 font-mono">Bild-Verifikation (pHash)</p>
                  <div className="p-3 rounded-lg bg-white/5">
                    <div className="flex gap-2 mb-2">
                      <div className="flex-1">
                        <p className="text-[10px] text-white/40 mb-1 font-mono">Foto</p>
                        {debugJob.debug.imageBase64 ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={`data:${debugJob.debug.mimeType ?? 'image/jpeg'};base64,${debugJob.debug.imageBase64}`}
                            alt="Gescanntes Foto"
                            className="w-full rounded border border-white/20 object-contain"
                            style={{ maxHeight: 180 }}
                          />
                        ) : (
                          <div className="w-full h-24 rounded border border-white/10 flex items-center justify-center text-white/30 text-[10px]">
                            gelöscht (&gt;60s)
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-[10px] text-white/40 mb-1 font-mono">Katalog</p>
                        {catalogImg ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={catalogImg}
                            alt="Katalog-Bild"
                            className="w-full rounded border border-white/20 object-contain"
                            style={{ maxHeight: 180 }}
                          />
                        ) : (
                          <div className="w-full h-24 rounded border border-white/10 flex items-center justify-center text-white/30 text-[10px]">
                            kein Bild
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-xs font-mono text-white/80">
                      Hamming-Distanz: <span className={clsColor}>{dist ?? '— (lädt/nicht verfügbar)'}</span>
                      {cls && <span className={clsColor}> · {cls}</span>}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── CardDetailSheet (öffnet sich beim Tap auf eine erkannte Karte) ─ */}
      <CardDetailSheet
        card={activeJob?.result?.card ?? null}
        ownedCopies={activeOwnedCopies}
        onClose={() => setActiveJobId(null)}
        onSaved={() => {
          if (activeJob) markAdded(activeJob.id);
        }}
      />

      {/* ── Quick-Add-Modal (via + Button auf der Tile) ────────────────
          Öffnet AddToCollectionModal mit Variante/Condition/Sprache
          aus den Job-Werten vorbelegt — User pickt nur Binder + speichert. */}
      {quickAddJob?.result?.card && (
        <AddToCollectionModal
          card={quickAddJob.result.card}
          preVariant={quickAddJob.editedVariant ?? quickAddJob.result.variant}
          preCondition={quickAddJob.editedCondition}
          preLanguage={quickAddJob.result.language}
          fromScanner={quickAddJob.origin === 'add'}
          onClose={() => setQuickAddJobId(null)}
          onSaved={() => {
            markAdded(quickAddJob.id);
            setQuickAddJobId(null);
          }}
        />
      )}

      {/* ── Fake-Reasons-Sheet (warum Gemini Fake/Verdacht meldet) ─────── */}
      {fakeReasonsJob?.result && (fakeReasonsJob.result.fakeRisk === 'medium' || fakeReasonsJob.result.fakeRisk === 'high') && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center"
          onClick={() => setFakeReasonsJobId(null)}
        >
          <div
            className="w-full max-w-md bg-card rounded-t-2xl p-5 pb-8 shadow-elevated"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 32px)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle
                size={22}
                color={fakeReasonsJob.result.fakeRisk === 'high' ? '#ef4444' : '#facc15'}
                fill={fakeReasonsJob.result.fakeRisk === 'high' ? '#ef4444' : '#facc15'}
              />
              <h3 className="text-foreground font-semibold text-base">
                {fakeReasonsJob.result.fakeRisk === 'high' ? 'Fake-Verdacht' : 'Verdächtig'}
              </h3>
              <button
                onClick={() => setFakeReasonsJobId(null)}
                className="ml-auto w-9 h-9 rounded-full bg-secondary flex items-center justify-center"
                aria-label="Schließen"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Gemini meldet diese Karte als <strong>{fakeReasonsJob.result.fakeRisk === 'high' ? 'wahrscheinlich gefälscht' : 'verdächtig'}</strong>. Begründungen:
            </p>
            {fakeReasonsJob.result.fakeReasons && fakeReasonsJob.result.fakeReasons.length > 0 ? (
              <ul className="space-y-2 text-sm text-foreground">
                {fakeReasonsJob.result.fakeReasons.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Keine spezifischen Gründe genannt. Manchmal liegt's an Bildqualität, Beleuchtung oder Reflexionen — kein zwingender Fake-Hinweis.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ───── Scanned-Card-Tile ─────────────────────────────────────────────────
// Tile-Breite: (100vw − 32px Container-Padding − 24px für 3 Gaps) / 4
const TILE_WIDTH_CSS = 'calc((100vw - 56px) / 4)';

interface ScannedCardTileProps {
  job: ScanJob;
  isLatest:          boolean;
  /** Tap im Slider — nur für none / manual-yellow aktiv (toggelt Flag). */
  onToggleFlag:      () => void;
  onRemove:          () => void;
  /** Aktuelle Position des Jobs „von oben" in der Auffang-Box (für Badge). */
  depthFromTop:      number;
  onFakeReasons:     () => void;
  onVariantChange:   (v: CardVariant) => void;
  onConditionChange: (c: PersistedCondition) => void;
}

function ScannedCardTile({
  job, isLatest, onToggleFlag, onRemove, depthFromTop, onFakeReasons,
  onVariantChange, onConditionChange,
}: ScannedCardTileProps) {
  const img       = cardImgUrl(job);
  const card      = job.result?.card;
  const isError   = job.status === 'error';
  const borderStatus = computeBorderStatus(job);
  const tappable  = borderStatus === 'none' || borderStatus === 'manual-yellow';
  const cardVariants = card?.variants?.length ? card.variants : (['standard'] as CardVariant[]);
  const variant   = job.editedVariant   ?? cardVariants[0];
  const condition = job.editedCondition ?? 'NM';
  const condColor = PERSISTED_CONDITION_COLOR[condition];

  return (
    <div
      className="shrink-0 flex flex-col gap-1.5"
      style={{
        width: TILE_WIDTH_CSS,
        scrollSnapAlign: 'end',
        transform: isLatest ? 'scale(1.08)' : undefined,
        transformOrigin: 'right bottom',
        transition: 'transform 0.2s ease-out',
        zIndex: isLatest ? 2 : 1,
      }}
    >
      {/* Karten-Body */}
      <div
        className="relative w-full rounded-md overflow-hidden"
        style={{
          aspectRatio: '63 / 88',
          ...borderStyleFor(borderStatus, job.result?.fakeRisk),
          background: '#1a1a1a',
          cursor: tappable ? 'pointer' : 'default',
        }}
        onClick={tappable ? onToggleFlag : undefined}
      >
        {job.status === 'processing' ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 size={24} color="rgba(255,255,255,0.4)" className="animate-spin" />
          </div>
        ) : isError ? (() => {
          const ec = classifyJobError(job);
          const snap = job.debug?.imageBase64;
          const snapSrc = snap
            ? `data:${job.debug?.mimeType ?? 'image/jpeg'};base64,${snap}`
            : null;
          return (
            <div
              className="w-full h-full flex flex-col"
              style={{
                background: 'linear-gradient(180deg, #f5d97c 0%, #e8b942 100%)',
                padding: 3,
              }}
            >
              <div
                className="flex-1 flex flex-col"
                style={{
                  background: 'linear-gradient(180deg, #fef5d2 0%, #fce8a8 100%)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  className="flex items-center justify-between px-1 py-0.5 gap-0.5"
                  style={{ background: 'rgba(220,38,38,0.12)' }}
                >
                  <span className="text-[8px] font-extrabold truncate" style={{ color: '#1a1a1a' }}>
                    {ec.cardName}
                  </span>
                  <span className="text-[8px] font-extrabold shrink-0" style={{ color: 'var(--pokedex-red)' }}>
                    404
                  </span>
                </div>
                <div
                  className="flex-1 mx-0.5 my-0.5 relative overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, rgba(220,38,38,0.18) 0%, rgba(220,38,38,0.05) 100%)',
                    border: '1.5px solid rgba(0,0,0,0.55)',
                    borderRadius: 2,
                  }}
                >
                  {snapSrc ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={snapSrc} alt="Scan" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <MissingNoArtwork size={48} color="#1a1a1a" tint={ec.iconColor} />
                    </div>
                  )}
                </div>
                <div
                  className="px-1 py-0.5 text-[7px] font-mono flex items-center justify-between"
                  style={{ background: 'rgba(0,0,0,0.06)', color: '#1a1a1a' }}
                >
                  <span className="font-bold" style={{ color: 'var(--pokedex-red)' }}>ERR</span>
                  <span>404</span>
                </div>
              </div>
            </div>
          );
        })() : !img ? (
          <div className="w-full h-full flex items-center justify-center bg-red-500/10">
            <AlertCircle size={22} color="#f87171" />
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={img} alt={card?.name ?? ''} className="w-full h-full object-cover" />
        )}

        {/* Depth-Badge — Position in der Auffang-Box (nur für markierte/problem Tiles) */}
        {(borderStatus === 'manual-yellow' || borderStatus === 'auto-yellow' || borderStatus === 'auto-red') && (
          <div
            className="absolute top-0.5 left-0.5 px-1 py-0 rounded text-[8px] font-mono font-bold"
            style={{
              background: borderStatus === 'auto-red' ? 'rgba(239,68,68,0.92)' : 'rgba(250,204,21,0.92)',
              color: borderStatus === 'auto-red' ? '#fff' : '#1a1a1a',
            }}
          >
            #{depthFromTop}
          </div>
        )}

        {/* Trash unten rechts (~2 px Abstand zum Rand) */}
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          className="absolute bottom-0.5 right-0.5 w-7 h-7 rounded-md flex items-center justify-center text-white"
          style={{ background: 'var(--action-delete)' }}
          aria-label="Entfernen"
        >
          <Trash2 size={14} />
        </button>

        {/* Wert-Badge unten links — sichtbar nur ab Tier 'wertvoll' */}
        {card && (
          <div className="absolute bottom-0.5 left-0.5">
            <ValueBadge tcgId={card.id} iconOnly />
          </div>
        )}

        {/* Fake-Warnung (Mitte oben, über Variant/Condition-Pills) */}
        {(job.result?.fakeRisk === 'medium' || job.result?.fakeRisk === 'high') && (
          <button
            onClick={e => { e.stopPropagation(); onFakeReasons(); }}
            className="absolute left-1/2 -translate-x-1/2 w-7 h-7 rounded-full flex items-center justify-center"
            style={{ top: 2, background: 'rgba(0,0,0,0.75)' }}
            aria-label="Fake-Verdacht-Gründe"
          >
            <AlertTriangle
              size={14}
              color={job.result?.fakeRisk === 'high' ? '#ef4444' : '#facc15'}
              fill={job.result?.fakeRisk === 'high' ? '#ef4444' : '#facc15'}
            />
          </button>
        )}

        {/* Variant-Pill (top-left) */}
        {card && (
          <div className="absolute top-0.5 left-0.5">
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-block"
              style={{ background: 'rgba(0,0,0,0.78)', color: '#fff' }}
            >
              {VARIANT_LABELS[variant]}
            </span>
            <select
              value={variant}
              onClick={e => e.stopPropagation()}
              onChange={e => onVariantChange(e.target.value as CardVariant)}
              className="absolute inset-0 opacity-0 cursor-pointer"
              aria-label="Variante ändern"
            >
              {cardVariants.map(v => (
                <option key={v} value={v}>{VARIANT_LABELS[v]}</option>
              ))}
            </select>
          </div>
        )}

        {/* Condition-Pill (top-right) */}
        {card && (
          <div className="absolute top-0.5 right-0.5">
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-block"
              style={{ background: condColor.bg, color: condColor.text }}
            >
              {condition}
            </span>
            <select
              value={condition}
              onClick={e => e.stopPropagation()}
              onChange={e => onConditionChange(e.target.value as PersistedCondition)}
              className="absolute inset-0 opacity-0 cursor-pointer"
              aria-label="Zustand ändern"
            >
              {CONDITIONS.map(c => (
                <option key={c.value} value={c.value}>{c.short}</option>
              ))}
            </select>
          </div>
        )}

        {/* Added-Overlay */}
        {job.added && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Check size={28} color="#48bb78" strokeWidth={3} />
          </div>
        )}
      </div>

    </div>
  );
}

// ───── Recognized-Card-Large ─────────────────────────────────────────────
// Zentrale große Karten-Anzeige im Erkennen-Modus. Banner oben zeigt Owned-
// Status (grün=in Sammlung, rot=neu). Pills bleiben editierbar (für Stufe-2-
// Add-Workflow via Tap), aber kein Trash, kein Add-Button.

interface RecognizedCardLargeProps {
  job: ScanJob;
  onCardTap:         () => void;
  onAdd:             () => void;
  onVariantChange:   (v: CardVariant) => void;
  onConditionChange: (c: PersistedCondition) => void;
  onDebugTap:        () => void;
}

function RecognizedCardLarge({
  job, onCardTap, onAdd, onVariantChange, onConditionChange, onDebugTap,
}: RecognizedCardLargeProps) {
  const img       = cardImgUrlLarge(job);
  const card      = job.result?.card;
  // Gleiche Priorität wie Slider/Review-Grid: pHash-Mismatch/Unsure > manuelle
  // Markierung > Fake-Risk-Farbe > neutral (siehe computeBorderStatus/borderStyleFor).
  const { border: cardBorder } = borderStyleFor(computeBorderStatus(job), job.result?.fakeRisk);
  const cardVariants = card?.variants?.length ? card.variants : (['standard'] as CardVariant[]);
  const variant   = job.editedVariant   ?? cardVariants[0];
  const condition = job.editedCondition ?? 'NM';
  const condColor = PERSISTED_CONDITION_COLOR[condition];

  const ownedCount = job.result?.ownedCount;
  const isOwned    = (ownedCount ?? 0) > 0;
  const ownedKnown = ownedCount !== undefined;

  return (
    <div
      className="absolute inset-x-0 z-10 flex flex-col items-center px-6 gap-3"
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + 56px)',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
      }}
    >
      {/* Pokemon-Name + Debug-Zugang */}
      <div className="relative w-full flex items-center justify-center">
        <h2 className="text-white font-semibold text-lg truncate text-center max-w-full">
          {card?.name ?? 'Karte'}
        </h2>
        <button
          onClick={onDebugTap}
          className="absolute right-0 w-8 h-8 flex items-center justify-center rounded-full bg-white/10"
          aria-label="Debug-Infos anzeigen"
        >
          <Bug size={16} color="#fff" />
        </button>
      </div>

      {/* Karten-Body — Höhe begrenzt durch verfügbaren Platz, Breite via aspect-ratio */}
      <div
        className="relative rounded-lg overflow-hidden"
        style={{
          aspectRatio: '63 / 88',
          height: 'min(70vh, 100%)',
          maxWidth: '100%',
          border: cardBorder,
          background: '#1a1a1a',
          cursor: card ? 'pointer' : 'default',
        }}
        onClick={card ? onCardTap : undefined}
      >
        {img ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={img} alt={card?.name ?? ''} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-red-500/10">
            <AlertCircle size={28} color="#f87171" />
          </div>
        )}

        {/* Variant-Pill unten links */}
        {card && (
          <div className="absolute bottom-2 left-2">
            <span
              className="text-xs font-bold px-3 py-1.5 rounded-lg inline-block"
              style={{ background: 'rgba(0,0,0,0.75)', color: '#fff' }}
            >
              {VARIANT_LABELS[variant]}
            </span>
            <select
              value={variant}
              onClick={e => e.stopPropagation()}
              onChange={e => onVariantChange(e.target.value as CardVariant)}
              className="absolute inset-0 opacity-0 cursor-pointer"
              aria-label="Variante ändern"
            >
              {cardVariants.map(v => (
                <option key={v} value={v}>{VARIANT_LABELS[v]}</option>
              ))}
            </select>
          </div>
        )}

        {/* Condition-Pill unten rechts */}
        {card && (
          <div className="absolute bottom-2 right-2">
            <span
              className="text-xs font-bold px-3 py-1.5 rounded-lg inline-block"
              style={{ background: condColor.bg, color: condColor.text }}
            >
              {condition}
            </span>
            <select
              value={condition}
              onClick={e => e.stopPropagation()}
              onChange={e => onConditionChange(e.target.value as PersistedCondition)}
              className="absolute inset-0 opacity-0 cursor-pointer"
              aria-label="Zustand ändern"
            >
              {CONDITIONS.map(c => (
                <option key={c.value} value={c.value}>{c.short}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Set-Code + Nummer + Cardmarket-Preis */}
      <div className="flex items-center justify-center gap-2">
        <p className="text-sm text-white/70 text-center font-mono">
          {card?.setCode ? `${card.setCode} ${card.number}` : '—'}
        </p>
        {card && <CardPrice tcgId={card.id} />}
      </div>

      {/* Status unter der Karte: bereits in Sammlung ODER Hinzufügen-Button */}
      {card && (job.added || isOwned) && (
        <div
          className="w-full h-12 rounded-full text-white font-semibold flex items-center justify-center gap-2"
          style={{ background: 'rgba(34,197,94,0.85)' }}
        >
          <Check size={20} strokeWidth={3} />
          {job.added
            ? 'Hinzugefügt'
            : `Bereits in deiner Sammlung${ownedCount && ownedCount > 1 ? ` (×${ownedCount})` : ''}`}
        </div>
      )}
      {card && !job.added && !isOwned && ownedKnown && (
        <button
          onClick={onAdd}
          className="w-full h-12 rounded-md text-white font-semibold flex items-center justify-center gap-2 shadow-lg"
          style={{ background: 'var(--action-add)' }}
        >
          <Plus size={20} strokeWidth={3} />
          Zur Sammlung hinzufügen
        </button>
      )}
    </div>
  );
}
