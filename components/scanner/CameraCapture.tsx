'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Zap, ZapOff, RefreshCw } from 'lucide-react';

interface Props {
  onCapture: (imageBase64: string, mimeType: string) => void;
  scanning: boolean;
}

const FRAME_W = 190;
const FRAME_H = 266;

// Countdown bis zum Auto-Snap (ms)
const AUTO_SNAP_DELAY = 2000;
// Check-Intervall
const CHECK_MS = 100;
// MSE-Schwelle für "starke Bewegung" → Timer-Reset (hoch, da Kamera-Noise ignoriert werden soll)
const MOTION_RESET_THRESHOLD = 400;

// Perimeter des gerundeten Rechtecks für SVG-Fortschrittsring
const RECT_PERIMETER = 2 * (FRAME_W - 2 * 12 + FRAME_H - 2 * 12) + 2 * Math.PI * 12;

export function CameraCapture({ onCapture, scanning }: Props) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const sampleRef    = useRef<HTMLCanvasElement>(null);
  const prevRef      = useRef<HTMLCanvasElement>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<number>(0);       // ms seit letztem Motion-Reset
  const onCaptureRef = useRef(onCapture);

  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torch,      setTorch]      = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [progress,   setProgress]   = useState(0); // 0..1

  // ── Kamera starten ──────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    setError(null);
    countdownRef.current = 0;
    setProgress(0);
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
    if (!video || !canvas || video.readyState < 2) return;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
    onCaptureRef.current(base64, 'image/jpeg');
    countdownRef.current = 0;
    setProgress(0);
  }, []);

  // ── Countdown-Loop ───────────────────────────────────────────────────────
  useEffect(() => {
    if (scanning) {
      if (timerRef.current) clearInterval(timerRef.current);
      countdownRef.current = 0;
      setProgress(0);
      return;
    }

    // Kurze Pause nach Kamera-Start (Video muss bereit sein)
    const startDelay = setTimeout(() => {
      timerRef.current = setInterval(() => {
        const video  = videoRef.current;
        const sample = sampleRef.current;
        const prev   = prevRef.current;
        if (!video || !sample || !prev || video.readyState < 2) return;

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return;

        // Bewegungsmessung: kleinen Bereich in der Mitte samplen
        const cropW = Math.min(FRAME_W, vw);
        const cropH = Math.min(FRAME_H, vh);
        const sx = Math.max(0, (vw - cropW) / 2);
        const sy = Math.max(0, (vh - cropH) / 2);

        const sCtx = sample.getContext('2d')!;
        sCtx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

        const pCtx = prev.getContext('2d')!;
        const pData = pCtx.getImageData(0, 0, cropW, cropH).data;
        const sData = sCtx.getImageData(0, 0, cropW, cropH).data;

        // MSE (jeder 8. Pixel, R-Kanal) — nur starke Bewegung zählt
        let mse = 0, count = 0;
        for (let i = 0; i < sData.length; i += 32) {
          const d = sData[i] - pData[i];
          mse += d * d;
          count++;
        }
        mse = count > 0 ? mse / count : 0;

        // prev = current sample
        pCtx.drawImage(sample, 0, 0);

        if (mse > MOTION_RESET_THRESHOLD) {
          // Starke Bewegung → Timer zurücksetzen
          countdownRef.current = 0;
          setProgress(0);
        } else {
          // Ruhig (oder Kamera-Noise) → hochzählen
          countdownRef.current += CHECK_MS;
          const p = Math.min(countdownRef.current / AUTO_SNAP_DELAY, 1);
          setProgress(p);
          if (countdownRef.current >= AUTO_SNAP_DELAY) {
            doCapture();
          }
        }
      }, CHECK_MS);
    }, 800); // 800ms warten bis Video stabil läuft

    return () => {
      clearTimeout(startDelay);
      if (timerRef.current) clearInterval(timerRef.current);
    };
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

  const strokeDash = RECT_PERIMETER - progress * RECT_PERIMETER;

  return (
    <div className="relative w-full flex flex-col items-center">
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={sampleRef} width={FRAME_W} height={FRAME_H} className="hidden" />
      <canvas ref={prevRef}   width={FRAME_W} height={FRAME_H} className="hidden" />

      {error ? (
        <div className="w-full aspect-[3/4] bg-black rounded-2xl flex items-center justify-center text-center px-6">
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : (
        /* Viewfinder — Tippen löst sofort aus */
        <div
          className="relative w-full aspect-[3/4] bg-black rounded-2xl overflow-hidden"
          onClick={!scanning ? doCapture : undefined}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Card guide frame */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative" style={{ width: FRAME_W, height: FRAME_H }}>
              <div
                className="absolute inset-0"
                style={{
                  border: '2.5px solid',
                  borderColor: progress > 0.05 ? '#48bb78' : 'rgba(255,255,255,0.4)',
                  borderRadius: 12,
                  transition: 'border-color 0.3s',
                }}
              />
              {['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0'].map((pos, i) => (
                <div
                  key={i}
                  className={`absolute w-4 h-4 ${pos}`}
                  style={{
                    borderColor: progress > 0.05 ? '#48bb78' : 'rgba(255,255,255,0.6)',
                    borderStyle: 'solid',
                    borderWidth: 0,
                    transition: 'border-color 0.3s',
                    ...(i === 0 && { borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 }),
                    ...(i === 1 && { borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 }),
                    ...(i === 2 && { borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 }),
                    ...(i === 3 && { borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 }),
                  }}
                />
              ))}

              {/* Fortschrittsring */}
              {progress > 0.05 && (
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
                    style={{ transition: `stroke-dashoffset ${CHECK_MS}ms linear` }}
                  />
                </svg>
              )}
            </div>
          </div>

          {/* Scanning overlay */}
          {scanning && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="text-center">
                <div className="w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-white text-sm font-medium">Erkenne Karte…</p>
              </div>
            </div>
          )}

          {/* Top controls */}
          <div className="absolute top-3 right-3 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
            <button onClick={toggleTorch} className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center">
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

      <p className="mt-3 text-xs text-white/50 text-center">
        {scanning
          ? 'Analysiere…'
          : progress > 0.05
            ? 'Halte ruhig — oder tippen zum sofortigen Auslösen'
            : 'Karte in den Rahmen halten — oder tippen'}
      </p>
    </div>
  );
}
