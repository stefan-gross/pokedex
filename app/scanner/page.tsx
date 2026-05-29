'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CameraCapture } from '@/components/scanner/CameraCapture';
import { CardScanResult } from '@/components/scanner/CardScanResult';
import type { TcgApiCard } from '@/lib/pokemon-tcg';

type Phase = 'camera' | 'result';

interface ScanResult {
  name?: string;
  setName?: string;
  number?: string;
  confidence?: 'high' | 'medium' | 'low';
  isHolo?: boolean;
  isReverse?: boolean;
  error?: string;
}

export default function ScannerPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('camera');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [candidates, setCandidates] = useState<TcgApiCard[]>([]);

  const handleCapture = async (imageBase64: string, mimeType: string) => {
    setScanning(true);
    try {
      // 1. Gemini Vision: identify card
      const scanRes = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType }),
      });
      const result: ScanResult = await scanRes.json();
      setScanResult(result);

      // 2. pokemontcg.io: find matching cards
      if (result.name && !result.error) {
        const query = [
          `name:"${result.name}"`,
          result.setName ? `set.name:"${result.setName}"` : '',
        ].filter(Boolean).join(' ');

        const tcgRes = await fetch(`/api/tcg?q=${encodeURIComponent(query)}&pageSize=10`);
        const tcgData = await tcgRes.json();
        setCandidates(tcgData.data ?? []);
      }

      setPhase('result');
    } catch (err) {
      console.error('Scan error:', err);
      setScanResult({ error: 'Fehler beim Scannen' });
      setPhase('result');
    } finally {
      setScanning(false);
    }
  };

  const handleRetry = () => {
    setScanResult(null);
    setCandidates([]);
    setPhase('camera');
  };

  const handleManualSearch = (query: string) => {
    router.push(`/collection?q=${encodeURIComponent(query)}`);
  };

  return (
    <div className="flex flex-col min-h-screen bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-12 pb-3 bg-black">
        <h1 className="text-base font-semibold text-white">Karte scannen</h1>
        <button
          onClick={() => router.back()}
          className="text-sm px-3 py-1.5 rounded-lg bg-white/10 text-white"
        >
          Fertig
        </button>
      </div>

      {phase === 'camera' ? (
        <div className="flex-1 flex flex-col px-4 pb-6 gap-4">
          <CameraCapture onCapture={handleCapture} scanning={scanning} />
          <p className="text-center text-xs text-white/50">
            Halte die Karte in den Rahmen und tippe den Auslöser
          </p>
        </div>
      ) : (
        <div className="flex-1 bg-card rounded-t-2xl mt-2 overflow-y-auto">
          {scanResult && (
            <CardScanResult
              result={scanResult}
              candidates={candidates}
              onRetry={handleRetry}
              onManualSearch={handleManualSearch}
            />
          )}
        </div>
      )}
    </div>
  );
}
