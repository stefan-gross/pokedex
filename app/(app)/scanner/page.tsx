'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, Trash2, Loader2, AlertCircle, Check, Plus, ChevronLeft, AlertTriangle, EyeOff, SearchX, LayoutGrid, Square, Flag, Bug } from 'lucide-react';
import { CameraCapture } from '@/components/scanner/CameraCapture';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { AddToCollectionModal } from '@/components/scanner/AddToCollectionModal';
import { DeleteFromCollectionModal } from '@/components/scanner/DeleteFromCollectionModal';
import { getCardBySetCodeAndNumberRest as getCardBySetCodeAndNumber,
         getCardsByDexNumberRest      as getCardsByDexNumber,
         getCardsByNameAndNumberRest  as getCardsByNameAndNumber } from '@/lib/firestore/catalog-rest';
import { addCard, getCardsByTcgId } from '@/lib/firestore/cards';
import { addCardToBinder, ensureDefaultBinder, ensureInboxBinder } from '@/lib/firestore/binders';
import { BulkAddToCollectionModal } from '@/components/scanner/BulkAddToCollectionModal';
import { ValueBadge } from '@/components/card/ValueBadge';
import { CardPrice } from '@/components/card/CardPrice';
import { catalogCardToInfo } from '@/lib/card-info';
import type { CardInfo } from '@/lib/card-info';
import type { CardCondition as PersistedCondition, CardDoc, CardLanguage, CardVariant } from '@/types';
import { CONDITIONS, VARIANT_LABELS, SERIES_NAMES_DE, SYMBOL_ONLY_SERIES } from '@/lib/card-constants';
import { useSetMeta } from '@/lib/hooks/use-set-meta';
import { CardNameLabel } from '@/components/card/CardNameLabel';
import { getSetById } from '@/lib/firestore/sets';

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
  printedTotal?: number | null;          // Gesamtzahl aus derselben "NNN/TTT"-Prägung, unabhängig von number gelesen
  name?: string;                         // gedruckter Karten-Name (Pokémon/Trainer/Energy)
  language?: string;
  confidence?: string;
  nationalDexNumber?: number | null;
  condition?: CardCondition;
  fakeRisk?: 'low' | 'medium' | 'high';
  fakeReasons?: string[];
  error?: string;
  // Direkter Server-seitiger Katalog-Lookup (number+dex, vor Schritt 2) — siehe
  // tryDirectCatalogLookup in app/api/scan/route.ts.
  _preLookup?: {
    attempted: boolean;
    matched: boolean;
    via?: string;
    cardId?: string;
    candidateCount?: number;
  };
  // Kandidaten aus dem Symbolabgleich (Schritt 2), ORDER nach Wahrscheinlichkeit —
  // der Client probiert sie der Reihe nach durch und verifiziert per Dex-Nr./
  // Gesamtzahl-Gegenprobe, statt Gemini's Top-1-Rang blind zu vertrauen.
  candidateSetCodes?: string[];
  // Debug-Info zum Schritt-2-Symbolabgleich — IMMER gesetzt (auch wenn nicht ausgelöst),
  // damit im Debug-Modal sichtbar ist, warum ein Match ggf. nicht versucht wurde.
  _symbolMatch?: {
    triggered: boolean;
    reason?: string;                       // gesetzt wenn triggered=false
    error?: string;                        // gesetzt wenn Schritt 2 fehlgeschlagen ist
    candidateSetCodes?: string[];
    rejectedMatches?: string[];            // Codes, die Gemini lieferte, die aber auf keinem Blatt existieren
    matchConfidence?: string | null;
    matchAmbiguous?: boolean;
    sheetsUsed?: string[];
    sheetBuildMs?: number;                 // Kaltstart-Kosten (Icon-Fetch + Sharp-Komposition)
    model?: string;
    ms?: number;                           // reine Gemini-Zeit für Schritt 2
    attempts?: FallbackAttempt[];          // alle Versuche inkl. fehlgeschlagener 503-Retries
    rawText?: string;
  };
}

interface FallbackAttempt {
  model: string;
  ms: number;
  ok: boolean;
  error?: string;
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
  geminiAttempts?: FallbackAttempt[]; // alle Versuche Schritt 1 inkl. fehlgeschlagener 503-Retries
  uploadMs?: number;             // echte Netzwerk-/Server-Zeit: fetch-Roundtrip minus ALLER
                                  // Gemini-Versuche (Schritt 1 + 2, auch fehlgeschlagene) + Sheets
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
    // Schwellwerte synchron mit classifyPHashDistance() in lib/scan/image-hash.ts
    if (dist >= 28) return 'auto-red';
    if (dist >= 23) return 'auto-yellow';
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

/** Wie cardImgUrlLarge, aber liefert ALLE Bild-Kandidaten in Prioritäts-
 *  reihenfolge statt nur den ersten Treffer — RecognizedCardLarge probiert
 *  bei einem 404/Ladefehler automatisch den nächsten (z.B. TCGdex-DE-Bild
 *  fehlt → pokemontcg.io-Bild als Fallback), bevor sie aufgibt. */
function cardImgUrlsLarge(job: ScanJob): string[] {
  const card = job.result?.card;
  if (!card) return [];
  const lang = job.result?.language ?? 'en';
  const candidates = lang === 'de'
    ? [card.imgLargeDe, card.imgLarge, card.imgSmallDe, card.imgSmall]
    : [card.imgLarge, card.imgSmall, card.imgLargeDe, card.imgSmallDe];
  return candidates.filter((u): u is string => !!u);
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
      cardName: 'Enigmon',
      attackTitle: 'Keine Karte im Bild',
      attackText: 'Halte die Karte deutlicher in den Rahmen.',
    };
  }
  if (!gp?.setCode && !gp?.number && !gp?.nationalDexNumber) {
    return {
      kind: 'gemini-thin',
      Icon: AlertTriangle,
      iconColor: '#fb923c',
      cardName: 'Enigmon',
      attackTitle: 'Karten-Text unlesbar',
      attackText: 'Beleuchte die Karte stärker oder rücke näher heran.',
    };
  }
  if (isNonWestern) {
    return {
      kind: 'non-western',
      Icon: AlertTriangle,
      iconColor: '#fb923c',
      cardName: 'Enigmon',
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
    cardName: 'Enigmon',
    attackTitle: 'Im Katalog nicht gefunden',
    attackText: 'Möglicherweise ein Set, das noch nicht synchronisiert wurde. Versuche es nochmal oder synchronisiere die Daten.',
  };
}

/** Inline-SVG-Artwork der Error-Karte — gezeichnete Landschaft (Busch + Teich
 *  im Vordergrund, Vulkan im Hintergrund, großes Fragezeichen im Vordergrund),
 *  im Stil eines echten Pokémon-Karten-Artworks statt der früheren Glitch-Optik. */
