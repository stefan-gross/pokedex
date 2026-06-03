'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pause, Play, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { CameraCapture } from '@/components/scanner/CameraCapture';
import { CardScanResult } from '@/components/scanner/CardScanResult';
import { getCardBySetAndNumber, getCardsByDexNumber } from '@/lib/firestore/catalog';
import { getCardsByTcgId } from '@/lib/firestore/cards';
import { catalogCardToInfo } from '@/lib/card-info';
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
  candidates?: CardInfo[] | null;
  language: CardLanguage;
  confidence: string;
  variant?: CardVariant;
  ownedCount?: number;
  error?: string;
}

interface ScanJob {
  id: string;
  status: 'processing' | 'done' | 'error';
  result: ScanState | null;
}

function thumbUrl(job: ScanJob): string | null {
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
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const pendingCount = jobs.filter(j => j.status === 'processing').length;
  const selectedJob  = jobs.find(j => j.id === selectedJobId) ?? null;

  // Erstes fertiges Job auto-selektieren
  useEffect(() => {
    if (!selectedJobId) {
      const first = jobs.find(j => j.status === 'done' || j.status === 'error');
      if (first) setSelectedJobId(first.id);
    }
  }, [jobs, selectedJobId]);

  const removeJob = useCallback((id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id));
    setSelectedJobId(prev => (prev === id ? null : prev));
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
        setJobs(prev => prev.map(j => j.id === id ? {
          ...j, status: 'error',
          result: { card: null, language: 'de', confidence: 'low', error: gemini.error ?? 'Karte nicht erkannt' },
        } : j));
        return;
      }

      const rawNumber = gemini.number.includes('/') ? gemini.number.split('/')[0] : gemini.number;

      let catalogCard = await getCardBySetAndNumber(gemini.setId, rawNumber);
      if (!catalogCard) {
        const alt = /^\d+$/.test(rawNumber) ? String(parseInt(rawNumber, 10)) : rawNumber.padStart(3, '0');
        if (alt !== rawNumber) catalogCard = await getCardBySetAndNumber(gemini.setId, alt);
      }

      let dexCandidates: CardInfo[] | null = null;
      if (!catalogCard && gemini.nationalDexNumber) {
        const dexCards = await getCardsByDexNumber(gemini.nationalDexNumber, 20);
        if (dexCards.length > 0) dexCandidates = dexCards.map(catalogCardToInfo);
      }

      // Duplikat-Prüfung
      const ownedCopies = catalogCard ? await getCardsByTcgId(catalogCard.id) : [];

      const variantMap: Record<string, CardVariant> = {
        holo: 'holo', reverse: 'reverse', 'alt-art': 'alt-art', promo: 'promo', standard: 'standard',
      };

      const result: ScanState = {
        card: catalogCard ? catalogCardToInfo(catalogCard) : (dexCandidates?.[0] ?? null),
        candidates: dexCandidates,
        language: (gemini.language ?? 'de') as CardLanguage,
        confidence: gemini.confidence ?? 'low',
        variant: variantMap[gemini.variant ?? ''] ?? 'standard',
        ownedCount: ownedCopies.length,
        error: catalogCard
          ? undefined
          : dexCandidates
            ? `Exakte Karte nicht gefunden — ${dexCandidates.length} Karten dieses Pokémons`
            : `Karte ${gemini.setId} #${rawNumber} nicht im Katalog`,
      };

      setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'done', result } : j));
    } catch (err) {
      console.error('Scan error:', err);
      setJobs(prev => prev.map(j => j.id === id ? {
        ...j, status: 'error',
        result: { card: null, language: 'de', confidence: 'low', error: 'Verbindungsfehler' },
      } : j));
    }
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 bg-black">
        <button
          onClick={() => router.back()}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10"
        >
          <ArrowLeft size={18} color="#fff" />
        </button>
        <h1 className="text-base font-semibold text-white">Karte scannen</h1>
        <button
          onClick={() => setIsPaused(p => !p)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
          style={{
            background: isPaused ? 'rgba(72,187,120,.2)' : 'rgba(255,255,255,.1)',
            color: isPaused ? '#48bb78' : '#fff',
          }}
        >
          {isPaused
            ? <><Play size={14} /> Weiter</>
            : <><Pause size={14} /> Pause</>}
        </button>
      </div>

      {/* Kamera */}
      <div className="flex-1 flex flex-col px-4 pb-2 min-h-0">
        <CameraCapture onCapture={handleCapture} pendingCount={pendingCount} paused={isPaused} />
      </div>

      {/* Scan-Slider */}
      {jobs.length > 0 && (
        <div className="px-4 pb-4 pt-1">
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {jobs.map(job => {
              const img = thumbUrl(job);
              const isSelected = job.id === selectedJobId;
              return (
                <div
                  key={job.id}
                  className="relative shrink-0 rounded-xl overflow-hidden cursor-pointer"
                  style={{
                    width: 54, height: 76,
                    border: `2px solid ${isSelected ? 'var(--pokedex-red)' : 'rgba(255,255,255,0.2)'}`,
                    background: '#1a1a1a',
                  }}
                  onClick={() => job.status !== 'processing' && setSelectedJobId(job.id)}
                >
                  {job.status === 'processing' ? (
                    <div className="w-full h-full flex items-center justify-center">
                      <Loader2 size={18} color="rgba(255,255,255,0.5)" className="animate-spin" />
                    </div>
                  ) : job.status === 'error' || !img ? (
                    <div className="w-full h-full flex items-center justify-center bg-red-500/20">
                      <AlertCircle size={18} color="#f87171" />
                    </div>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  )}

                  {/* Bereits-vorhanden-Badge */}
                  {job.result?.ownedCount ? (
                    <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded"
                      style={{ background: 'rgba(72,187,120,.85)', color: '#fff' }}>
                      ×{job.result.ownedCount}
                    </span>
                  ) : null}

                  {/* Trash-Button */}
                  <button
                    onClick={e => { e.stopPropagation(); removeJob(job.id); }}
                    className="absolute bottom-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(0,0,0,0.7)' }}
                  >
                    <Trash2 size={10} color="#fff" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ergebnis-Sheet */}
      {selectedJob?.result && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setSelectedJobId(null)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-card rounded-t-2xl shadow-2xl max-h-[80vh] overflow-y-auto">
            <CardScanResult
              card={selectedJob.result.card}
              candidates={selectedJob.result.candidates}
              language={selectedJob.result.language}
              confidence={selectedJob.result.confidence}
              preVariant={selectedJob.result.variant}
              ownedCount={selectedJob.result.ownedCount}
              error={selectedJob.result.error}
              onRetry={() => setSelectedJobId(null)}
              onManualSearch={() => router.push('/collection')}
            />
          </div>
        </>
      )}
    </div>
  );
}
