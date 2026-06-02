'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Zap, ZapOff, RefreshCw } from 'lucide-react';

interface Props {
  onCapture: (imageBase64: string, mimeType: string) => void;
  scanning: boolean;
}

// Guide-Frame-Größe (muss mit dem gerenderten Rahmen übereinstimmen)
const FRAME_W = 190;
const FRAME_H = 266;

// Stabilitätsschwelle: mittlerer quadratischer Pixelfehler (0–255²)
// Höher = toleranter gegenüber Handbewegungen
// 15 = sehr streng, 40 = normal, 80 = locker
const MSE_THRESHOLD = 40;

// Zeit in ms, die die Karte stabil sein muss, bevor automatisch ausgelöst wird
const STABLE_DURATION_MS = 800;

// Überprüfungsintervall
const CHECK_INTERVAL_MS = 150;

// Rechteck-Perimeter für den SVG-Fortschrittsring (2*(W+H) + Rundungen)
// Rect 190×266 mit rx=12: gerade Seiten + 4 Viertelkreise mit r=12
const RECT_PERIMETER = 2 * (FRAME_W - 2 * 12 + FRAME_H - 2 * 12) + 2 * Math.PI * 12;

export function CameraCapture({ onCapture, scanning }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);       // für den finalen Snapshot
  const sampleRef   = useRef<HTMLCanvasElement>(null);       // aktuelles Sample
  const prevRef     = useRef<HTMLCanvasElement>(null);       // vorheriges Sample
  const streamRef   = useRef<MediaStream | null>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const stableSince = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torch,      setTorch]      = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [progress,   setProgress]   = useState(0); // 0..1 für Ring-Animation

  // ── Kamera starten ──────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setError('Kamera konnte nicht gestartet werden. Bitte Zugriff erlauben.');
    }
  }, [facingMode]);

  useEffect(() => {
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startCamera]);

  // ── Foto auslösen ────────────────────────────────────────────────────────
  const doCapture = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
    onCapture(base64, 'image/jpeg');
    stableSince.current = null;
    setProgress(0);
  }, [onCapture]);

  // ── Stabilitäts-Loop ─────────────────────────────────────────────────────
  useEffect(() => {
    if (scanning) {
      if (timerRef.current) clearInterval(timerRef.current);
      setProgress(0);
      stableSince.current = null;
      return;
    }

    timerRef.current = setInterval(() => {
      const video   = videoRef.current;
      const sample  = sampleRef.current;
      const prev    = prevRef.current;
      if (!video || !sample || !prev || video.readyState < 2) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;

      // Rahmen-Bereich aus dem Video extrahieren (zentriert)
      const sx = Math.max(0, (vw - FRAME_W) / 2);
      const sy = Math.max(0, (vh - FRAME_H) / 2);

      const sCtx = sample.getContext('2d')!;
      sCtx.drawImage(video, sx, sy, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);

      const pCtx = prev.getContext('2d')!;
      const pData = pCtx.getImageData(0, 0, FRAME_W, FRAME_H).data;
      const sData = sCtx.getImageData(0, 0, FRAME_W, FRAME_H).data;

      // MSE über jeden 4. Pixel (R-Kanal reicht)
      let mse = 0;
      let count = 0;
      for (let i = 0; i < sData.length; i += 16) {
        const diff = sData[i] - pData[i];
        mse += diff * diff;
        count++;
      }
      mse = count > 0 ? mse / count : 999;

      const isStable = mse < MSE_THRESHOLD;

      if (isStable) {
        if (stableSince.current === null) stableSince.current = Date.now();
        const elapsed = Date.now() - stableSince.current;
        setProgress(Math.min(elapsed / STABLE_DURATION_MS, 1));
        if (elapsed >= STABLE_DURATION_MS) {
          doCapture();
        }
      } else {
        stableSince.current = null;
        setProgress(0);
      }

      // aktuelles Sample wird zum vorherigen
      pCtx.drawImage(sample, 0, 0);
    }, CHECK_INTERVAL_MS);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [scanning, doCapture]);

  // ── Torch ────────────────────────────────────────────────────────────────
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(t => !t);
    } catch { /* nicht unterstützt */ }
  };

  // Ring-Animation: SVG stroke-dashoffset entlang Rechteck-Perimeter
  const strokeDash = RECT_PERIMETER - progress * RECT_PERIMETER;

  return (
    <div className="relative w-full flex flex-col items-center">
      {/* Versteckte Canvas-Elemente */}
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={sampleRef} width={FRAME_W} height={FRAME_H} className="hidden" />
      <canvas ref={prevRef}   width={FRAME_W} height={FRAME_H} className="hidden" />

      {error ? (
        <div className="w-full aspect-[3/4] bg-black rounded-2xl flex items-center justify-center text-center px-6">
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : (
        <div className="relative w-full aspect-[3/4] bg-black rounded-2xl overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Card guide frame mit Ring-Animation */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative" style={{ width: FRAME_W, height: FRAME_H }}>
              {/* Grüner Rahmen */}
              <div
                className="absolute inset-0"
                style={{
                  border: '2.5px solid',
                  borderColor: progress > 0 ? '#48bb78' : 'rgba(255,255,255,0.4)',
                  borderRadius: 12,
                  transition: 'border-color 0.2s',
                }}
              />
              {/* Ecken-Marks */}
              {['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0'].map((pos, i) => (
                <div
                  key={i}
                  className={`absolute w-4 h-4 ${pos}`}
                  style={{
                    borderColor: progress > 0 ? '#48bb78' : 'rgba(255,255,255,0.6)',
                    borderStyle: 'solid',
                    borderWidth: 0,
                    transition: 'border-color 0.2s',
                    ...(i === 0 && { borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 }),
                    ...(i === 1 && { borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 }),
                    ...(i === 2 && { borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 }),
                    ...(i === 3 && { borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 }),
                  }}
                />
              ))}

              {/* Fortschrittsring (SVG, überlagert den Rahmen) */}
              {progress > 0 && (
                <svg
                  className="absolute inset-0 w-full h-full"
                  viewBox={`0 0 ${FRAME_W} ${FRAME_H}`}
                  style={{ transform: 'rotate(-90deg)' }}
                >
                  <rect
                    x={1} y={1}
                    width={FRAME_W - 2} height={FRAME_H - 2}
                    rx={12} ry={12}
                    fill="none"
                    stroke="#48bb78"
                    strokeWidth={3}
                    strokeDasharray={RECT_PERIMETER}
                    strokeDashoffset={strokeDash}
                    style={{ transition: `stroke-dashoffset ${CHECK_INTERVAL_MS}ms linear` }}
                  />
                </svg>
              )}
            </div>
          </div>

          {/* Scanning-Overlay */}
          {scanning && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="text-center">
                <div className="w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-white text-sm font-medium">Erkenne Karte…</p>
              </div>
            </div>
          )}

          {/* Top-Controls */}
          <div className="absolute top-3 right-3 flex flex-col gap-2">
            <button
              onClick={toggleTorch}
              className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center"
            >
              {torch ? <Zap size={16} color="#facc15" /> : <ZapOff size={16} color="#fff" />}
            </button>
            <button
              onClick={() => setFacingMode(m => m === 'environment' ? 'user' : 'environment')}
              className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center"
            >
              <RefreshCw size={16} color="#fff" />
            </button>
          </div>
        </div>
      )}

      {/* Statuszeile unter dem Viewfinder */}
      <p className="mt-3 text-xs text-white/50 text-center">
        {scanning
          ? 'Analysiere…'
          : progress > 0
            ? `Karte erkannt — halte ruhig…`
            : 'Halte die Karte in den Rahmen'}
      </p>
    </div>
  );
}
