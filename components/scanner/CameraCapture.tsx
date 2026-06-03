'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Zap, ZapOff, RefreshCw, Loader2, Pause, Play } from 'lucide-react';

interface Props {
  onCapture: (imageBase64: string, mimeType: string) => void;
  pendingCount?: number;
  paused?: boolean;
}

const FRAME_W = 190;
const FRAME_H = 266;
const CARD_ASPECT = FRAME_H / FRAME_W; // ≈ 1.4

const CHECK_MS = 100;
const MOTION_RESET_THRESHOLD = 800;
const CARD_DETECT_VARIANCE   = 600;
const SNAP_STABLE_FRAMES     = 1;
const SNAP_COOLDOWN_MS       = 2000;

// Kanten-Erkennung: Analyse-Canvas bei fester Größe (effizient)
const EDGE_W = 300;
const EDGE_H = Math.round(EDGE_W * CARD_ASPECT); // 420
// Anteil des Video-Bildes der gesampelt wird (Karte + Rand)
const DETECT_FRACTION = 0.45;
// Wo die Karte im Analyse-Canvas erwartet wird (Rand = außerhalb der Karte)
const CARD_MARGIN_PCT = 0.12;
// Minimale Kantenstärke die als klare Karte gilt
const EDGE_THRESHOLD = 18;

/**
 * Prüft ob an den 4 erwarteten Kartenrändern starke, gerade Kanten sichtbar sind.
 * Gibt zurück wie viele der 4 Seiten eine klare Kante haben (0–4).
 */
