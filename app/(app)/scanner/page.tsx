'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pause, Play, Trash2, Loader2, AlertCircle, StopCircle, Check, Plus } from 'lucide-react';
import { CameraCapture } from '@/components/scanner/CameraCapture';
import { AddToCollectionModal } from '@/components/scanner/AddToCollectionModal';
import { getCardBySetAndNumber, getCardsByDexNumber } from '@/lib/firestore/catalog';
import { getCardsByTcgId } from '@/lib/firestore/cards';
import { catalogCardToInfo, cardInfoToTcgApi } from '@/lib/card-info';
import type { CardInfo } from '@/lib/card-info';
import type { CardLanguage, CardVariant } from '@/types';
import { toTcgdexId } from '@/lib/tcgdex';

interface GeminiResponse {
  setId?: string;
  number?: string;
  language?: string;
  confidence?: string;
  nationalDexNumber?: number | null;
  variant?: string;
  error?: string;
}

interface ScanState {
  card: CardInfo | null;
  language: CardLanguage;
  variant?: CardVariant;
  ownedCount?: number;
}

interface ScanJob {
  id: string;
  status: 'processing' | 'done' | 'error';
  result: ScanState | null;
  added?: boolean;
}

function cardImgUrl(job: ScanJob): string | null {
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
  const [isPaused, setIsPaused] = useState(false);
  const [mode, setMode] = useState<'scanning' | 'review'>('scanning');

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
    setJobs(prev => [...prev, { id, status: 'processing', result: null }]);

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType }),
      });
      const gemini: GeminiResponse = await res.json();

      if (gemini.error || !gemini.setId || !gemini.number) {
        setJobs(prev => prev.map(j => j.id === id
          ? { ...j, status: 'error', result: { card: null, language: 'de' } }
          : j));
        return;
      }

      const rawNumber = gemini.number.includes('/') ? gemini.number.split('/')[0] : gemini.number;

      let catalogCard = await getCardBySetAndNumber(gemini.setId, rawNumber);
      if (!catalogCard) {
        const alt = /^\d+$/.test(rawNumber) ? String(parseInt(rawNumber, 10)) : rawNumber.padStart(3, '0');
        if (alt !== rawNumber) catalogCard = await getCardBySetAndNumber(gemini.setId, alt);
      }

      if (!catalogCard && gemini.nationalDexNumber) {
        const dexCards = await getCardsByDexNumber(gemini.nationalDexNumber, 1);
        if (dexCards.length > 0) catalogCard = dexCards[0];
      }

      const ownedCopies = catalogCard ? await getCardsByTcgId(catalogCard.id) : [];

      const variantMap: Record<string, CardVariant> = {
        holo: 'holo', reverse: 'reverse', 'alt-art': 'alt-art', promo: 'promo', standard: 'standard',
      };

      setJobs(prev => prev.map(j => j.id === id ? {
        ...j,
        status: catalogCard ? 'done' : 'error',
        result: {
          card: catalogCard ? catalogCardToInfo(catalogCard) : null,
          language: (gemini.language ?? 'de') as CardLanguage,
          variant: variantMap[gemini.variant ?? ''] ?? 'standard',
          ownedCount: ownedCopies.length,
        },
      } : j));
    } catch (err) {
      console.error('Scan error:', err);
      setJobs(prev => prev.map(j => j.id === id
        ? { ...j, status: 'error', result: { card: null, language: 'de' } }
        : j));
    }
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-black">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 bg-black">
        <button
          onClick={() => router.back()}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10"
        >
          <ArrowLeft size={18} color="#fff" />
        </button>

        {mode === 'scanning' ? (
          <>
            <h1 className="text-base font-semibold text-white">Karte scannen</h1>
            <button
              onClick={() => setIsPaused(p => !p)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
              style={{
                background: isPaused ? 'rgba(72,187,120,.2)' : 'rgba(255,255,255,.1)',
                color: isPaused ? '#48bb78' : '#fff',
              }}
            >
              {isPaused ? <><Play size={14} /> Weiter</> : <><Pause size={14} /> Pause</>}
            </button>
          </>
        ) : (
          <>
            <h1 className="text-base font-semibold text-white">
              {doneJobs.length} Karte{doneJobs.length !== 1 ? 'n' : ''} gescannt
            </h1>
            <button
              onClick={() => setMode('scanning')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium"
              style={{ background: 'rgba(255,255,255,.1)', color: '#fff' }}
            >
              <Plus size={14} /> Mehr
            </button>
          </>
        )}
      </div>

      {/* ── Scanning-Modus: Kamera + Slider ─────────────────────── */}
      {mode === 'scanning' && (
        <>
          <div className="flex-1 flex flex-col px-4 pb-2 min-h-0">
            <CameraCapture onCapture={handleCapture} pendingCount={pendingCount} paused={isPaused} />
          </div>

          {jobs.length > 0 && (
            <div className="px-4 pb-3">
              <div className="flex gap-3 overflow-x-auto py-2" style={{ scrollbarWidth: 'none' }}>
                {jobs.map(job => {
                  const img = cardImgUrl(job);
                  const canOpen = job.status === 'done' && !!job.result?.card;
                  return (
                    <div key={job.id} className="relative shrink-0" style={{ width: 72 }}>
                      <div
                        className="relative rounded-xl overflow-hidden"
                        style={{
                          width: 72, height: 101,
                          border: `2px solid ${activeJobId === job.id ? 'var(--pokedex-red)' : 'rgba(255,255,255,0.15)'}`,
                          background: '#1a1a1a',
                          cursor: canOpen ? 'pointer' : 'default',
                          transition: 'border-color 0.15s',
                        }}
                        onClick={() => canOpen && setActiveJobId(job.id)}
                      >
                        {job.status === 'processing' ? (
                          <div className="w-full h-full flex items-center justify-center">
                            <Loader2 size={22} color="rgba(255,255,255,0.4)" className="animate-spin" />
                          </div>
                        ) : !img ? (
                          <div className="w-full h-full flex items-center justify-center bg-red-500/10">
                            <AlertCircle size={22} color="#f87171" />
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
                        {job.added && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                            <Check size={20} color="#48bb78" strokeWidth={3} />
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeJob(job.id)}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center z-10"
                        style={{ background: '#2a2a2a', border: '1.5px solid rgba(255,255,255,0.2)' }}
                        aria-label="Entfernen"
                      >
                        <Trash2 size={11} color="#ef4444" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Review-Modus: Karten-Grid ────────────────────────────── */}
      {mode === 'review' && (
        <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
          <div className="grid grid-cols-3 gap-3">
            {jobs.map(job => {
              const img = cardImgUrl(job);
              const card = job.result?.card;
              const canOpen = job.status === 'done' && !!card;
              return (
                <div key={job.id} className="relative flex flex-col">
                  {/* Karten-Bild */}
                  <div
                    className="relative rounded-xl overflow-hidden border border-white/10"
                    style={{
                      background: '#1a1a1a',
                      aspectRatio: '2.5/3.5',
                      cursor: canOpen ? 'pointer' : 'default',
                    }}
                    onClick={() => canOpen && setActiveJobId(job.id)}
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

                    {/* Hinzugefügt-Overlay */}
                    {job.added && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center"
                          style={{ background: 'rgba(72,187,120,.9)' }}>
                          <Check size={20} color="#fff" strokeWidth={3} />
                        </div>
                      </div>
                    )}

                    {/* Papierkorb-Badge */}
                    <button
                      onClick={e => { e.stopPropagation(); removeJob(job.id); }}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(0,0,0,0.7)' }}
                      aria-label="Entfernen"
                    >
                      <Trash2 size={11} color="#ef4444" />
                    </button>

                    {/* Owned-Badge */}
                    {(job.result?.ownedCount ?? 0) > 0 && !job.added && (
                      <span className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                        style={{ background: 'rgba(72,187,120,.85)', color: '#fff' }}>
                        ×{job.result!.ownedCount}
                      </span>
                    )}
                  </div>

                  {/* Name + Hinzufügen-Button */}
                  <p className="text-[10px] text-white/60 text-center mt-1 truncate px-0.5">
                    {card?.name ?? (job.status === 'processing' ? '…' : 'Fehler')}
                  </p>
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

      {/* ── Stop-FAB (überlagert BottomNav-Kamera) ──────────────── */}
      {doneJobs.length > 0 && mode === 'scanning' && (
        <button
          onClick={() => setMode('review')}
          className="fixed left-1/2 -translate-x-1/2 z-[55] rounded-full shadow-lg flex items-center justify-center"
          style={{
            width: 56, height: 56,
            bottom: 'calc(58px + env(safe-area-inset-bottom, 0px))',
            background: 'var(--pokedex-red)',
          }}
          aria-label="Scannen beenden"
        >
          <StopCircle size={26} color="#fff" />
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-white text-[10px] font-bold px-1"
            style={{ background: '#22c55e' }}
          >
            {doneJobs.length}
          </span>
        </button>
      )}

      {/* ── AddToCollectionModal ─────────────────────────────────── */}
      {activeJob?.result?.card && (
        <AddToCollectionModal
          card={cardInfoToTcgApi(activeJob.result.card)}
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
