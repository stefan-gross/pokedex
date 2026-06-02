'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CameraCapture } from '@/components/scanner/CameraCapture';
import { CardScanResult } from '@/components/scanner/CardScanResult';
import type { CardInfo } from '@/lib/card-info';
import type { CardLanguage } from '@/types';

type Phase = 'camera' | 'result';

interface ScanResponse {
  card?: CardInfo;
  language?: CardLanguage;
  confidence?: string;
  error?: string;
}

export default function ScannerPage() {
  const router = useRouter();
  const [phase,    setPhase]    = useState<Phase>('camera');
  const [scanning, setScanning] = useState(false);
  const [response, setResponse] = useState<ScanResponse | null>(null);

  const handleCapture = async (imageBase64: string, mimeType: string) => {
    setScanning(true);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType }),
      });
      const data: ScanResponse = await res.json();
      setResponse(data);
      setPhase('result');
    } catch {
      setResponse({ error: 'Verbindungsfehler beim Scannen' });
      setPhase('result');
    } finally {
      setScanning(false);
    }
  };

  const handleRetry = () => {
    setResponse(null);
    setPhase('camera');
  };

  return (
    <div className="flex flex-col min-h-screen bg-black">
      {/* Header */}
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
          {response && (
            <CardScanResult
              card={response.card ?? null}
              language={response.language ?? 'de'}
              confidence={response.confidence ?? 'low'}
              error={response.error}
              onRetry={handleRetry}
              onManualSearch={() => router.push('/collection')}
            />
          )}
        </div>
      )}
    </div>
  );
}
