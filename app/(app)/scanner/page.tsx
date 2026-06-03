'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CameraCapture } from '@/components/scanner/CameraCapture';
import { CardScanResult } from '@/components/scanner/CardScanResult';
import { getCardBySetAndNumber, getCardsByDexNumber } from '@/lib/firestore/catalog';
import { catalogCardToInfo } from '@/lib/card-info';
import type { CardInfo } from '@/lib/card-info';
import type { CardLanguage } from '@/types';
import type { CardVariant } from '@/types';

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
  error?: string;
}

interface ScanJob {
  id: string;
  status: 'processing' | 'done' | 'error';
  result: ScanState | null;
}

export default function ScannerPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ScanJob[]>([]);

  // Erstes fertiges Job anzeigen
  const activeJob = jobs.find(j => j.status === 'done' || j.status === 'error') ?? null;
  const pendingCount = jobs.filter(j => j.status === 'processing').length;

  const dismissJob = useCallback((id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id));
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
          result: { card: null, language: 'de', confidence: 'low', error: gemini.error ?? 'Karte konnte nicht erkannt werden' },
        } : j));
        return;
      }

      const rawNumber = gemini.number.includes('/') ? gemini.number.split('/')[0] : gemini.number;

      // Firestore-Lookup: setId + number
      let catalogCard = await getCardBySetAndNumber(gemini.setId, rawNumber);

      // Fallback: führende Nullen variieren
      if (!catalogCard) {
        const alt = /^\d+$/.test(rawNumber)
          ? String(parseInt(rawNumber, 10))
          : rawNumber.padStart(3, '0');
        if (alt !== rawNumber) catalogCard = await getCardBySetAndNumber(gemini.setId, alt);
      }

      // Fallback: Pokédex-Nummer
      let dexCandidates: CardInfo[] | null = null;
      if (!catalogCard && gemini.nationalDexNumber) {
        const dexCards = await getCardsByDexNumber(gemini.nationalDexNumber, 20);
        if (dexCards.length > 0) dexCandidates = dexCards.map(catalogCardToInfo);
      }

      // Gemini-Variante normalisieren
      const variantMap: Record<string, CardVariant> = {
        holo: 'holo', reverse: 'reverse', 'alt-art': 'alt-art', promo: 'promo', standard: 'standard',
      };
      const variant: CardVariant = variantMap[gemini.variant ?? ''] ?? 'standard';

      const result: ScanState = {
        card: catalogCard ? catalogCardToInfo(catalogCard) : (dexCandidates?.[0] ?? null),
        candidates: dexCandidates,
        language: (gemini.language ?? 'de') as CardLanguage,
        confidence: gemini.confidence ?? 'low',
        variant,
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
      <div className="flex items-center justify-between px-4 pt-4 pb-3 bg-black">
        <h1 className="text-base font-semibold text-white">Karte scannen</h1>
        <button
          onClick={() => router.back()}
          className="text-sm px-3 py-1.5 rounded-lg bg-white/10 text-white"
        >
          Fertig
        </button>
      </div>

      {/* Kamera immer sichtbar */}
      <div className="flex-1 flex flex-col px-4 pb-6">
        <CameraCapture onCapture={handleCapture} pendingCount={pendingCount} />
      </div>

      {/* Ergebnis als Overlay-Sheet */}
      {activeJob?.result && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => dismissJob(activeJob.id)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-card rounded-t-2xl shadow-2xl max-h-[80vh] overflow-y-auto">
            <CardScanResult
              card={activeJob.result.card}
              candidates={activeJob.result.candidates}
              language={activeJob.result.language}
              confidence={activeJob.result.confidence}
              preVariant={activeJob.result.variant}
              error={activeJob.result.error}
              onRetry={() => dismissJob(activeJob.id)}
              onManualSearch={() => router.push('/collection')}
            />
          </div>
        </>
      )}
    </div>
  );
}
