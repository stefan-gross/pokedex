'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, RefreshCw, Layers, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CaptureMeta } from '@/components/scanner/CameraCapture';

/**
 * Testmodus-Panel — spielt gespeicherte Scans (Firestore `scan_cases`, via
 * Admin-Route) erneut durch DIESELBE Pipeline wie der echte Scanner, ganz OHNE
 * Kamera. So lassen sich Mehrfach- und Einzelscan (Erkennung, Auflösung, Slider,
 * Review, Bulk-Add) reproduzierbar testen — auf Desktop wie am Handy.
 *
 * Einspeisung = Aufruf von `onRecognize` (= `handleCapture` der Seite) mit
 * `meta.trigger:'test'`. Der Modus (Einzel/Mehrfach) richtet sich nach dem
 * aktuell gewählten Scan-Modus der Seite; Telemetrie/Statistik werden bei
 * Test-Trigger bewusst NICHT geschrieben (kein Korpus-/Stats-Rauschen).
 *
 * Datenquelle sind Fehler-/Meldefälle (auto_fail / wrong / not_in_catalog) —
 * also gezielt schwierige Karten. Grundwahrheit (`correctedCardId`) wird, wo
 * vorhanden, angezeigt, damit man die Auflösung dagegen prüfen kann.
 */

interface ScanCase {
  id: string;
  reportType?: string;
  warpedCropBase64?: string;
  originalFrameBase64?: string;
  mimeType?: string;
  correctedCardId?: string;
  gemini?: { name?: string; setCode?: string | null; number?: string | null; nationalDexNumber?: number | null };
}

interface Props {
  onClose: () => void;
  onRecognize: (imageBase64: string, mimeType: string, meta: CaptureMeta) => void;
  /** Aktueller Scan-Modus der Seite — nur zur Anzeige (die Seite entscheidet). */
  scanMode: 'add' | 'recognize';
}

const REPORT_LABEL: Record<string, string> = {
  auto_fail: 'Auto-Fehlschlag',
  wrong: 'Falsch erkannt',
  not_in_catalog: 'Nicht im Katalog',
};

/** Synthetisches CaptureMeta für die Einspeisung — `trigger:'test'` schaltet in
 *  `handleCapture` die Telemetrie ab. Qualitätswerte neutral (kein echtes
 *  Kamerabild). `originalFrameBase64` bewusst NICHT gesetzt (würde nur bei
 *  echter Fehler-Telemetrie gebraucht, die im Test ohnehin aus ist). */
function testMeta(): CaptureMeta {
  return {
    trigger: 'test', level: 'test', reason: 'Testmodus',
    boxDelta: 0, sharpness: 0, contrast: 0, glare: 0, softGlare: 0,
    nameGlare: 0, codeGlare: 0, meanLum: 0, fill: 1, cornersN: 4, angleDeg: 0,
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function ScanTestPanel({ onClose, onRecognize, scanMode }: Props) {
  const [cases, setCases] = useState<ScanCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setError(null); setCases(null);
    try {
      const r = await fetch('/api/admin/scan-cases?withImages=1&limit=500');
      if (r.status === 401) { setError('Nur für Admins (Anmeldung erforderlich).'); setCases([]); return; }
      const j = await r.json();
      const withImg = (j.cases as ScanCase[]).filter(c => c.warpedCropBase64 || c.originalFrameBase64);
      setCases(withImg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCases([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const feed = useCallback((c: ScanCase) => {
    const img = c.warpedCropBase64 || c.originalFrameBase64;
    if (img) onRecognize(img, c.mimeType || 'image/jpeg', testMeta());
  }, [onRecognize]);

  const feedAll = useCallback(async () => {
    if (!cases?.length) return;
    setSending(true);
    // Sequenziell mit kleiner Pause — mimt den echten Stapel-Scan und lässt die
    // Upload-Queue/den Slider zwischen den Karten aktualisieren.
    for (const c of cases) { feed(c); await sleep(300); }
    setSending(false);
  }, [cases, feed]);

  return (
    <div className="fixed inset-0 z-[500] bg-black/95 flex flex-col text-white"
         style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* Kopf */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 shrink-0">
        <span className="font-semibold">Testmodus</span>
        <span className="text-role-label text-white/50 flex items-center gap-1">
          {scanMode === 'add' ? <><Layers size={13} /> Mehrfachscan</> : <><Square size={13} /> Einzelscan</>}
        </span>
        <button type="button" onClick={() => void load()} aria-label="Neu laden"
                className="ml-auto p-2 text-white/70 active:text-white"><RefreshCw size={18} /></button>
        <button type="button" onClick={onClose} aria-label="Schließen"
                className="p-2 text-white/70 active:text-white"><X size={20} /></button>
      </div>

      {/* Aktionen */}
      <div className="px-4 py-3 border-b border-white/10 shrink-0 flex items-center gap-3">
        <Button size="sm" onClick={() => void feedAll()} disabled={sending || !cases?.length}>
          {sending ? 'Speise ein …' : `Alle einspeisen (${cases?.length ?? 0})`}
        </Button>
        <p className="text-role-label text-white/50">
          {scanMode === 'add'
            ? 'Landen im Stapel-Slider — danach „Alle hinzufügen" testen.'
            : 'Einzeln: erst auf Mehrfachscan umschalten für den Stapeltest.'}
        </p>
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {error && <p className="text-role-label text-red-300">{error}</p>}
        {!cases && !error && <p className="text-role-label text-white/50">Lade Testfälle …</p>}
        {cases?.length === 0 && !error && <p className="text-role-label text-white/50">Keine gespeicherten Testfälle mit Bild.</p>}
        <div className="grid grid-cols-3 gap-2">
          {cases?.map(c => {
            const img = c.warpedCropBase64 || c.originalFrameBase64;
            return (
              <button key={c.id} type="button" onClick={() => feed(c)}
                      className="flex flex-col gap-1 rounded-xl overflow-hidden bg-white/5 active:bg-white/15 text-left p-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:${c.mimeType || 'image/jpeg'};base64,${img}`} alt=""
                     className="w-full aspect-[3/4] object-cover rounded-lg" />
                <span className="text-[10px] leading-tight text-white/70 px-0.5 truncate">
                  {REPORT_LABEL[c.reportType ?? ''] ?? c.reportType}
                </span>
                <span className="text-[10px] leading-tight text-white/50 px-0.5 truncate">
                  {c.gemini?.name ?? '—'}{c.correctedCardId ? ` → ${c.correctedCardId}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