function ErrorLandscapeArtwork({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 140" className={className} preserveAspectRatio="xMidYMid slice" aria-hidden>
      {/* Himmel */}
      <rect x="0" y="0" width="200" height="140" fill="#bcd9e8" />
      {/* Vulkan im Hintergrund */}
      <path d="M 70 90 L 108 24 L 118 24 L 150 90 Z" fill="#8a7a68" stroke="#3a332c" strokeWidth="2" strokeLinejoin="round" />
      <path d="M 96 44 L 113 24 L 118 24 L 130 44 Z" fill="#5c4d40" stroke="#3a332c" strokeWidth="2" strokeLinejoin="round" />
      <path d="M 108 24 Q 112 15 108 8" fill="none" stroke="#9a9a9a" strokeWidth="4" strokeLinecap="round" opacity="0.65" />
      <path d="M 116 24 Q 122 13 117 4" fill="none" stroke="#9a9a9a" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
      {/* Ferner Hügelzug */}
      <path d="M 0 96 Q 30 82 60 94 T 200 90 L 200 140 L 0 140 Z" fill="#a9c98f" opacity="0.8" />
      {/* Wiese im Vordergrund */}
      <path d="M 0 108 Q 50 96 100 108 T 200 106 L 200 140 L 0 140 Z" fill="#8fb86c" />
      {/* Teich */}
      <ellipse cx="48" cy="120" rx="34" ry="12" fill="#6fb7d6" stroke="#3a332c" strokeWidth="2" />
      <path d="M 24 120 Q 48 126 72 120" fill="none" stroke="#e8f4fa" strokeWidth="1.5" opacity="0.7" />
      {/* Busch */}
      <g stroke="#3a332c" strokeWidth="2" strokeLinejoin="round">
        <circle cx="158" cy="112" r="16" fill="#5a9950" />
        <circle cx="174" cy="116" r="12" fill="#5a9950" />
        <circle cx="146" cy="118" r="11" fill="#4d8a44" />
      </g>
      {/* Großes Fragezeichen im Vordergrund */}
      <text
        x="100"
        y="112"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="92"
        fontWeight="700"
        fill="#2b2b2b"
        stroke="#f5f0da"
        strokeWidth="3"
        paintOrder="stroke"
      >
        ?
      </text>
    </svg>
  );
}

