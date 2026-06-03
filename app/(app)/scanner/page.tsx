'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CameraCapture } from '@/components/scanner/CameraCapture';
import { CardScanResult } from '@/components/scanner/CardScanResult';
import { getCardBySetAndNumber, getCardsByDexNumber } from '@/lib/firestore/catalog';
import { catalogCardToInfo } from '@/lib/card-info';
import type { CardInfo } from '@/lib/card-info';
import type { CardLanguage } from '@/types';

type Phase = 'camera' | 'result';

interface GeminiResponse {
  setId?: string;
  number?: string;
  language?: string;
  confidence?: string;
  nationalDexNumber?: number | null;
  error?: string;
}

interface ScanState {
  card: CardInfo | null;
  candidates?: CardInfo[] | null;
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

      // Nummer normalisieren: "049/198" → "049" (Sicherheitsnetz falls Gemini trotzdem Slash zurückgibt)
      const rawNumber = gemini.number.includes('/')
        ? gemini.number.split('/')[0]
        : gemini.number;

      // 2. Firestore-Lookup: setId + number
      let catalogCard = await getCardBySetAndNumber(gemini.setId, rawNumber);

      // 3. Fallback: Nummer ohne führende Nullen / mit führenden Nullen probieren
      if (!catalogCard) {
        const altNumber = /^\d+$/.test(rawNumber)
          ? String(parseInt(rawNumber, 10))      // "049" → "49"
          : rawNumber.padStart(3, '0');           // "49" → "049"
        if (altNumber !== rawNumber) {
          catalogCard = await getCardBySetAndNumber(gemini.setId, altNumber);
        }
      }

      // 4. Fallback: Pokédex-Nummer (zeigt alle Karten des Pokémons)
      let dexCandidates: CardInfo[] | null = null;
      if (!catalogCard && gemini.nationalDexNumber) {
        const dexCards = await getCardsByDexNumber(gemini.nationalDexNumber, 20);
        if (dexCards.length > 0) {
          dexCandidates = dexCards.map(catalogCardToInfo);
        }
      }

      setResult({
        card: catalogCard ? catalogCardToInfo(catalogCard) : (dexCandidates?.[0] ?? null),
        candidates: dexCandidates,
        language: (gemini.language ?? 'de') as CardLanguage,
        confidence: gemini.confidence ?? 'low',
        error: catalogCard
          ? undefined
          : dexCandidates
            ? `Exakte Karte nicht gefunden — ${dexCandidates.length} Karten dieses Pokémons`
            : `Karte ${gemini.setId} #${rawNumber} nicht im Katalog`,
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
              candidates={result.candidates}
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
