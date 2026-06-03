'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Zap, ZapOff, RefreshCw, Loader2 } from 'lucide-react';

interface Props {
  onCapture: (imageBase64: string, mimeType: string) => void;
  pendingCount?: number; // laufende Scans im Hintergrund
}

const FRAME_W = 190;
const FRAME_H = 266;

const CHECK_MS = 100;
const MOTION_RESET_THRESHOLD = 800;
const CARD_DETECT_VARIANCE = 600;
const SNAP_STABLE_FRAMES = 1;
const SNAP_COOLDOWN_MS = 2000; // nach einem Snap: 2s keine Auto-Erkennung

export function CameraCapture({ onCapture, pendingCount = 0 }: Props) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const sampleRef    = useRef<HTMLCanvasElement>(null);
  const prevRef      = useRef<HTMLCanvasElement>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stableFramesRef = useRef<number>(0);
  const cooldownRef  = useRef<boolean>(false);   // kurz nach Snap: kein Auto-Snap
  const onCaptureRef = useRef(onCapture);

  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  const [facingMode,   setFacingMode]   = useState<'environment' | 'user'>('environment');
  const [torch,        setTorch]        = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [progress,     setProgress]     = useState(0);
  const [cardDetected, setCardDetected] = useState(false);
  const [inCooldown,   setInCooldown]   = useState(false);

  // ── Kamera starten ──────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    setError(null);
    stableFramesRef.current = 0;
    setProgress(0);
    setCardDetected(false);
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
    if (cooldownRef.current) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
    onCaptureRef.current(base64, 'image/jpeg');
    // Cooldown: frame zurücksetzen, 2s keine Auto-Erkennung
    stableFramesRef.current = 0;
    setProgress(0);
    setCardDetected(false);
    cooldownRef.current = true;
    setInCooldown(true);
    setTimeout(() => {
      cooldownRef.current = false;
      setInCooldown(false);
    }, SNAP_COOLDOWN_MS);
  }, []);

  // ── Detection-Loop ────────────────────────────────────────────────────────
  useEffect(() => {
    const startDelay = setTimeout(() => {
      timerRef.current = setInterval(() => {
        const video  = videoRef.current;
        const sample = sampleRef.current;
        const prev   = prevRef.current;
        if (!video || !sample || !prev || video.readyState < 2) return;

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return;

        const cropW = Math.min(FRAME_W, vw);
        const cropH = Math.min(FRAME_H, vh);
        const sx = Math.max(0, (vw - cropW) / 2);
        const sy = Math.max(0, (vh - cropH) / 2);

        const sCtx = sample.getContext('2d')!;
        sCtx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

        const pCtx = prev.getContext('2d')!;
        const pData = pCtx.getImageData(0, 0, cropW, cropH).data;
        const sData = sCtx.getImageData(0, 0, cropW, cropH).data;

        // Helligkeits-Varianz → Kartenerkennung
        let s = 0, sq = 0, vc = 0;
        for (let i = 0; i < sData.length; i += 64) {
          const br = (sData[i] + sData[i + 1] + sData[i + 2]) / 3;
          s += br; sq += br * br; vc++;
        }
        const localCardDetected = vc > 0 && (sq / vc - (s / vc) ** 2) > CARD_DETECT_VARIANCE;
        setCardDetected(localCardDetected);

        // MSE — Bewegungsmessung
        let mse = 0, count = 0;
        for (let i = 0; i < sData.length; i += 32) {
          const d = sData[i] - pData[i];
          mse += d * d;
          count++;
        }
        mse = count > 0 ? mse / count : 0;
        pCtx.drawImage(sample, 0, 0);

        // Während Cooldown: keine Auto-Erkennung
        if (cooldownRef.current || mse > MOTION_RESET_THRESHOLD || !localCardDetected) {
          stableFramesRef.current = 0;
          if (!cooldownRef.current) setProgress(0);
        } else {
          stableFramesRef.current += 1;
          const p = Math.min(stableFramesRef.current / SNAP_STABLE_FRAMES, 1);
          setProgress(p);
          if (stableFramesRef.current >= SNAP_STABLE_FRAMES) {
            doCapture();
          }
        }
      }, CHECK_MS);
    }, 800);

    return () => {
      clearTimeout(startDelay);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [doCapture]);

  // ── Torch ────────────────────────────────────────────────────────────────
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(t => !t);
    } catch { /* nicht unterstützt */ }
  };

  const frameColor = inCooldown
    ? 'rgba(255,255,255,0.2)'          // nach Snap: gedimmt
    : cardDetected && progress > 0
      ? '#48bb78'                       // grün: snap läuft
      : cardDetected
        ? '#ecc94b'                     // gelb: Karte erkannt
        : 'rgba(255,255,255,0.4)';      // weiß: warten

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
        <div
          className="relative w-full aspect-[3/4] bg-black rounded-2xl overflow-hidden"
          onClick={!inCooldown ? doCapture : undefined}
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
                style={{ border: '2.5px solid', borderColor: frameColor, borderRadius: 12, transition: 'border-color 0.3s' }}
              />
              {['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0'].map((pos, i) => (
                <div
                  key={i}
                  className={`absolute w-4 h-4 ${pos}`}
                  style={{
                    borderColor: frameColor, borderStyle: 'solid', borderWidth: 0,
                    transition: 'border-color 0.3s',
                    ...(i === 0 && { borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 }),
                    ...(i === 1 && { borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 }),
                    ...(i === 2 && { borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 }),
                    ...(i === 3 && { borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 }),
                  }}
                />
              ))}
            </div>
          </div>

          {/* Pending-Badge: laufende Erkennungen */}
          {pendingCount > 0 && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm">
              <Loader2 size={12} color="#fff" className="animate-spin" />
              <span className="text-white text-xs font-medium">
                {pendingCount} Erkennend…
              </span>
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

      <p className="mt-3 text-xs text-center" style={{ color: frameColor === 'rgba(255,255,255,0.4)' || frameColor === 'rgba(255,255,255,0.2)' ? 'rgba(255,255,255,0.5)' : frameColor }}>
        {inCooldown
          ? 'Nächste Karte bereithalten…'
          : cardDetected
            ? progress > 0.5 ? 'Foto wird gemacht…' : 'Karte erkannt — kurz stillhalten'
            : 'Karte in den Rahmen halten — oder tippen'}
      </p>
    </div>
  );
}
