'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X, Trash2, Loader2, AlertCircle, Check, Plus, LayoutGrid, Camera, Bug } from 'lucide-react';
import { CameraCapture } from '@/components/scanner/CameraCapture';
import { AddToCollectionModal } from '@/components/scanner/AddToCollectionModal';
import { getCardBySetCodeAndNumber, getCardsByDexNumber } from '@/lib/firestore/catalog';
import { getCardsByTcgId } from '@/lib/firestore/cards';
import { catalogCardToInfo } from '@/lib/card-info';
import type { CardInfo } from '@/lib/card-info';
import type { CardLanguage, CardVariant } from '@/types';
import { toTcgdexId } from '@/lib/tcgdex';

export type CardCondition = 'nm' | 'lp' | 'mp' | 'hp' | 'd';

const CONDITION_LABEL: Record<CardCondition, string> = {
  nm: 'NM', lp: 'LP', mp: 'MP', hp: 'HP', d: 'D',
};
const CONDITION_COLOR: Record<CardCondition, { bg: string; text: string }> = {
  nm: { bg: 'rgba(34,197,94,.85)',  text: '#fff' },
  lp: { bg: 'rgba(132,204,22,.85)', text: '#fff' },
  mp: { bg: 'rgba(234,179,8,.85)',  text: '#000' },
  hp: { bg: 'rgba(249,115,22,.85)', text: '#fff' },
  d:  { bg: 'rgba(239,68,68,.85)',  text: '#fff' },
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
  geminiMs?: number;             // Dauer Gemini-Call
  totalMs?: number;              // Gesamtdauer Scan→DB
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
}

function cardImgUrl(job: ScanJob): string | null {
  // Während Verarbeitung: aufgenommenes Bild als Vorschau zeigen
  // (Image base64 ist die einzige Quelle — kein Duplikat im State).
  if (job.status === 'processing' && job.debug?.imageBase64)
    return `data:${job.debug.mimeType ?? 'image/jpeg'};base64,${job.debug.imageBase64}`;
  const card = job.result?.card;
  if (!card) return null;
  const lang = job.result?.language ?? 'en';
  if (lang === 'de') {
    return `https://assets.tcgdex.net/de/${toTcgdexId(card.setId)}/${card.number}/high.webp`;
  }
  return card.imgSmall ?? null;
}

