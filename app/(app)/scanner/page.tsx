'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CameraCapture } from '@/components/scanner/CameraCapture';
import { CardScanResult } from '@/components/scanner/CardScanResult';
import { getCardBySetAndNumber } from '@/lib/firestore/catalog';
import { catalogCardToInfo } from '@/lib/card-info';
import type { CardInfo } from '@/lib/card-info';
import type { CardLanguage } from '@/types';

type Phase = 'camera' | 'result';

interface GeminiResponse {
  setId?: string;
  number?: string;
  language?: string;
  confidence?: string;
  error?: string;
}

interface ScanState {
  card: CardInfo | null;
  language: CardLanguage;
  confidence: string;
  error?: string;
}

export default function ScannerPage() {
  const router = useRouter();
  const [phase,    setPhase]    = useState<Phase>('camera');
  const [scanning, setScanning] = useState(false);
  const [result,   setResult]   = useState<ScanState | null>(null);

  const handleCapture = async (imageBase64: string, mimeType: string) => {
    setScanning(true);
    try {
      // 1. Gemini: setId + number + language erkennen
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType }),
      });
      const gemini: GeminiResponse = await res.json();

      if (gemini.error || !gemini.setId || !gemini.number) {
        setResult({
          card: null,
          language: 'de',
          confidence: 'low',
          error: gemini.error ?? 'Karte konnte nicht erkannt werden',
        });
        setPhase('result');
        return;
      }

      // 2. Firestore-Lookup (Client SDK — kein Admin nötig)
      const catalogCard = await getCardBySetAndNumber(gemini.setId, gemini.number);

      setResult({
        card: catalogCard ? catalogCardToInfo(catalogCard) : null,
        language: (gemini.language ?? 'de') as CardLanguage,
        confidence: gemini.confidence ?? 'low',
        error: catalogCard
          ? undefined
          : `Karte ${gemini.setId} #${gemini.number} nicht im Katalog`,
      });
      setPhase('result');
    } catch (err) {
      console.error('Scan error:', err);
      setResult({ card: null, language: 'de', confidence: 'low', error: 'Verbindungsfehler' });
      setPhase('result');
    } finally {
      setScanning(false);
    }
  };

  const handleRetry = () => {
    setResult(null);
    setPhase('camera');
  };

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

      {phase === 'camera' ? (
        <div className="flex-1 flex flex-col px-4 pb-6">
          <CameraCapture onCapture={handleCapture} scanning={scanning} />
        </div>
      ) : (
        <div className="flex-1 bg-card rounded-t-2xl mt-2 overflow-y-auto">
          {result && (
            <CardScanResult
              card={result.card}
              language={result.language}
              confidence={result.confidence}
              error={result.error}
              onRetry={handleRetry}
              onManualSearch={() => router.push('/collection')}
            />
          )}
        </div>
      )}
    </div>
  );
}
