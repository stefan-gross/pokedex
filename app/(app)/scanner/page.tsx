'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, Trash2, Loader2, AlertCircle, Check, Plus, ChevronLeft, AlertTriangle } from 'lucide-react';
import { CameraCapture } from '@/components/scanner/CameraCapture';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { AddToCollectionModal } from '@/components/scanner/AddToCollectionModal';
import { getCardBySetCodeAndNumberRest as getCardBySetCodeAndNumber,
         getCardsByDexNumberRest      as getCardsByDexNumber } from '@/lib/firestore/catalog-rest';
import { addCard, getCardsByTcgId } from '@/lib/firestore/cards';
import { addCardToBinder, ensureDefaultBinder, ensureInboxBinder } from '@/lib/firestore/binders';
import { BulkAddToCollectionModal } from '@/components/scanner/BulkAddToCollectionModal';
import { CardPrice } from '@/components/card/CardPrice';
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
  language?: string;
  confidence?: string;
  nationalDexNumber?: number | null;
  condition?: CardCondition;
  fakeRisk?: 'low' | 'medium' | 'high';
  fakeReasons?: string[];
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

export default function ScannerPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeOwnedCopies, setActiveOwnedCopies] = useState<CardDoc[]>([]);
  const [debugJobId, setDebugJobId] = useState<string | null>(null);
  const [mode, setMode] = useState<'scanning' | 'review'>('scanning');
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

  // State an BottomNav schicken — sie braucht paused/scanMode/jobsCount/gridVisible
  const addJobsCount = jobs.filter(j => j.origin === 'add').length;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('scanner-state-changed', {
      detail: {
        paused: streamPaused,
        scanMode,
        jobsCount: addJobsCount,
        gridVisible: scanMode === 'add' && addJobsCount > 0,
      },
    }));
  }, [streamPaused, scanMode, addJobsCount]);

  // Beim Unmount: Reset, damit andere Seiten nicht den Scan-Pause-FAB sehen
  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent('scanner-state-changed', {
        detail: { paused: false, scanMode: 'recognize', jobsCount: 0, gridVisible: false },
      }));
    };
  }, []);

  const debugJob = jobs.find(j => j.id === debugJobId) ?? null;

  const pendingCount = jobs.filter(j => j.status === 'processing').length;
  const doneJobs = jobs.filter(j => j.status === 'done' && j.result?.card);
  const activeJob = jobs.find(j => j.id === activeJobId) ?? null;

  const removeJob = useCallback((id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id));
    setActiveJobId(prev => (prev === id ? null : prev));
  }, []);

  const markAdded = useCallback((id: string) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, added: true } : j));
    setActiveJobId(null);
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

      if (gemini.error || !gemini.setCode || !gemini.number) {
        debug.error = gemini.error ?? 'setCode oder number fehlt';
        debug.totalMs = Date.now() - t0;
        setJobs(prev => prev.map(j => j.id === id
          ? { ...j, status: 'error', result: { card: null, language: 'de' }, debugInfo: geminiSummary, debug: { ...debug } }
          : j));
        return;
      }

      const rawNumber = gemini.number.includes('/') ? gemini.number.split('/')[0] : gemini.number;

      // ── Catalog-Lookups (lookupMs misst diesen ganzen Block) ─────────────
      const tLookup = Date.now();

      debug.lookupSteps!.push(`getCardBySetCodeAndNumber("${gemini.setCode}", "${rawNumber}")`);
      let catalogCard = await getCardBySetCodeAndNumber(gemini.setCode, rawNumber);
      debug.lookupSteps![debug.lookupSteps!.length - 1] += catalogCard ? ` → ${catalogCard.id}` : ' → null';

      // Nummernformat-Variante: "005" ↔ "5"
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

      // Fallback: Pokédex-Nummer (wenn setCode nicht lesbar oder Katalog lückenhaft)
      if (!catalogCard && gemini.nationalDexNumber) {
        debug.lookupSteps!.push(`getCardsByDexNumber(${gemini.nationalDexNumber})`);
        const dexCards = await getCardsByDexNumber(gemini.nationalDexNumber, 1);
        debug.lookupSteps![debug.lookupSteps!.length - 1] += dexCards.length > 0 ? ` → ${dexCards[0].id}` : ' → null';
        if (dexCards.length > 0) catalogCard = dexCards[0];
      }

      debug.lookupMs = Date.now() - tLookup;
      debug.catalogMatch = catalogCard
        ? { id: catalogCard.id, name: catalogCard.name, setId: catalogCard.setId, number: catalogCard.number }
        : null;
      debug.totalMs = Date.now() - t0;

      const catalogInfo = catalogCard
        ? `Katalog: ${catalogCard.name} (${catalogCard.setId}/${catalogCard.number})`
        : `Katalog: nicht gefunden (setCode=${gemini.setCode}/${rawNumber})`;

      // Bild-Cleanup: bei erfolgreicher Erkennung base64 verwerfen (Katalog-CDN-Bild reicht).
      const finalDebug: ScanDebug = catalogCard
        ? { ...debug, imageBase64: undefined }
        : { ...debug };

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
    } catch (err) {
      console.error('Scan error:', err);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const msg = isAbort ? 'Upload-Timeout 90s' : err instanceof Error ? err.message : String(err);
      debug.error = msg;
      debug.totalMs = Date.now() - t0;
      setJobs(prev => prev.map(j => j.id === id
        ? { ...j, status: 'error', result: { card: null, language: 'de' }, debugInfo: `Netzwerkfehler: ${msg}`, debug: { ...debug } }
        : j));
    }
  }, []);

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
      {mode === 'review' && (
        <div
          className="absolute inset-0 overflow-y-auto bg-black px-4"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 64px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 130px)',
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            {jobs.map(job => {
              const img = cardImgUrl(job);
              const card = job.result?.card;
              const canOpen = job.status === 'done' && !!card;
              const onCardClick = () => {
                if (canOpen) setActiveJobId(job.id);
              };
              const reviewBorder = job.result?.fakeRisk
                ? FAKE_RISK_BORDER[job.result.fakeRisk]
                : 'rgba(255,255,255,0.15)';
              return (
                <div key={job.id} className="relative flex flex-col">
                  <div
                    className="relative rounded-md overflow-hidden"
                    style={{
                      background: '#1a1a1a',
                      aspectRatio: '63/88',
                      border: `2.5px solid ${reviewBorder}`,
                      cursor: canOpen ? 'pointer' : 'default',
                    }}
                    onClick={onCardClick}
                  >
                    {job.status === 'processing' ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 size={24} color="rgba(255,255,255,0.4)" className="animate-spin" />
                      </div>
                    ) : !img ? (
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
                    {/* Trash + Quick-Add unten rechts */}
                    <div
                      className="absolute flex items-end gap-1"
                      style={{ right: 2, bottom: 2 }}
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        onClick={e => { e.stopPropagation(); removeJob(job.id); }}
                        className="w-8 h-8 rounded-full flex items-center justify-center shadow-md"
                        style={{ background: 'rgba(0,0,0,0.7)' }}
                        aria-label="Entfernen"
                      >
                        <Trash2 size={14} color="#ef4444" />
                      </button>
                      {canOpen && !job.added && (
                        <button
                          onClick={e => { e.stopPropagation(); setQuickAddJobId(job.id); }}
                          className="w-11 h-11 rounded-full flex items-center justify-center shadow-md"
                          style={{ background: 'var(--pokedex-red)' }}
                          aria-label="Zur Sammlung hinzufügen"
                        >
                          <Plus size={22} color="#fff" strokeWidth={3} />
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
            })}
          </div>
        </div>
      )}

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
            {jobs.map((job, idx) => (
              <ScannedCardTile
                key={job.id}
                job={job}
                isLatest={idx === jobs.length - 1}
                onCardTap={() => setActiveJobId(job.id)}
                onRemove={() => removeJob(job.id)}
                onQuickAdd={() => setQuickAddJobId(job.id)}
                onFakeReasons={() => setFakeReasonsJobId(job.id)}
                onVariantChange={v => setJobVariant(job.id, v)}
                onConditionChange={c => setJobCondition(job.id, c)}
              />
            ))}
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

      {/* ── Erkennen-Modus: Fehler-Anzeige wenn Gemini/Katalog fehlschlägt ──
          Stream bleibt pausiert. Tap auf Erneut-Button räumt den Job auf
          und resumed den Stream — wie der FAB-Resume-Pfad. */}
      {mode === 'scanning' && scanMode === 'recognize' && !recognizedJobId && (() => {
        const errored = jobs.find(j => j.origin === 'recognize' && j.status === 'error');
        if (!errored) return null;
        const retry = () => {
          setJobs(prev => prev.filter(j => j.id !== errored.id));
          setStreamPaused(false);
        };
        return (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-6">
            <div
              className="flex flex-col items-center gap-3 px-6 py-5 rounded-2xl max-w-xs text-center"
              style={{ background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(8px)' }}
            >
              <AlertCircle size={36} color="#f87171" />
              <p className="text-white text-sm font-medium">Karte konnte nicht erkannt werden</p>
              <p className="text-white/65 text-xs leading-snug">
                Halte die Karte deutlicher in den Rahmen oder versuche eine andere Belichtung.
              </p>
              <button
                onClick={retry}
                className="mt-1 px-4 h-9 rounded-full text-sm font-semibold text-white"
                style={{ background: 'var(--pokedex-red)' }}
              >
                Erneut scannen
              </button>
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
            job={recognized}
            onCardTap={() => setActiveJobId(recognized.id)}
            onAdd={() => setQuickAddJobId(recognized.id)}
            onVariantChange={v => setJobVariant(recognized.id, v)}
            onConditionChange={c => setJobCondition(recognized.id, c)}
          />
        );
      })()}

      {/* ── Bulk-Action-Row: Alle hinzufügen / Alle löschen ─────────────
          Sichtbar wenn Karten im Slider (Add-Modus) oder im Review-Grid.
          Im Add-Modus zwischen Slider und Toolbar.
          Im Review-Modus direkt über der Safe-Area (Toolbar ist dort weg). */}
      {(() => {
        const visible = mode === 'review' && jobs.length > 0;
        if (!visible) return null;
        const unaddedCount = jobs.filter(j => j.status === 'done' && !!j.result?.card && !j.added).length;
        return (
          <div
            className="absolute left-0 right-0 z-40 flex gap-2 px-4"
            style={{
              // Über der globalen BottomNav (56px + safe-area)
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 56px)',
              paddingTop: 8,
              paddingBottom: 8,
              background: 'rgba(0,0,0,0.75)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            <button
              onClick={clearAllJobs}
              className="flex-1 h-11 rounded-full text-sm font-semibold flex items-center justify-center gap-1.5"
              style={{
                background: 'rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.9)',
                border: '1px solid rgba(255,255,255,0.15)',
              }}
            >
              <Trash2 size={15} color="#ef4444" />
              Alle löschen
            </button>
            <button
              onClick={openBulkAdd}
              disabled={unaddedCount === 0}
              className="flex-1 h-11 rounded-full text-sm font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
              style={{ background: 'var(--pokedex-red)' }}
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
  onCardTap:         () => void;
  onRemove:          () => void;
  onQuickAdd:        () => void;
  onFakeReasons:     () => void;
  onVariantChange:   (v: CardVariant) => void;
  onConditionChange: (c: PersistedCondition) => void;
}

function ScannedCardTile({
  job, isLatest, onCardTap, onRemove, onFakeReasons,
  onVariantChange, onConditionChange,
}: ScannedCardTileProps) {
  const img       = cardImgUrl(job);
  const card      = job.result?.card;
  const canOpen   = job.status === 'done' && !!card;
  const borderCol = job.result?.fakeRisk
    ? FAKE_RISK_BORDER[job.result.fakeRisk]
    : 'rgba(255,255,255,0.15)';
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
          border: `2.5px solid ${borderCol}`,
          background: '#1a1a1a',
          cursor: canOpen ? 'pointer' : 'default',
        }}
        onClick={canOpen ? onCardTap : undefined}
      >
        {job.status === 'processing' ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 size={24} color="rgba(255,255,255,0.4)" className="animate-spin" />
          </div>
        ) : !img ? (
          <div className="w-full h-full flex items-center justify-center bg-red-500/10">
            <AlertCircle size={22} color="#f87171" />
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={img} alt={card?.name ?? ''} className="w-full h-full object-cover" />
        )}

        {/* Trash unten rechts (~2 px Abstand zum Rand) */}
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          className="absolute bottom-0.5 right-0.5 w-7 h-7 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          aria-label="Entfernen"
        >
          <Trash2 size={14} color="#ef4444" />
        </button>

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
}

function RecognizedCardLarge({
  job, onCardTap, onAdd, onVariantChange, onConditionChange,
}: RecognizedCardLargeProps) {
  const img       = cardImgUrlLarge(job);
  const card      = job.result?.card;
  const borderCol = job.result?.fakeRisk
    ? FAKE_RISK_BORDER[job.result.fakeRisk]
    : 'rgba(255,255,255,0.15)';
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
      {/* Pokemon-Name */}
      <h2 className="text-white font-semibold text-lg truncate text-center max-w-full">
        {card?.name ?? 'Karte'}
      </h2>

      {/* Karten-Body — Höhe begrenzt durch verfügbaren Platz, Breite via aspect-ratio */}
      <div
        className="relative rounded-lg overflow-hidden"
        style={{
          aspectRatio: '63 / 88',
          height: 'min(70vh, 100%)',
          maxWidth: '100%',
          border: `3px solid ${borderCol}`,
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
          className="w-full h-12 rounded-full text-white font-semibold flex items-center justify-center gap-2 shadow-lg"
          style={{ background: 'var(--pokedex-red)' }}
        >
          <Plus size={20} strokeWidth={3} />
          Zur Sammlung hinzufügen
        </button>
      )}
    </div>
  );
}
