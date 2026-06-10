'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, Trash2, Loader2, AlertCircle, Check, Plus, LayoutGrid, Camera, Bug } from 'lucide-react';
import { CameraCapture } from '@/components/scanner/CameraCapture';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { getCardBySetCodeAndNumberRest as getCardBySetCodeAndNumber,
         getCardsByDexNumberRest      as getCardsByDexNumber } from '@/lib/firestore/catalog-rest';
import { getCardsByTcgId } from '@/lib/firestore/cards';
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

export default function ScannerPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeOwnedCopies, setActiveOwnedCopies] = useState<CardDoc[]>([]);
  const [debugJobId, setDebugJobId] = useState<string | null>(null);
  const [mode, setMode] = useState<'scanning' | 'review'>('scanning');
  // Scanner-Workflow: Hinzufügen (Slider-Sammlung) vs. Erkennen (Lookup-Anzeige).
  // In Stufe 3 nur Visual — Verhalten ändert sich in Stufe 4.
  const [scanMode, setScanMode] = useState<'add' | 'recognize'>('add');
  // FIFO-Queue für Uploads: parallele Scans senden nacheinander statt
  // gleichzeitig — verhindert Bandbreiten-Konkurrenz auf schwachem Mobilnetz.
  const uploadChainRef = useRef<Promise<unknown>>(Promise.resolve());

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
    setJobs(prev => [...prev, {
      id, status: 'processing', result: null, debug,
    }]);

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
          <CameraCapture onCapture={handleCapture} pendingCount={pendingCount} paused={false} />
        </div>
      )}

      {/* ── Review-Modus: schwarzer Hintergrund, scrollbar ──────── */}
      {mode === 'review' && (
        <div
          className="absolute inset-0 overflow-y-auto bg-black px-4 pb-6"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 64px)' }}
        >
          <div className="grid grid-cols-3 gap-3">
            {jobs.map(job => {
              const img = cardImgUrl(job);
              const card = job.result?.card;
              const canOpen = job.status === 'done' && !!card;
              const canDebug = !!job.debug;
              const onCardClick = () => {
                if (canOpen) setActiveJobId(job.id);
                else if (canDebug) setDebugJobId(job.id);
              };
              return (
                <div key={job.id} className="relative flex flex-col">
                  <div
                    className="relative rounded-xl overflow-hidden border border-white/10"
                    style={{ background: '#1a1a1a', aspectRatio: '2.5/3.5', cursor: (canOpen || canDebug) ? 'pointer' : 'default' }}
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
                    <button
                      onClick={e => { e.stopPropagation(); removeJob(job.id); }}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(0,0,0,0.7)' }}
                    >
                      <Trash2 size={11} color="#ef4444" />
                    </button>
                    {canDebug && (
                      <button
                        onClick={e => { e.stopPropagation(); setDebugJobId(job.id); }}
                        className="absolute top-1 right-8 w-6 h-6 rounded-full flex items-center justify-center"
                        style={{ background: 'rgba(0,0,0,0.7)' }}
                        aria-label="Debug-Info"
                      >
                        <Bug size={11} color="#60a5fa" />
                      </button>
                    )}
                    {(job.result?.ownedCount ?? 0) > 0 && !job.added && (
                      <span className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                        style={{ background: 'rgba(72,187,120,.85)', color: '#fff' }}>
                        ×{job.result!.ownedCount}
                      </span>
                    )}
                    {job.result?.condition && (() => {
                      const p = GEMINI_TO_PERSISTED[job.result.condition];
                      const c = PERSISTED_CONDITION_COLOR[p];
                      return (
                        <span className="absolute bottom-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: c.bg, color: c.text }}>
                          {p}
                        </span>
                      );
                    })()}
                    {job.result?.fakeRisk === 'high' && (
                      <span className="absolute bottom-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                        style={{ background: 'rgba(239,68,68,.9)', color: '#fff' }}
                        title={job.result.fakeReasons?.join(', ')}>
                        FAKE?
                      </span>
                    )}
                    {job.result?.fakeRisk === 'medium' && (
                      <span className="absolute bottom-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                        style={{ background: 'rgba(234,179,8,.9)', color: '#000' }}
                        title={job.result.fakeReasons?.join(', ')}>
                        Verdächtig
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-white/60 text-center mt-1 truncate px-0.5">
                    {card?.name ?? (job.status === 'processing' ? '…' : 'Fehler')}
                  </p>
                  {canDebug && (
                    <p className="text-[9px] text-blue-300 text-center font-mono">
                      Tippen für Debug
                    </p>
                  )}
                  {canOpen && !job.added && (
                    <button
                      onClick={() => setActiveJobId(job.id)}
                      className="mt-1 w-full h-7 rounded-lg text-[10px] font-semibold text-white flex items-center justify-center gap-1"
                      style={{ background: 'var(--pokedex-red)' }}
                    >
                      <Plus size={11} /> Hinzufügen
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Header (schwebt über Kamera/Review) ─────────────────── */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        {jobs.length > 0 ? (
          <button
            onClick={() => setMode(mode === 'scanning' ? 'review' : 'scanning')}
            className="relative w-9 h-9 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-sm"
            aria-label={mode === 'scanning' ? 'Übersicht öffnen' : 'Zurück zum Scannen'}
          >
            {mode === 'scanning'
              ? <LayoutGrid size={18} color="#fff" />
              : <Camera size={18} color="#fff" />}
            {mode === 'scanning' && (
              <span
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                style={{ background: 'var(--pokedex-red)', color: '#fff' }}
              >
                {jobs.length}
              </span>
            )}
          </button>
        ) : (
          <div className="w-9" />
        )}
        {/* Mode-Switch [Hinzufügen | Erkennen] — verdrängt die "Karten gescannt"-Anzeige */}
        <div
          className="flex rounded-full p-0.5 bg-black/50 backdrop-blur-sm"
          style={{ border: '1px solid rgba(255,255,255,0.12)' }}
        >
          {(['add', 'recognize'] as const).map(m => (
            <button
              key={m}
              onClick={() => setScanMode(m)}
              className="px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors"
              style={{
                background: scanMode === m ? 'var(--pokedex-red)' : 'transparent',
                color:      scanMode === m ? '#fff' : 'rgba(255,255,255,0.65)',
              }}
            >
              {m === 'add' ? 'Hinzufügen' : 'Erkennen'}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            // router.back() funktioniert nur wenn Browser-History existiert.
            // Fallback: sofort zur Startseite navigieren.
            if (window.history.length > 1) {
              router.back();
            } else {
              router.replace('/');
            }
          }}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-sm"
          aria-label="Schließen"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      {/* ── Hinzufügen-Modus: Thumbnail-Slider unten ──────────────────
          4 Tiles immer sichtbar, Rest per Swipe mit scroll-snap. */}
      {mode === 'scanning' && scanMode === 'add' && jobs.length > 0 && (
        <div
          className="absolute left-0 right-0 z-10 px-4"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
        >
          <div
            className="flex gap-2 overflow-x-auto pb-2 pt-1"
            style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}
          >
            {jobs.map(job => (
              <ScannedCardTile
                key={job.id}
                job={job}
                onCardTap={() => setActiveJobId(job.id)}
                onDebug={() => setDebugJobId(job.id)}
                onRemove={() => removeJob(job.id)}
                onVariantChange={v => setJobVariant(job.id, v)}
                onConditionChange={c => setJobCondition(job.id, c)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Erkennen-Modus: zentrale große Karten-Anzeige ──────────────
          Zeigt nur den zuletzt erfolgreich gescannten Job. Neuer Scan
          überschreibt visuell, aber alle Scans bleiben in `jobs`. */}
      {mode === 'scanning' && scanMode === 'recognize' && (() => {
        const latest = [...doneJobs].reverse()[0] ?? null;
        if (!latest) return null;
        return (
          <RecognizedCardLarge
            job={latest}
            onCardTap={() => setActiveJobId(latest.id)}
            onDebug={() => setDebugJobId(latest.id)}
            onVariantChange={v => setJobVariant(latest.id, v)}
            onConditionChange={c => setJobCondition(latest.id, c)}
          />
        );
      })()}


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
    </div>
  );
}

// ───── Scanned-Card-Tile ─────────────────────────────────────────────────
// Tile-Breite: (100vw − 32px Container-Padding − 24px für 3 Gaps) / 4
const TILE_WIDTH_CSS = 'calc((100vw - 56px) / 4)';

interface ScannedCardTileProps {
  job: ScanJob;
  onCardTap:         () => void;
  onDebug:           () => void;
  onRemove:          () => void;
  onVariantChange:   (v: CardVariant) => void;
  onConditionChange: (c: PersistedCondition) => void;
}

function ScannedCardTile({
  job, onCardTap, onDebug, onRemove, onVariantChange, onConditionChange,
}: ScannedCardTileProps) {
  const img       = cardImgUrl(job);
  const card      = job.result?.card;
  const canOpen   = job.status === 'done' && !!card;
  const canDebug  = !!job.debug;
  const borderCol = job.result?.fakeRisk
    ? FAKE_RISK_BORDER[job.result.fakeRisk]
    : 'rgba(255,255,255,0.15)';
  const cardVariants = card?.variants?.length ? card.variants : (['standard'] as CardVariant[]);
  const variant   = job.editedVariant   ?? cardVariants[0];
  const condition = job.editedCondition ?? 'NM';
  const condColor = PERSISTED_CONDITION_COLOR[condition];

  return (
    <div
      className="shrink-0 flex flex-col gap-1"
      style={{ width: TILE_WIDTH_CSS, scrollSnapAlign: 'start' }}
    >
      {/* Name oben */}
      <div className="flex items-center justify-center gap-1 px-0.5 min-h-[14px]">
        <p className="text-[10px] text-white font-medium text-center truncate leading-tight">
          {card?.name ?? (job.status === 'processing' ? '…' : 'Fehler')}
        </p>
        {canDebug && (
          <button
            onClick={e => { e.stopPropagation(); onDebug(); }}
            className="shrink-0 w-3 h-3 flex items-center justify-center"
            aria-label="Debug-Info"
          >
            <Bug size={10} color="#60a5fa" />
          </button>
        )}
      </div>

      {/* Karten-Body */}
      <div
        className="relative w-full rounded-2xl overflow-hidden"
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
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-red-500/10 p-1.5">
            <AlertCircle size={20} color="#f87171" />
            {job.debugInfo && (
              <p className="text-[7px] text-red-300/80 text-center leading-tight break-all">
                {job.debugInfo}
              </p>
            )}
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={img} alt={card?.name ?? ''} className="w-full h-full object-cover" />
        )}

        {/* Owned-Badge (oben links) */}
        {(job.result?.ownedCount ?? 0) > 0 && !job.added && (
          <span
            className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md"
            style={{ background: 'rgba(72,187,120,.85)', color: '#fff' }}
          >
            ×{job.result!.ownedCount}
          </span>
        )}

        {/* Trash (oben rechts) */}
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          aria-label="Entfernen"
        >
          <Trash2 size={12} color="#ef4444" />
        </button>

        {/* Variant-Pill (unten links) — mit unsichtbarem <select> für iOS-Wheel-Picker */}
        {card && (
          <div className="absolute bottom-1 left-1">
            <span
              className="text-[8px] font-bold px-1.5 py-0.5 rounded-md inline-block"
              style={{ background: 'rgba(0,0,0,0.7)', color: '#fff' }}
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

        {/* Condition-Pill (unten rechts) */}
        {card && (
          <div className="absolute bottom-1 right-1">
            <span
              className="text-[8px] font-bold px-1.5 py-0.5 rounded-md inline-block"
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

      {/* Set-Code + Nummer unten */}
      <p className="text-[9px] text-white/55 text-center font-mono leading-tight truncate px-0.5 min-h-[12px]">
        {card?.setCode ? `${card.setCode} ${card.number}` : ' '}
      </p>
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
  onDebug:           () => void;
  onVariantChange:   (v: CardVariant) => void;
  onConditionChange: (c: PersistedCondition) => void;
}

function RecognizedCardLarge({
  job, onCardTap, onDebug, onVariantChange, onConditionChange,
}: RecognizedCardLargeProps) {
  const img       = cardImgUrl(job);
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
        top: 'calc(env(safe-area-inset-top, 0px) + 64px)',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
      }}
    >
      {/* Owned-Banner */}
      <div
        className="w-full px-4 py-2.5 rounded-xl text-center text-sm font-semibold"
        style={{
          background: !ownedKnown
            ? 'rgba(0,0,0,0.55)'
            : isOwned ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.85)',
          color: '#fff',
          backdropFilter: 'blur(6px)',
        }}
      >
        {!ownedKnown ? 'Sammlung wird geprüft …'
          : isOwned ? `Bereits in deiner Sammlung (×${ownedCount})`
          : 'Noch nicht in deiner Sammlung'}
      </div>

      {/* Name + Debug */}
      <div className="flex items-center justify-center gap-2 max-w-full">
        <h2 className="text-white font-semibold text-lg truncate">
          {card?.name ?? 'Karte'}
        </h2>
        {job.debug && (
          <button
            onClick={onDebug}
            className="shrink-0 w-6 h-6 flex items-center justify-center"
            aria-label="Debug-Info"
          >
            <Bug size={14} color="#60a5fa" />
          </button>
        )}
      </div>

      {/* Karten-Body — Höhe begrenzt durch verfügbaren Platz, Breite via aspect-ratio */}
      <div
        className="relative rounded-2xl overflow-hidden"
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

      {/* Set-Code + Nummer */}
      <p className="text-sm text-white/70 text-center font-mono">
        {card?.setCode ? `${card.setCode} ${card.number}` : '—'}
      </p>
    </div>
  );
}