export default function ScannerPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  // Symbol-Icons für Set-Badges im Slider/Review-Grid — kein Hook-in-Loop möglich
  // (Tiles werden inline in .map() gerendert, nicht als eigene Komponente), daher
  // ein simpler setId→symbolUrl-Cache statt useSetMeta() pro Tile.
  const [setSymbolMap, setSetSymbolMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const missingSetIds = new Set<string>();
    jobs.forEach(j => {
      const c = j.result?.card;
      if (c?.setId && c.series && SYMBOL_ONLY_SERIES.includes(c.series) && !setSymbolMap.has(c.setId)) {
        missingSetIds.add(c.setId);
      }
    });
    if (missingSetIds.size === 0) return;
    let cancelled = false;
    Promise.all([...missingSetIds].map(async setId => {
      const doc = await getSetById(setId).catch(() => null);
      return [setId, doc?.symbolUrl] as const;
    })).then(results => {
      if (cancelled) return;
      setSetSymbolMap(prev => {
        const next = new Map(prev);
        results.forEach(([setId, symbolUrl]) => { if (symbolUrl) next.set(setId, symbolUrl); });
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [jobs, setSymbolMap]);

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

  // Löschen via -Button: öffnet DeleteFromCollectionModal direkt (kein
  // CardDetailSheet-Zwischenschritt), analog zum Quick-Add-Modal oben.
  const [quickDeleteJobId, setQuickDeleteJobId] = useState<string | null>(null);
  const quickDeleteJob = jobs.find(j => j.id === quickDeleteJobId) ?? null;

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

  // Einzeln-Modus: erkannte Karte, die gerade hinzugefügt werden könnte —
  // steuert den animierten +-Button oberhalb der FAB (BottomNav).
  const recognizedJob = jobs.find(j => j.id === recognizedJobId) ?? null;
  const recognizedCard = recognizedJob?.result?.card;
  const canAddRecognized = !!recognizedCard
    && !recognizedJob.added
    && recognizedJob.result!.ownedCount !== undefined;
  // Löschen-Button neben dem +-Button: erscheint nur, wenn die erkannte Karte
  // bereits im Besitz ist. Tap öffnet DeleteFromCollectionModal (siehe
  // onRemoveRecognized unten) — kompakter Löschen-Drawer mit einer Zeile pro
  // Exemplar (auch bei mehreren Exemplaren).
  const canDeleteRecognized = !!recognizedCard && (recognizedJob?.result?.ownedCount ?? 0) > 0;

  // Events vom BottomNav abonnieren
  useEffect(() => {
    const onTogglePause = () => toggleStreamPaused();
    const onToggleMode  = (e: Event) => {
      const m = (e as CustomEvent<'add' | 'recognize'>).detail;
      if (m) switchScanMode(m);
    };
    const onToggleGrid  = () => toggleGridMode();
    const onAddRecognized = () => {
      if (recognizedJobId) setQuickAddJobId(recognizedJobId);
    };
    const onRemoveRecognized = () => {
      if (recognizedJobId) setQuickDeleteJobId(recognizedJobId);
    };
    window.addEventListener('scanner-toggle-pause', onTogglePause);
    window.addEventListener('scanner-toggle-mode',  onToggleMode as EventListener);
    window.addEventListener('scanner-toggle-grid',  onToggleGrid);
    window.addEventListener('scanner-add-recognized', onAddRecognized);
    window.addEventListener('scanner-remove-recognized', onRemoveRecognized);
    return () => {
      window.removeEventListener('scanner-toggle-pause', onTogglePause);
      window.removeEventListener('scanner-toggle-mode',  onToggleMode as EventListener);
      window.removeEventListener('scanner-toggle-grid',  onToggleGrid);
      window.removeEventListener('scanner-add-recognized', onAddRecognized);
      window.removeEventListener('scanner-remove-recognized', onRemoveRecognized);
    };
  }, [toggleStreamPaused, switchScanMode, toggleGridMode, recognizedJobId]);

  // State an BottomNav schicken — paused/scanMode/jobsCount/gridVisible/reviewMode/canAdd
  const addJobsCount = jobs.filter(j => j.origin === 'add').length;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('scanner-state-changed', {
      detail: {
        paused: streamPaused,
        scanMode,
        jobsCount: addJobsCount,
        gridVisible: scanMode === 'add' && addJobsCount > 0,
        reviewMode: mode === 'review',
        canAdd: canAddRecognized,
        canDelete: canDeleteRecognized,
      },
    }));
  }, [streamPaused, scanMode, addJobsCount, mode, canAddRecognized, canDeleteRecognized]);

  // Beim Unmount: Reset, damit andere Seiten nicht den Scan-Pause-FAB sehen
  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent('scanner-state-changed', {
        detail: { paused: false, scanMode: 'recognize', jobsCount: 0, gridVisible: false, reviewMode: false, canAdd: false, canDelete: false },
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

  // Nach dem Hinzufügen ist die Karte jetzt im Besitz — ownedCount neu laden,
  // damit der Löschen-Button (FAB) sofort erscheint statt erst beim nächsten
  // Scan (ownedCount wurde bisher nur einmal direkt nach dem Erkennen gesetzt).
  const refreshOwnedCount = useCallback((jobId: string, tcgId: string) => {
    getCardsByTcgId(tcgId).then(copies => {
      setJobs(prev => prev.map(j =>
        j.id === jobId && j.result ? { ...j, result: { ...j.result, ownedCount: copies.length } } : j
      ));
    });
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
      const gemini: GeminiResponse & { _debug?: { model: string; ms: number; attempts?: FallbackAttempt[]; rawText: string } }
        = await res.json();
      const fetchMs = Date.now() - tFetch;

      debug.geminiModel    = gemini._debug?.model;
      debug.geminiMs       = gemini._debug?.ms ?? fetchMs;
      debug.geminiAttempts = gemini._debug?.attempts;
      // Reine Netzwerk-/Server-Overhead-Zeit (Upload+Parse+Download) — ALLE
      // Gemini-Versuche müssen rausgerechnet werden, nicht nur der erfolgreiche:
      // schlägt z.B. gemini-2.5-flash-lite mit 503 fehl und Schritt 1 fällt auf
      // gemini-2.5-flash zurück, verschwand die Zeit des fehlgeschlagenen
      // Versuchs bisher unsichtbar in diesem Bucket. Gleiches gilt für Schritt 2
      // (Symbolabgleich) inkl. Referenzblätter-Bau.
      const sumAttempts = (attempts?: FallbackAttempt[]) => (attempts ?? []).reduce((sum, a) => sum + a.ms, 0);
      const step1TotalMs = gemini._debug?.attempts ? sumAttempts(gemini._debug.attempts) : gemini._debug?.ms;
      const step2TotalMs = gemini._symbolMatch?.triggered
        ? (gemini._symbolMatch.attempts ? sumAttempts(gemini._symbolMatch.attempts) : (gemini._symbolMatch.ms ?? 0)) + (gemini._symbolMatch.sheetBuildMs ?? 0)
        : 0;
      debug.uploadMs    = step1TotalMs != null ? fetchMs - step1TotalMs - step2TotalMs : undefined;
      debug.geminiRaw   = gemini._debug?.rawText;
      debug.geminiParsed = { ...gemini, _debug: undefined };
      console.log('[scanner] Gemini response:', { fetchMs, uploadMs: debug.uploadMs, gemini });

      // Gemini-Antwort als Debug-Info aufzeichnen
      const fakeTag = gemini.fakeRisk && gemini.fakeRisk !== 'low' ? ` ⚠️${gemini.fakeRisk}` : '';
      const geminiSummary = gemini.error
        ? `Gemini: ${gemini.error}`
        : `Gemini: ${gemini.setCode ?? (gemini.candidateSetCodes?.length ? `[${gemini.candidateSetCodes.join('/')}]` : '?')}/${gemini.number ?? '?'} ${gemini.language ?? '?'} (${gemini.confidence ?? '?'})${fakeTag}`;

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

      // Set-printedTotal-Cache für diesen Scan — vermeidet doppelte getSetById-Calls,
      // wenn mehrere Kandidaten (Dex-Fallback, Name+Number-Mehrdeutigkeit) geprüft werden.
      const setTotalCache = new Map<string, number | null>();
      const getSetPrintedTotal = async (setId: string): Promise<number | null> => {
        if (!setTotalCache.has(setId)) {
          const doc = await getSetById(setId).catch(() => null);
          setTotalCache.set(setId, doc?.printedTotal ?? null);
        }
        return setTotalCache.get(setId) ?? null;
      };

      // 1) Direkter SetCode+Number-Lookup — probiert entweder Gemini's direkt
      //    gelesenes Klartext-Kürzel (S&V, ein einzelner Wert), oder — wenn das
      //    fehlt — der Reihe nach ALLE Symbolabgleich-Kandidaten (`candidateSetCodes`,
      //    von Schritt 2, nach Wahrscheinlichkeit sortiert), bis einer die Dex-Nr.-/
      //    Gesamtzahl-Gegenprobe besteht. So muss Gemini's Symbol-Ranking nicht auf
      //    Anhieb stimmen — es reicht, wenn der richtige Code IRGENDWO in der Liste
      //    steht, die deterministische Katalog-Gegenprobe entscheidet dann.
      const tryCatalogLookupBySetCode = async (setCode: string) => {
        let result = null as Awaited<ReturnType<typeof getCardBySetCodeAndNumber>>;

        // pokemontcg.io speichert "number" grundsätzlich OHNE führende Nullen
        // (auch wenn die Karte selbst "005" aufgedruckt hat) — unser Katalog
        // übernimmt dieses Feld 1:1 (lib/sync-catalog.ts). Die von Gemini
        // gelesene, gepolsterte Zahl ("062") trifft also so gut wie nie; zuerst
        // die normalisierte (führende Nullen entfernt) probieren spart in der
        // Mehrheit der Fälle einen Firestore-Roundtrip.
        const normalized = /^\d+$/.test(rawNumber) ? String(parseInt(rawNumber, 10)) : rawNumber;
        debug.lookupSteps!.push(`getCardBySetCodeAndNumber("${setCode}", "${normalized}")`);
        result = await getCardBySetCodeAndNumber(setCode, normalized);
        debug.lookupSteps![debug.lookupSteps!.length - 1] += result ? ` → ${result.id}` : ' → null';

        // Fallback: gepolsterte Schreibweise (falls der Katalog für dieses Set
        // doch mit führenden Nullen gespeichert ist).
        if (!result && normalized !== rawNumber) {
          debug.lookupSteps!.push(`getCardBySetCodeAndNumber("${setCode}", "${rawNumber}")`);
          result = await getCardBySetCodeAndNumber(setCode, rawNumber);
          debug.lookupSteps![debug.lookupSteps!.length - 1] += result ? ` → ${result.id}` : ' → null';
        }

        // Dex-Nummer-Gegenprobe: Gemini liest Dex-Nr. unabhängig vom setCode
        // (eigenes Feld im Prompt). Weicht sie von der gefundenen Karte ab, war
        // der setCode falsch (z.B. Symbolabgleich hat ein ähnliches, aber
        // falsches Set getroffen) — verwerfen und nächsten Kandidaten probieren.
        if (result && gemini.nationalDexNumber && result.nationalDexNumber
            && result.nationalDexNumber !== gemini.nationalDexNumber) {
          debug.lookupSteps!.push(
            `verworfen: Dex-Nr. passt nicht (Katalog=${result.nationalDexNumber}, Gemini=${gemini.nationalDexNumber})`,
          );
          result = null;
        }

        // Gesamtzahl-Gegenprobe: dieselbe Idee wie die Dex-Gegenprobe, aber mit der
        // unabhängig gelesenen `printedTotal` ("053/172" → 172). Fängt z.B. den Fall
        // ab, dass ein setCode-Treffer zwar denselben Namen+Nummer hat, aber aus dem
        // falschen Set stammt (unterschiedliche Gesamtzahl verrät das zuverlässig).
        if (result && gemini.printedTotal) {
          const setTotal = await getSetPrintedTotal(result.setId);
          if (setTotal && setTotal !== gemini.printedTotal) {
            debug.lookupSteps!.push(
              `verworfen: Set-Gesamtzahl passt nicht (Katalog=${setTotal}, Gemini=${gemini.printedTotal})`,
            );
            result = null;
          }
        }
        return result;
      };

      if (rawNumber) {
        const codesToTry = gemini.setCode ? [gemini.setCode] : (gemini.candidateSetCodes ?? []);
        for (const code of codesToTry) {
          catalogCard = await tryCatalogLookupBySetCode(code);
          if (catalogCard) break;
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
        } else if (nameCards.length > 1) {
          // Mehrdeutig — z.B. derselbe Name+Nummer existiert zufällig in zwei
          // verschiedenen Sets (Clefairy #53 in EX Unseen Forces UND Brilliant
          // Stars). Gesamtzahl-Gegenprobe entscheidet, wenn Gemini sie gelesen hat.
          let picked: typeof nameCards[number] | null = null;
          if (gemini.printedTotal) {
            for (const c of nameCards) {
              const setTotal = await getSetPrintedTotal(c.setId);
              if (setTotal === gemini.printedTotal) { picked = c; break; }
            }
          }
          if (picked) {
            catalogCard = picked;
            debug.lookupSteps!.push(
              `name+number mehrdeutig: ${nameCards.length} Kandidaten — per Set-Gesamtzahl (${gemini.printedTotal}) auf ${picked.id} aufgelöst`,
            );
          } else {
            catalogCard = nameCards[0];
            debug.lookupSteps!.push(`name+number mehrdeutig: ${nameCards.length} — erster gewählt`);
          }
        } else {
          catalogCard = nameCards[0];
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
                      const miniNormalDark = '#6f6d4e';
                      return (
                        <div
                          className="w-full h-full flex flex-col"
                          style={{
                            background: 'linear-gradient(180deg, #d9d4b0 0%, #b8b287 100%)',
                            padding: 4,
                          }}
                        >
                          <div
                            className="flex-1 flex flex-col"
                            style={{
                              background: 'linear-gradient(180deg, #f7f4e4 0%, #ece5c4 100%)',
                              borderRadius: 4,
                              overflow: 'hidden',
                            }}
                          >
                            {/* Mini-Header */}
                            <div
                              className="flex items-center justify-between px-1.5 py-1 gap-1"
                              style={{ background: 'rgba(111,109,78,0.16)' }}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                <span
                                  className="text-[7px] font-bold px-1 rounded text-white shrink-0"
                                  style={{ background: miniNormalDark }}
                                >
                                  NORMAL
                                </span>
                                <span className="text-[10px] font-extrabold leading-none truncate" style={{ color: '#1a1a1a' }}>
                                  {ec.cardName}
                                </span>
                              </div>
                              <span className="text-[9px] font-extrabold shrink-0" style={{ color: miniNormalDark }}>
                                ???
                              </span>
                            </div>
                            {/* Mini-Artwork: Snap-Foto wenn da, sonst gezeichnete Landschaft */}
                            <div
                              className="flex-1 mx-1 my-1 relative overflow-hidden"
                              style={{
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
                                <ErrorLandscapeArtwork className="w-full h-full" />
                              )}
                              {/* Klein-Icon oben rechts als sekundärer Hint zum Fehler-Typ */}
                              <div
                                className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full flex items-center justify-center"
                                style={{ background: 'rgba(255,255,255,0.65)' }}
                              >
                                <ErrIcon size={14} color={ec.iconColor} strokeWidth={2} />
                              </div>
                            </div>
                            {/* Mini-Footer */}
                            <div
                              className="px-1.5 py-0.5 text-[8px] font-mono flex items-center justify-between"
                              style={{ background: 'rgba(0,0,0,0.06)', color: '#1a1a1a' }}
                            >
                              <span className="font-bold" style={{ color: miniNormalDark }}>???</span>
                              <span>0/0</span>
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
                    {card?.setCode && (() => {
                      const symbolOnly = !!card.series && SYMBOL_ONLY_SERIES.includes(card.series);
                      const symbolUrl = card.setId ? setSymbolMap.get(card.setId) : undefined;
                      return (
                        <div
                          className="shrink-0 flex flex-col items-center leading-tight rounded-md border px-1.5 py-0.5 font-mono"
                          style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}
                        >
                          {symbolOnly && symbolUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={symbolUrl} alt="" className="w-3.5 h-3.5 object-contain" />
                          ) : (
                            <span className="text-[10px] font-bold">{card.setCode}</span>
                          )}
                          {card.number && (
                            <span className="text-[9px] text-white/75">{card.number}</span>
                          )}
                        </div>
                      );
                    })()}
                    <p className="text-xs text-white/90 truncate">
                      {card ? <CardNameLabel card={card} secondaryClassName="opacity-70" /> : (job.status === 'processing' ? '…' : 'Fehler')}
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
                    <div className="absolute top-2 left-2 px-2 py-1 rounded text-xs font-extrabold text-white" style={{ background: '#6f6d4e' }}>
                      {ec.cardName}
                    </div>
                  </>
                ) : (
                  <ErrorLandscapeArtwork className="w-full h-full" />
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
                    {jCard?.setCode ? (() => {
                      const symbolOnly = !!jCard.series && SYMBOL_ONLY_SERIES.includes(jCard.series);
                      const symbolUrl = jCard.setId ? setSymbolMap.get(jCard.setId) : undefined;
                      return (
                        <div
                          className="flex flex-col items-center leading-tight rounded-md border px-2 py-1 font-mono"
                          style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}
                        >
                          {symbolOnly && symbolUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={symbolUrl} alt="" className="w-4 h-4 object-contain" />
                          ) : (
                            <span className="text-[11px] font-bold">{jCard.setCode}</span>
                          )}
                          {jCard.number && (
                            <span className="text-[10px] text-white/75">{jCard.number}</span>
                          )}
                        </div>
                      );
                    })() : <div />}

                    <p className="text-sm font-semibold text-white text-center truncate">
                      {jCard ? <CardNameLabel card={jCard} secondaryClassName="opacity-70" /> : (jIsError ? classifyJobError(j).cardName : '…')}
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
                            {CONDITIONS.find(c => c.value === jCurCondition)?.label ?? jCurCondition}
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
                              <option key={c.value} value={c.value}>{c.label}</option>
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
          Im Review-Modus links Back-Arrow zurück zum Scan, rechts X-Close
          zum vollständigen Schließen. Im Scanning-Modus zusätzlich mittig
          (zwischen Blitz-Button links und Schließen rechts) der Einzeln/
          Mehrere-Umschalter — drei flex-1-Zonen garantieren echte
          Zentrierung unabhängig von der Breite der Rand-Elemente. */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center px-4 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        <div className="flex-1 flex justify-start">
          {mode === 'review' && (
            <button
              onClick={() => setMode('scanning')}
              className="flex items-center gap-1 h-9 px-3 rounded-full bg-white/10 backdrop-blur-sm text-white text-sm font-medium"
              aria-label="Zurück zum Scannen"
            >
              <ChevronLeft size={18} color="#fff" />
              Scannen
            </button>
          )}
        </div>
        <div className="flex-1 flex justify-center">
          {mode === 'scanning' && (
            <div
              className="flex p-1 rounded-full"
              style={{
                background: 'rgba(255,255,255,0.13)',
                backdropFilter: 'blur(22px) saturate(1.4)',
                WebkitBackdropFilter: 'blur(22px) saturate(1.4)',
                border: '1px solid rgba(255,255,255,0.22)',
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.28), 0 8px 26px rgba(0,0,0,0.32)',
              }}
            >
              {(['recognize', 'add'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { if (m !== scanMode) switchScanMode(m); }}
                  className="px-[18px] py-2 rounded-full text-sm font-semibold transition-colors"
                  style={{
                    background: scanMode === m ? 'rgba(229,62,62,0.85)' : 'transparent',
                    color:      scanMode === m ? '#fff' : 'rgba(255,255,255,0.75)',
                    boxShadow:  scanMode === m ? 'inset 0 1px 1px rgba(255,255,255,0.5), 0 2px 8px rgba(220,38,38,0.4)' : undefined,
                  }}
                >
                  {m === 'add' ? 'Mehrere' : 'Einzeln'}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 flex justify-end">
          {mode === 'scanning' && (
            <button
              onClick={handleClose}
              className="w-[46px] h-[46px] flex items-center justify-center rounded-full"
              aria-label="Scanner schließen"
              style={{
                background: 'rgba(255,255,255,0.13)',
                backdropFilter: 'blur(22px) saturate(1.4)',
                WebkitBackdropFilter: 'blur(22px) saturate(1.4)',
                border: '1px solid rgba(255,255,255,0.22)',
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.28), 0 8px 26px rgba(0,0,0,0.32)',
              }}
            >
              <X size={20} color="#fff" />
            </button>
          )}
        </div>
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
        // Normal-Typ-Farbe (Hauptspiel-Normal-Typ-Ton), für eine authentisch
        // wirkende Karte statt der früheren rot eingefärbten Glitch-Optik.
        const normalDark = '#6f6d4e';

        return (
          <div
            className="absolute inset-x-0 z-10 flex flex-col items-center px-6 gap-3 pointer-events-none"
            style={{
              top: 'calc(env(safe-area-inset-top, 0px) + 56px)',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
            }}
          >
            {/* Pokémon-Karten-Look: unbekannte Karte (Typ Normal) */}
            <div
              className="relative pointer-events-auto"
              style={{
                aspectRatio: '63 / 88',
                height: 'min(70vh, 100%)',
                maxWidth: '100%',
                borderRadius: 14,
                background: 'linear-gradient(180deg, #d9d4b0 0%, #b8b287 100%)',
                padding: 8,
                boxShadow: '0 10px 40px rgba(0,0,0,0.55)',
              }}
            >
              {/* Innerer Kartenrahmen */}
              <div
                className="w-full h-full flex flex-col"
                style={{
                  borderRadius: 8,
                  background: 'linear-gradient(180deg, #f7f4e4 0%, #ece5c4 100%)',
                  overflow: 'hidden',
                }}
              >
                {/* Header: Name + Typ + KP */}
                <div
                  className="flex items-center justify-between px-3 py-2 gap-2"
                  style={{ background: 'rgba(111,109,78,0.16)' }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white shrink-0"
                      style={{ background: normalDark }}
                    >
                      NORMAL
                    </span>
                    <span className="text-base font-extrabold leading-none truncate" style={{ color: '#1a1a1a' }}>
                      {cardName}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-0.5 shrink-0">
                    <span className="text-[10px] font-bold" style={{ color: '#1a1a1a' }}>KP</span>
                    <span className="text-base font-extrabold" style={{ color: normalDark }}>???</span>
                  </div>
                </div>

                {/* Artwork-Bereich: gezeichnete Landschaft mit Fragezeichen */}
                <div
                  className="flex-1 mx-3 my-2 relative overflow-hidden"
                  style={{
                    border: '3px solid rgba(0,0,0,0.55)',
                    borderRadius: 4,
                    minHeight: 100,
                  }}
                >
                  <ErrorLandscapeArtwork className="w-full h-full" />
                  {/* Sekundäres Fehlertyp-Icon oben rechts (klein, zur Diagnose) */}
                  <div className="absolute top-2 right-2 p-1 rounded-full" style={{ background: 'rgba(255,255,255,0.65)' }}>
                    <HeaderIcon size={18} color={iconColor} strokeWidth={2.5} />
                  </div>
                </div>

                {/* Beschreibungs-Banner — Stufe + Pokédex-Nr.-Stil */}
                <div className="px-3 py-1 text-[10px] italic flex items-center gap-1.5" style={{ color: '#1a1a1a' }}>
                  <span className="font-mono">Nr. 0404</span>
                  <span>·</span>
                  <span>Unbekannt-Pokémon</span>
                  <span>·</span>
                  <span>Größe ?,? m</span>
                </div>

                {/* Attacken-Box */}
                <div className="px-3 py-2 flex-grow-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{attackTitle}</span>
                    <span className="text-xs font-extrabold" style={{ color: normalDark }}>●</span>
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
                    <span className="font-bold" style={{ color: normalDark }}>???</span>
                    <span>0/0</span>
                  </span>
                  <span className="text-[9px]">©Pokédex Error-Edition</span>
                </div>
              </div>
            </div>
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
            key={recognized.id}
            job={recognized}
            onCardTap={() => setActiveJobId(recognized.id)}
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
            onJobSaved={(id) => {
              markAdded(id);
              const tcgId = jobs.find(j => j.id === id)?.result?.card?.id;
              if (tcgId) refreshOwnedCount(id, tcgId);
            }}
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
                      {!gp.setCode && gp._symbolMatch?.triggered && (gp._symbolMatch.candidateSetCodes?.length ?? 0) > 0 && (
                        <span className="text-muted-foreground text-[10px]"> (Symbol-Abgleich: {gp._symbolMatch.candidateSetCodes!.join(', ')}, {gp._symbolMatch.matchConfidence ?? '?'}{gp._symbolMatch.matchAmbiguous ? ', mehrdeutig' : ''})</span>
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
              <div>Netzwerk/Server-Overhead: <span className="text-blue-300">{debugJob.debug.uploadMs ?? '—'} ms</span></div>
              <div>Gemini (Schritt 1): <span className="text-blue-300">{debugJob.debug.geminiMs ?? '—'} ms</span></div>
              {debugJob.debug.geminiAttempts && debugJob.debug.geminiAttempts.length > 1 && (
                <div className="pl-3 text-white/50">
                  {debugJob.debug.geminiAttempts.map((a, i) => (
                    <div key={i}>
                      {a.ok ? '✓' : '✗'} {a.model}: {a.ms} ms{!a.ok && a.error ? ` (${a.error.slice(0, 60)})` : ''}
                    </div>
                  ))}
                </div>
              )}
              <div>Lookup: <span className="text-blue-300">{debugJob.debug.lookupMs ?? '—'} ms</span></div>
              <div>Owned: <span className="text-blue-300">{debugJob.debug.ownedMs ?? '—'} ms</span> <span className="text-white/40">(async)</span></div>
              <div className="pt-1 border-t border-white/10 mt-1">
                Gesamt (Render): <span className="text-blue-300">{debugJob.debug.totalMs ?? '—'} ms</span>
              </div>
              {debugJob.debug.error && (
                <div className="text-red-300 mt-1">Fehler: {debugJob.debug.error}</div>
              )}
            </div>

            {/* Direkter Katalog-Lookup (number+dex) — vor Schritt 2, spart ggf. den
                kompletten Symbolabgleich */}
            {(() => {
              const pl = (debugJob.debug.geminiParsed as { _preLookup?: GeminiResponse['_preLookup'] } | undefined)?._preLookup;
              if (!pl?.attempted) return null;
              return (
                <div className="mb-4">
                  <p className="text-white/60 text-xs mb-2 font-mono">Direkter Katalog-Lookup (vor Schritt 2)</p>
                  <div className="p-3 rounded-lg bg-white/5 text-xs font-mono text-white/80 space-y-0.5">
                    <div>Treffer: <span className={pl.matched ? 'text-green-300' : 'text-white/40'}>{pl.matched ? 'ja' : 'nein'}</span></div>
                    {pl.via && <div>Methode: <span className="text-blue-300">{pl.via}</span></div>}
                    {pl.candidateCount != null && <div>Kandidaten: <span className="text-blue-300">{pl.candidateCount}</span></div>}
                    {pl.cardId && <div>Karte: <span className="text-blue-300">{pl.cardId}</span></div>}
                  </div>
                </div>
              );
            })()}

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
                        {sm.attempts && sm.attempts.length > 1 && (
                          <div className="pl-3 text-white/50">
                            {sm.attempts.map((a, i) => (
                              <div key={i}>
                                {a.ok ? '✓' : '✗'} {a.model}: {a.ms} ms{!a.ok && a.error ? ` (${a.error.slice(0, 60)})` : ''}
                              </div>
                            ))}
                          </div>
                        )}
                        <div>Referenzblätter bauen: <span className="text-blue-300">{sm.sheetBuildMs ?? '—'} ms</span> <span className="text-white/40">(0 ms = bereits gecacht)</span></div>
                        <div>Blätter geprüft: <span className="text-blue-300">{sm.sheetsUsed?.length ?? 0}</span></div>
                        <div>Kandidaten: <span className="text-blue-300">{sm.candidateSetCodes && sm.candidateSetCodes.length > 0 ? sm.candidateSetCodes.join(', ') : '— (kein Match)'}</span></div>
                        {sm.rejectedMatches && sm.rejectedMatches.length > 0 && (
                          <div className="text-orange-300">Verworfen: {sm.rejectedMatches.map(c => `"${c}"`).join(', ')} — auf keinem Blatt ein echter Set-Code (vermutlich Typ-Icon verwechselt)</div>
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
              // Schwellwerte synchron mit classifyPHashDistance() in lib/scan/image-hash.ts
              const cls = dist == null ? null : dist <= 22 ? 'match' : dist <= 27 ? 'unsure' : 'mismatch';
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
          if (activeJob) {
            markAdded(activeJob.id);
            if (activeJob.result?.card) refreshOwnedCount(activeJob.id, activeJob.result.card.id);
          }
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
          fromScanner
          onClose={() => setQuickAddJobId(null)}
          onSaved={() => {
            markAdded(quickAddJob.id);
            refreshOwnedCount(quickAddJob.id, quickAddJob.result!.card!.id);
            setQuickAddJobId(null);
          }}
        />
      )}

      {/* ── Löschen-Drawer (via - Button auf der Tile) ─────────────────
          Zeigt alle Sammlungen, in denen die Karte steckt, mit Löschen pro
          Zeile + „Überall löschen" — kein CardDetailSheet-Zwischenschritt. */}
      {quickDeleteJob?.result?.card && (
        <DeleteFromCollectionModal
          card={quickDeleteJob.result.card}
          fromScanner
          onClose={() => setQuickDeleteJobId(null)}
          onDeleted={() => {
            const tcgId = quickDeleteJob.result!.card!.id;
            getCardsByTcgId(tcgId).then(copies => {
              setJobs(prev => prev.map(j =>
                j.id === quickDeleteJob.id && j.result
                  ? { ...j, result: { ...j.result, ownedCount: copies.length } }
                  : j
              ));
            });
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
                background: 'linear-gradient(180deg, #d9d4b0 0%, #b8b287 100%)',
                padding: 3,
              }}
            >
              <div
                className="flex-1 flex flex-col"
                style={{
                  background: 'linear-gradient(180deg, #f7f4e4 0%, #ece5c4 100%)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  className="flex items-center justify-between px-1 py-0.5 gap-0.5"
                  style={{ background: 'rgba(111,109,78,0.16)' }}
                >
                  <span className="text-[8px] font-extrabold truncate" style={{ color: '#1a1a1a' }}>
                    {ec.cardName}
                  </span>
                  <span className="text-[8px] font-extrabold shrink-0" style={{ color: '#6f6d4e' }}>
                    ???
                  </span>
                </div>
                <div
                  className="flex-1 mx-0.5 my-0.5 relative overflow-hidden"
                  style={{
                    border: '1.5px solid rgba(0,0,0,0.55)',
                    borderRadius: 2,
                  }}
                >
                  {snapSrc ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={snapSrc} alt="Scan" className="w-full h-full object-cover" />
                  ) : (
                    <ErrorLandscapeArtwork className="w-full h-full" />
                  )}
                </div>
                <div
                  className="px-1 py-0.5 text-[7px] font-mono flex items-center justify-between"
                  style={{ background: 'rgba(0,0,0,0.06)', color: '#1a1a1a' }}
                >
                  <span className="font-bold" style={{ color: '#6f6d4e' }}>???</span>
                  <span>0/0</span>
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

        {/* Condition-Pill (top-right) — Kurzcode statt Vollname: die Pille sitzt
            frei schwebend in der linken oberen bzw. hier rechten oberen Ecke
            einer sehr schmalen Slider-Kachel (~80-170px) neben der ebenfalls
            frei schwebenden Varianten-Pille; "Near Mint" würde mit "Standard"
            kollidieren. Das ausgeschriebene Label steht trotzdem im nativen
            Auswahl-Menü (Vollbild-Picker, kein Platzproblem). */}
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
                <option key={c.value} value={c.value}>{c.label}</option>
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
  onCardTap: () => void;
  onDebugTap: () => void;
}

function RecognizedCardLarge({
  job, onCardTap, onDebugTap,
}: RecognizedCardLargeProps) {
  const card      = job.result?.card;
  // Bild-Kandidaten in Prioritätsreihenfolge — bei 404/Ladefehler eines
  // Kandidaten (z.B. fehlendes TCGdex-DE-Bild) probiert onError automatisch
  // den nächsten, bevor der Platzhalter gezeigt wird (siehe img-Rendering
  // unten). Während des Scans (processing) gibt's nur das lokale Foto.
  const imgCandidates = job.status === 'processing' && job.debug?.imageBase64
    ? [`data:${job.debug.mimeType ?? 'image/jpeg'};base64,${job.debug.imageBase64}`]
    : cardImgUrlsLarge(job);
  const [imgIdx, setImgIdx] = useState(0);
  useEffect(() => { setImgIdx(0); }, [job.id]);
  const img = imgCandidates[imgIdx];
  const setMeta   = useSetMeta(card?.setId, undefined, card?.setName);
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => { setLogoFailed(false); }, [setMeta?.logoUrl]);
  // Echtes Seitenverhältnis des geladenen Kartenfotos — sobald bekannt (onLoad),
  // wird die Box exakt danach dimensioniert statt einer 63:88-Annahme zu folgen.
  // Fotos/Scans weichen leicht vom exakten Kartenformat ab (Zuschnitt-Ränder),
  // die Annahme führte sonst zu Zuschneiden (object-cover) oder Rand (object-contain).
  const [imgAspect, setImgAspect] = useState<number | null>(null);
  // Bis das Foto geladen ist, mit dem Standard-Kartenformat rechnen (verhindert
  // Layout-Sprung) — danach exakt mit dem echten Verhältnis des Fotos.
  const cardRatio = imgAspect ?? 63 / 88;

  // Verfügbarer Platz für die Karte (der Slot, NICHT die Karte selbst) —
  // gemessen per ResizeObserver auf dem umgebenden flex-1-Slot. Vorher wurde
  // die Kartengröße rein per CSS (aspect-ratio + max-width/max-height, ohne
  // explizite width/height) aus dem *Bildinhalt* abgeleitet — das brach
  // zusammen, sobald das Bild nicht lud (404/Netzwerkfehler): ohne Bild-
  // Eigengröße schrumpfte die Box auf die winzige "kaputtes Bild"-Anzeige,
  // wodurch auch Logo/Setname (die proportional zu sizeBasePx skalieren)
  // viel zu klein wurden. Jetzt wird die Kartengröße unabhängig vom Bild aus
  // dem verfügbaren Slot berechnet (klassische object-fit:contain-Mathematik)
  // und als expliziter px-Wert gesetzt — stabil, egal ob das Bild lädt.
  const slotRef = useRef<HTMLDivElement>(null);
  const [slotSize, setSlotSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const target = slotRef.current;
    if (!target) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSlotSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(target);
    return () => ro.disconnect();
  }, []);
  const fittedSize = (() => {
    if (!slotSize || slotSize.w <= 0 || slotSize.h <= 0) return null;
    const slotRatio = slotSize.w / slotSize.h;
    return slotRatio > cardRatio
      ? { w: Math.round(slotSize.h * cardRatio), h: slotSize.h }
      : { w: slotSize.w, h: Math.round(slotSize.w / cardRatio) };
  })();

  // Gerenderte Kartenbreite — Basis für Logo-/Text-Größen und Ecken-Radius,
  // die proportional zur tatsächlichen Kartenbreite skalieren sollen (siehe
  // sizeBasePx unten). Kommt jetzt direkt aus fittedSize (kein separater
  // ResizeObserver auf dem Container mehr nötig).
  const containerRef = useRef<HTMLDivElement>(null);

  const ownedCount = job.result?.ownedCount;
  const isOwned    = (ownedCount ?? 0) > 0;

  // Rahmenfarbe: nur Fake-Risk hat Vorrang (wie Slider/Review-Grid). Der
  // pHash-Mismatch-Rahmen (auto-yellow/auto-red) wird HIER bewusst NICHT
  // angezeigt — im Einzeln-Modus sieht der Nutzer Foto, Name und Nummer
  // direkt nebeneinander und beurteilt selbst, ob die Karte stimmt; anders
  // als im Slider (Mehrere-Modus), wo der Warnrahmen als Hinweis beim
  // schnellen Durchscannen ohne Einzelprüfung dient (siehe ScannedCardTile).
  // Erst wenn nichts davon greift, zeigt der Rahmen stattdessen den
  // Besitz-Status an (grün = schon in der Sammlung, sonst keiner).
  const statusFlagged = !!job.result?.fakeRisk;
  const cardBorder = statusFlagged
    ? borderStyleFor('none', job.result?.fakeRisk).border
    : isOwned ? '1.5px solid #35d15a' : '2.5px solid transparent';
  // Zusätzlicher Glow beim grünen Besitz-Rahmen — reiner Farbrand geht auf bunten
  // Kartenmotiven schnell unter, der Schein macht "schon vorhanden" unmissverständlich.
  // Farbe/Glow-Werte aus dem Glas-Handoff (design_handoff_scanner_glass, Match-Rahmen).
  const cardGlow = !statusFlagged && isOwned
    ? '0 0 0 1.5px rgba(255,255,255,0.2), 0 8px 24px rgba(53,209,90,0.35)'
    : undefined;

  const setCode  = card?.setCode ?? card?.setId?.toUpperCase();
  const seriesDe = card?.series ? (SERIES_NAMES_DE[card.series] ?? card.series) : null;
  // Setnummer ("111/159") — direkt unter dem Namen, printedTotal aus tcg_sets
  // (nicht aus dem Scan-Ergebnis, siehe useSetMeta).
  const cardNumBase  = card ? card.number.split('/')[0].padStart(3, '0') : null;
  const cardNumTotal = setMeta?.printedTotal ? String(setMeta.printedTotal).padStart(3, '0') : null;
  const cardDex = card?.nationalDexNumber != null ? `#${String(card.nationalDexNumber).padStart(3, '0')}` : null;
  const showLogo = !!setMeta?.logoUrl && !logoFailed;
  // Sets vor Scarlet & Violet tragen KEINEN echten Kürzel-Aufdruck auf der Karte —
  // nur ein grafisches Symbol. `setCode` ist dort nur ein internes pokemontcg.io-
  // Kürzel (z.B. "BS", "JU"), niemals als vermeintlicher Kartendruck anzeigen.
  const isSymbolOnlySet = !!card?.series && SYMBOL_ONLY_SERIES.includes(card.series);
  // sizeBasePx: die berechnete Kartenbreite (fittedSize, s.o.) — Basis für
  // Logo/Text-Größen darunter, damit die proportional mitskalieren.
  const sizeBasePx = fittedSize?.w ?? null;
  const logoHeight = sizeBasePx != null ? `${sizeBasePx * 0.15}px` : '40px';

  return (
    <div
      className="absolute inset-x-0 z-10 flex flex-col items-center px-4 gap-3"
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + 64px)',
        // Löschen/Hinzufügen erscheinen inzwischen LINKS/RECHTS neben der
        // Kamera (nicht mehr darüber gestapelt) — der große Abstand von
        // früher wird nicht mehr gebraucht, nur noch Platz für die FAB-
        // Kapsel selbst (ragt per marginTop:-20 über die Toolbar hinaus).
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)',
      }}
    >
      {/* Debug-Zugang — oben rechts über allem, unabhängig vom Namen (der jetzt
          unterhalb der Karte steht statt darüber). Glas-Chip (Handoff
          design_handoff_scanner_glass, "Bug"-Chip 38px). */}
      <button
        onClick={onDebugTap}
        className="absolute top-0 right-0 w-[38px] h-[38px] flex items-center justify-center rounded-full"
        aria-label="Debug-Infos anzeigen"
        style={{
          background: 'rgba(255,255,255,0.13)',
          backdropFilter: 'blur(22px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(22px) saturate(1.4)',
          border: '1px solid rgba(255,255,255,0.22)',
          boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.28), 0 8px 26px rgba(0,0,0,0.32)',
        }}
      >
        <Bug size={17} color="#fff" />
      </button>

      {/* Karten-Body — die Slot-Zelle (flex-1/min-h-0) füllt per nativer
          Flexbox-Berechnung exakt den verbleibenden Platz in der Spalte (statt
          eine Höhe per vh/dvh zu schätzen). fittedSize berechnet daraus per
          object-fit:contain-Mathematik eine explizite Breite/Höhe für die
          Karten-Box — UNABHÄNGIG vom Bildinhalt (vorher: aspect-ratio +
          max-width/max-height ohne explizite Größe, das die Box anhand des
          *Bildes* auf Inhaltsgröße schrumpfen ließ — brach zusammen, wenn das
          Bild nicht lud). Varianten-/Zustand-Auswahl passiert nicht mehr hier,
          sondern beim Hinzufügen im AddToCollectionModal. */}
      <div ref={slotRef} className="w-full flex-1 min-h-0 flex items-center justify-center">
      <div
        ref={containerRef}
        className="relative overflow-hidden"
        style={{
          width: fittedSize?.w,
          height: fittedSize?.h,
          // Fester px-Wert statt % — bei % skaliert die Ecke elliptisch (Breite
          // und Höhe getrennt), auf einer Hochformat-Karte sieht die Rundung
          // dadurch oben/unten anders aus als links/rechts. Ein px-Wert relativ
          // zur Breite ergibt eine gleichmäßige, kreisrunde Ecke wie im Original.
          borderRadius: sizeBasePx != null ? `${sizeBasePx * 0.07}px` : '7%',
          border: cardBorder,
          boxShadow: cardGlow,
          background: '#1a1a1a',
          cursor: card ? 'pointer' : 'default',
        }}
        onClick={card ? onCardTap : undefined}
      >
        {img ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={img}
            src={img}
            alt={card?.name ?? ''}
            className="w-full h-full object-fill"
            onLoad={e => {
              const el = e.currentTarget;
              if (el.naturalWidth && el.naturalHeight) setImgAspect(el.naturalWidth / el.naturalHeight);
            }}
            // Kandidat 404/Ladefehler → nächsten Kandidaten aus imgCandidates
            // probieren (siehe cardImgUrlsLarge oben), statt das native
            // "kaputtes Bild"-Icon zu zeigen.
            onError={() => setImgIdx(i => i + 1)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-red-500/10">
            <AlertCircle size={28} color="#f87171" />
          </div>
        )}

        {/* ×N-Hinweis, sobald die Karte schon vorhanden ist — auch bei genau
            einem Exemplar, da der grüne Rahmen allein auf bunten Kartenmotiven
            nicht immer auffällt. */}
        {isOwned && ownedCount && (
          <div
            className="absolute -top-2 -right-2 flex items-center justify-center min-w-[64px] h-[64px] px-2.5 rounded-full text-[22px] font-bold"
            style={{
              background: '#22c55e', color: '#fff',
              boxShadow: '0 4px 14px rgba(34,197,94,0.5), 0 0 0 4px rgba(0,0,0,0.12)',
            }}
          >
            ×{ownedCount}
          </div>
        )}
      </div>
      </div>

      {/* Unterhalb der Karte: Glas-Info-Sheet mit Set-Zeile, Pokémon-Name,
          Nummer/Dex und Preis — Aufbau unverändert, nur die Chrome wird zu
          getöntem Glas (Handoff design_handoff_scanner_glass, "Info-Sheet").
          Feste rgba()-Werte identisch zur Dark-Variante der globalen .glass-
          Klasse (app/globals.css) — der Scanner liegt immer über dem
          (dunklen) Kamerabild, unabhängig vom Light/Dark-Theme der
          restlichen App, daher immer die Dark-Werte statt der Theme-
          abhängigen .glass-Klasse. */}
      {card && (
        <div
          className="w-full flex flex-col items-start gap-2 px-4 py-4"
          style={{
            borderRadius: 24,
            background: 'rgba(255,255,255,0.13)',
            backdropFilter: 'blur(22px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(22px) saturate(1.4)',
            border: '1px solid rgba(255,255,255,0.22)',
            boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.28), 0 8px 26px rgba(0,0,0,0.32)',
          }}
        >
          {/* Logo + Zyklus/Setname als ein Block — Logo links, rechts daneben
              Zyklus- und Setname linksbündig in zwei Zeilen übereinander,
              beide zusammen so hoch wie das Logo. */}
          <div className="flex items-center justify-start gap-2.5 max-w-full">
            {showLogo ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={setMeta!.logoUrl}
                alt={setCode ?? ''}
                className="object-contain shrink-0"
                style={{ height: logoHeight, maxWidth: '40%' }}
                onError={() => setLogoFailed(true)}
              />
            ) : setMeta?.symbolUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={setMeta.symbolUrl}
                alt={setCode ?? ''}
                className="object-contain shrink-0"
                style={{ height: logoHeight, width: logoHeight }}
              />
            ) : (
              // Kürzel-Text nur als allerletzter Fallback, und nur wenn er echt
              // aufgedruckt sein könnte (S&V-Ära) — alte Sets zeigen sonst nichts,
              // statt ein erfundenes Kürzel wie ein Kartendruck aussehen zu lassen.
              !isSymbolOnlySet && setCode && (
                <span className="font-mono font-bold text-white/90" style={{ fontSize: `calc(${logoHeight} * 0.5)` }}>
                  {setCode}
                </span>
              )
            )}
            <div
              className="flex flex-col justify-center items-start min-w-0 text-white/90"
              style={{
                height: logoHeight,
                fontSize: `calc(${logoHeight} * 0.3 - 1px)`,
                lineHeight: 1.25,
                gap: 'calc(0.15em - 1px)',
                transform: 'translateY(-2px)',
              }}
            >
              {seriesDe && <span className="truncate max-w-full text-left font-bold">{seriesDe}</span>}
              <span className="truncate max-w-full text-left" style={{ fontSize: 'calc(1em - 1px)' }}>
                {setMeta?.nameDe ?? card.setName}
              </span>
            </div>
          </div>

          <h2
            className="text-white font-bold text-3xl truncate text-left max-w-full"
            style={{ textShadow: '0 2px 12px rgba(0,0,0,0.3)' }}
          >
            <CardNameLabel card={card} secondaryClassName="text-[0.6em] font-semibold text-white/70" />
          </h2>
          {/* Nummer/Dex links, Preis rechts — eine Zeile, wie im Handoff-
              Referenzbild (design_handoff_scanner_glass, Info-Sheet). */}
          <div className="w-full flex items-baseline justify-between gap-2 -mt-1.5">
            {(cardNumBase || cardDex) && (
              <div className="flex items-baseline gap-2 font-mono tabular-nums">
                {cardNumBase && (
                  <span className="text-white text-sm font-bold">
                    {cardNumBase}{cardNumTotal && <span className="text-white/60 font-normal">/{cardNumTotal}</span>}
                  </span>
                )}
                {cardDex && (
                  <span className="text-white/60 text-sm">{cardDex}</span>
                )}
              </div>
            )}
            <CardPrice
              tcgId={card.id}
              plain
              fontSize={44}
              className="[text-shadow:0_2px_12px_rgba(0,0,0,.25)] ml-auto"
            />
          </div>
        </div>
      )}

      {/* Hinzufügen passiert jetzt über den grünen +-Button, der animiert über
          der Scanner-FAB erscheint (BottomNav, gesteuert über canAddRecognized/
          scanner-add-recognized-Event) — kein Button mehr direkt auf dieser
          Ansicht nötig. Besitz-Status zeigt weiterhin der grüne Kartenrahmen an. */}
      {card && job.added && (
        <div
          className="rounded-full text-white font-semibold flex items-center justify-center gap-2 mt-auto h-12 px-8"
          style={{ background: 'rgba(34,197,94,0.85)' }}
        >
          <Check size={20} strokeWidth={3} />
          Hinzugefügt
        </div>
      )}
    </div>
  );
}