export default function ScannerPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [debugJobId, setDebugJobId] = useState<string | null>(null);
  const [mode, setMode] = useState<'scanning' | 'review'>('scanning');

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
      const tFetch = Date.now();
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType }),
      });
      const gemini: GeminiResponse & { _debug?: { model: string; ms: number; rawText: string } }
        = await res.json();
      const fetchMs = Date.now() - tFetch;

      debug.geminiModel = gemini._debug?.model;
      debug.geminiMs    = gemini._debug?.ms ?? fetchMs;
      debug.geminiRaw   = gemini._debug?.rawText;
      debug.geminiParsed = { ...gemini, _debug: undefined };
      console.log('[scanner] Gemini response:', { ms: fetchMs, parsed: gemini });

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

      // Firestore-Catalog: Lookup per gedrucktem Set-Kürzel (ptcgoCode) + Nummer.
      // Zuverlässiger als setId, da Gemini nur liest was auf der Karte steht.
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

      debug.catalogMatch = catalogCard
        ? { id: catalogCard.id, name: catalogCard.name, setId: catalogCard.setId, number: catalogCard.number }
        : null;
      debug.totalMs = Date.now() - t0;

      const catalogInfo = catalogCard
        ? `Katalog: ${catalogCard.name} (${catalogCard.setId}/${catalogCard.number})`
        : `Katalog: nicht gefunden (setCode=${gemini.setCode}/${rawNumber})`;

      // getCardsByTcgId benötigt Firebase-Client-Auth (Security Rules).
      // Falls der Client noch nicht eingeloggt ist → graceful fallback auf 0.
      let ownedCopies: Awaited<ReturnType<typeof getCardsByTcgId>> = [];
      try {
        ownedCopies = catalogCard ? await getCardsByTcgId(catalogCard.id) : [];
      } catch {
        // Firebase-Auth noch nicht initialisiert oder Security-Rules greifen → ownedCount = 0
      }
      // Bei erfolgreicher Karten-Erkennung das base64-Bild aus dem Debug-Objekt
      // entfernen → spart pro Scan ~200KB RAM (Katalog-Bild kommt von CDN).
      // Fehler-Karten behalten das Bild für die Debug-Anzeige.
      const finalDebug: ScanDebug = catalogCard
        ? { ...debug, imageBase64: undefined }
        : { ...debug };

      setJobs(prev => prev.map(j => j.id === id ? {
        ...j,
        status: catalogCard ? 'done' : 'error',
        debugInfo: `${geminiSummary} | ${catalogInfo}`,
        debug: finalDebug,
        result: {
          card: catalogCard ? catalogCardToInfo(catalogCard) : null,
          language: (gemini.language ?? 'de') as CardLanguage,
          ownedCount: ownedCopies.length,
          condition: gemini.condition,
          fakeRisk: gemini.fakeRisk,
          fakeReasons: gemini.fakeReasons,
        },
      } : j));
    } catch (err) {
      console.error('Scan error:', err);
      const msg = err instanceof Error ? err.message : String(err);
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
                    {job.result?.condition && CONDITION_COLOR[job.result.condition] && (
                      <span className="absolute bottom-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                        style={{ background: CONDITION_COLOR[job.result.condition].bg, color: CONDITION_COLOR[job.result.condition].text }}>
                        {CONDITION_LABEL[job.result.condition]}
                      </span>
                    )}
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
        <h1 className="text-base font-semibold text-white drop-shadow">
          {mode === 'scanning' ? 'Karten scannen' : `${doneJobs.length} Karte${doneJobs.length !== 1 ? 'n' : ''} gescannt`}
        </h1>
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

      {/* ── Thumbnail-Slider (Scan-Modus, schwebt unten) ─────────── */}
      {mode === 'scanning' && jobs.length > 0 && (
        <div
          className="absolute left-0 right-0 z-10 px-4"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
        >
          <div className="flex gap-3 overflow-x-auto py-2" style={{ scrollbarWidth: 'none' }}>
                {jobs.map(job => {
                  const img = cardImgUrl(job);
                  const canOpen = job.status === 'done' && !!job.result?.card;
                  // Debug-Zugang für alle Jobs mit Debug-Info (Fehler ODER erfolgreich).
                  // Bei done-Karten öffnet der Bug-Button das Debug-Modal,
                  // Tap auf die Thumbnail-Fläche bleibt für 'Hinzufügen' reserviert.
                  const canDebug = !!job.debug;
                  const onThumbClick = () => {
                    if (canOpen) setActiveJobId(job.id);
                    else if (canDebug) setDebugJobId(job.id);
                  };
                  return (
                    <div key={job.id} className="relative shrink-0" style={{ width: 72 }}>
                      <div
                        className="relative rounded-xl overflow-hidden"
                        style={{
                          width: 72, height: 101,
                          border: `2px solid ${activeJobId === job.id ? 'var(--pokedex-red)' : 'rgba(255,255,255,0.15)'}`,
                          background: '#1a1a1a',
                          cursor: (canOpen || canDebug) ? 'pointer' : 'default',
                          transition: 'border-color 0.15s',
                        }}
                        onClick={onThumbClick}
                      >
                        {job.status === 'processing' ? (
                          <div className="w-full h-full flex items-center justify-center">
                            <Loader2 size={22} color="rgba(255,255,255,0.4)" className="animate-spin" />
                          </div>
                        ) : !img ? (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-red-500/10 p-1.5">
                            <AlertCircle size={16} color="#f87171" />
                            {job.debugInfo && (
                              <p className="text-[6.5px] text-red-300/80 text-center leading-tight break-all">
                                {job.debugInfo}
                              </p>
                            )}
                          </div>
                        ) : (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={img} alt="" className="w-full h-full object-cover" />
                        )}
                        {(job.result?.ownedCount ?? 0) > 0 && (
                          <span className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                            style={{ background: 'rgba(72,187,120,.85)', color: '#fff' }}>
                            ×{job.result!.ownedCount}
                          </span>
                        )}
                        {job.result?.condition && CONDITION_COLOR[job.result.condition] && (
                          <span className="absolute bottom-1 right-1 text-[8px] font-bold px-1 py-0.5 rounded"
                            style={{ background: CONDITION_COLOR[job.result.condition].bg, color: CONDITION_COLOR[job.result.condition].text }}>
                            {CONDITION_LABEL[job.result.condition]}
                          </span>
                        )}
                        {job.result?.fakeRisk === 'high' && (
                          <span className="absolute bottom-1 left-1 text-[8px] font-bold px-1 py-0.5 rounded"
                            style={{ background: 'rgba(239,68,68,.9)', color: '#fff' }}
                            title={job.result.fakeReasons?.join(', ')}>
                            FAKE?
                          </span>
                        )}
                        {job.result?.fakeRisk === 'medium' && (
                          <span className="absolute bottom-1 left-1 text-[8px] font-bold px-1 py-0.5 rounded"
                            style={{ background: 'rgba(234,179,8,.9)', color: '#000' }}
                            title={job.result.fakeReasons?.join(', ')}>
                            ?
                          </span>
                        )}
                        {job.added && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                            <Check size={20} color="#48bb78" strokeWidth={3} />
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeJob(job.id)}
                        className="absolute -top-2 -right-2 w-7 h-7 rounded-full flex items-center justify-center z-10"
                        style={{ background: '#2a2a2a', border: '1.5px solid rgba(255,255,255,0.2)' }}
                        aria-label="Entfernen"
                      >
                        <Trash2 size={12} color="#ef4444" />
                      </button>
                      {canDebug && (
                        <button
                          onClick={e => { e.stopPropagation(); setDebugJobId(job.id); }}
                          className="absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center z-10"
                          style={{ background: '#2a2a2a', border: '1.5px solid rgba(255,255,255,0.2)' }}
                          aria-label="Debug-Info"
                        >
                          <Bug size={12} color="#60a5fa" />
                        </button>
                      )}
                    </div>
                  );
                })}
          </div>
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
              <div>Gemini-Dauer: <span className="text-blue-300">{debugJob.debug.geminiMs ?? '—'} ms</span></div>
              <div>Gesamt-Dauer: <span className="text-blue-300">{debugJob.debug.totalMs ?? '—'} ms</span></div>
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

      {/* ── AddToCollectionModal ─────────────────────────────────── */}
      {activeJob?.result?.card && (
        <AddToCollectionModal
          card={activeJob.result.card}
          preVariant={activeJob.result.variant}
          preLanguage={activeJob.result.language}
          fromScanner
          onClose={() => setActiveJobId(null)}
          onSaved={() => markAdded(activeJob.id)}
        />
      )}
    </div>
  );
}