function countCardEdges(data: Uint8ClampedArray, W: number, H: number): number {
  const m = Math.round(W * CARD_MARGIN_PCT); // z.B. 36 px
  const scan = 3; // Gradient-Abstand in px

  // Gradient über eine horizontale Linie (Übergang oben/unten)
  const hGrad = (y: number): number => {
    let sum = 0, n = 0;
    for (let x = m; x < W - m; x += 4) {
      const i1 = ((y - scan) * W + x) * 4;
      const i2 = ((y + scan) * W + x) * 4;
      if (i1 >= 0 && i2 + 3 < data.length) {
        sum += Math.abs(data[i1] - data[i2]);
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  };

  // Gradient über eine vertikale Linie (Übergang links/rechts)
  const vGrad = (x: number): number => {
    let sum = 0, n = 0;
    for (let y = m; y < H - m; y += 4) {
      const i1 = (y * W + (x - scan)) * 4;
      const i2 = (y * W + (x + scan)) * 4;
      if (i1 >= 0 && i2 + 3 < data.length) {
        sum += Math.abs(data[i1] - data[i2]);
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  };

  const top    = hGrad(m);
  const bottom = hGrad(H - m);
  const left   = vGrad(m);
  const right  = vGrad(W - m);

  return [top, bottom, left, right].filter(g => g > EDGE_THRESHOLD).length;
}

export function CameraCapture({ onCapture, pendingCount = 0, paused = false }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const sampleRef   = useRef<HTMLCanvasElement>(null);
  const prevRef     = useRef<HTMLCanvasElement>(null);
  const edgeRef     = useRef<HTMLCanvasElement>(null);  // Kanten-Analyse
  const streamRef   = useRef<MediaStream | null>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const stableFramesRef = useRef<number>(0);
  const cooldownRef = useRef<boolean>(false);
  const onCaptureRef = useRef(onCapture);

  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  const [facingMode,   setFacingMode]   = useState<'environment' | 'user'>('environment');
  const [torch,        setTorch]        = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [progress,     setProgress]     = useState(0);
  const [cardDetected, setCardDetected] = useState(false);
  const [inCooldown,   setInCooldown]   = useState(false);
  const [flashing,     setFlashing]     = useState(false);
  const [edgesFound,   setEdgesFound]   = useState(0); // 0–4 erkannte Kanten

  // ── Kamera starten ──────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    setError(null);
    stableFramesRef.current = 0;
    setProgress(0);
    setCardDetected(false);
    setEdgesFound(0);
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
    if (cooldownRef.current || paused) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
    onCaptureRef.current(base64, 'image/jpeg');

    setFlashing(true);
    setTimeout(() => setFlashing(false), 180);

    stableFramesRef.current = 0;
    setProgress(0);
    setCardDetected(false);
    setEdgesFound(0);
    cooldownRef.current = true;
    setInCooldown(true);
    setTimeout(() => {
      cooldownRef.current = false;
      setInCooldown(false);
    }, SNAP_COOLDOWN_MS);
  }, [paused]);

  // ── Detection-Loop ────────────────────────────────────────────────────────
  useEffect(() => {
    const startDelay = setTimeout(() => {
      timerRef.current = setInterval(() => {
        if (paused) return;

        const video  = videoRef.current;
        const sample = sampleRef.current;
        const prev   = prevRef.current;
        const edge   = edgeRef.current;
        if (!video || !sample || !prev || !edge || video.readyState < 2) return;

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return;

        // ── 1. Motion-Sample (klein, für MSE) ───────────────────────────
        const cropW = Math.min(FRAME_W, vw);
        const cropH = Math.min(FRAME_H, vh);
        const sx = Math.max(0, (vw - cropW) / 2);
        const sy = Math.max(0, (vh - cropH) / 2);

        const sCtx = sample.getContext('2d')!;
        sCtx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

        const pCtx = prev.getContext('2d')!;
        const pData = pCtx.getImageData(0, 0, cropW, cropH).data;
        const sData = sCtx.getImageData(0, 0, cropW, cropH).data;

        // Varianz (schnelles Veto: kein Objekt → kein Snap)
        let s = 0, sq = 0, vc = 0;
        for (let i = 0; i < sData.length; i += 64) {
          const br = (sData[i] + sData[i + 1] + sData[i + 2]) / 3;
          s += br; sq += br * br; vc++;
        }
        const variance = vc > 0 ? sq / vc - (s / vc) ** 2 : 0;
        const hasObject = variance > CARD_DETECT_VARIANCE;

        // ── 2. Kanten-Check (größerer Ausschnitt: Karte + Hintergrund) ──
        let edges = 0;
        if (hasObject) {
          const dw = Math.min(Math.round(Math.min(vw, vh) * DETECT_FRACTION), vw);
          const dh = Math.min(Math.round(dw * CARD_ASPECT), vh);
          const desx = Math.max(0, (vw - dw) / 2);
          const desy = Math.max(0, (vh - dh) / 2);

          const eCtx = edge.getContext('2d')!;
          eCtx.drawImage(video, desx, desy, dw, dh, 0, 0, EDGE_W, EDGE_H);
          const eData = eCtx.getImageData(0, 0, EDGE_W, EDGE_H).data;
          edges = countCardEdges(eData, EDGE_W, EDGE_H);
        }
        setEdgesFound(edges);

        // Karte erkannt = Objekt vorhanden + mind. 3 der 4 Kanten klar
        const localCardDetected = hasObject && edges >= 3;
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
  }, [doCapture, paused]);

  // ── Torch ────────────────────────────────────────────────────────────────
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(t => !t);
    } catch { /* nicht unterstützt */ }
  };

  // Rahmenfarbe: weiß → orange (Objekt, aber kein Rechteck) → gelb (≥2 Kanten) → grün (≥3 Kanten = Karte)
  const frameColor = paused || inCooldown
    ? 'rgba(255,255,255,0.2)'
    : progress > 0
      ? '#48bb78'                           // grün: Snap
      : edgesFound >= 3
        ? '#ecc94b'                         // gelb: Pokémon-Karte erkannt
        : edgesFound >= 1
          ? '#f6ad55'                       // orange: Rechteck-Objekt aber unvollständig
          : 'rgba(255,255,255,0.4)';        // weiß: nichts

  const hintText = paused
    ? 'Scannen pausiert'
    : inCooldown
      ? 'Nächste Karte bereithalten…'
      : progress > 0
        ? 'Foto wird gemacht…'
        : edgesFound >= 3
          ? 'Karte erkannt — kurz stillhalten'
          : edgesFound >= 1
            ? 'Karte vollständig in den Rahmen halten'
            : 'Pokémon-Karte in den Rahmen halten';

  return (
    <div className="relative w-full flex flex-col items-center">
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={sampleRef} width={FRAME_W} height={FRAME_H} className="hidden" />
      <canvas ref={prevRef}   width={FRAME_W} height={FRAME_H} className="hidden" />
      <canvas ref={edgeRef}   width={EDGE_W}  height={EDGE_H}  className="hidden" />

      {error ? (
        <div className="w-full aspect-[3/4] bg-black rounded-2xl flex items-center justify-center text-center px-6">
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : (
        <div
          className="relative w-full aspect-[3/4] bg-black rounded-2xl overflow-hidden"
          onClick={!inCooldown && !paused ? doCapture : undefined}
        >
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />

          {flashing && <div className="absolute inset-0 bg-white/75 pointer-events-none" />}

          {paused && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center pointer-events-none">
              <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center">
                <Pause size={28} color="#fff" />
              </div>
            </div>
          )}

          {/* Card guide frame */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative" style={{ width: FRAME_W, height: FRAME_H }}>
              <div className="absolute inset-0" style={{ border: '2.5px solid', borderColor: frameColor, borderRadius: 12, transition: 'border-color 0.3s' }} />
              {['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0'].map((pos, i) => (
                <div key={i} className={`absolute w-4 h-4 ${pos}`} style={{
                  borderColor: frameColor, borderStyle: 'solid', borderWidth: 0, transition: 'border-color 0.3s',
                  ...(i === 0 && { borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 }),
                  ...(i === 1 && { borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 }),
                  ...(i === 2 && { borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 }),
                  ...(i === 3 && { borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 }),
                }} />
              ))}
            </div>
          </div>

          {/* Kanten-Indikator (kleine Punkte je erkannte Seite) */}
          {edgesFound > 0 && edgesFound < 3 && !inCooldown && !paused && (
            <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 pointer-events-none">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full transition-colors"
                  style={{ background: i < edgesFound ? '#f6ad55' : 'rgba(255,255,255,0.3)' }} />
              ))}
            </div>
          )}

          {/* Pending-Badge */}
          {pendingCount > 0 && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm">
              <Loader2 size={12} color="#fff" className="animate-spin" />
              <span className="text-white text-xs font-medium">{pendingCount} Erkennend…</span>
            </div>
          )}

          {/* Torch + Kamera-Wechsel */}
          <div className="absolute top-3 right-3 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
            <button onClick={toggleTorch} className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center">
              {torch ? <Zap size={16} color="#facc15" /> : <ZapOff size={16} color="#fff" />}
            </button>
            <button onClick={() => setFacingMode(m => m === 'environment' ? 'user' : 'environment')} className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center">
              <RefreshCw size={16} color="#fff" />
            </button>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-center" style={{
        color: frameColor === 'rgba(255,255,255,0.4)' || frameColor === 'rgba(255,255,255,0.2)'
          ? 'rgba(255,255,255,0.5)' : frameColor
      }}>
        {hintText}
      </p>
    </div>
  );
}
