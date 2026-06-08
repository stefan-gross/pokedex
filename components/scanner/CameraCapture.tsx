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
const SNAP_STABLE_FRAMES     = 3;
const SNAP_COOLDOWN_MS       = 2000;

// Analyse-Canvas bei fester Größe (effizient)
const EDGE_W = 300;
const EDGE_H = Math.round(EDGE_W * CARD_ASPECT); // 420
// Größerer Suchbereich → erkennt Karten auch leicht außermittig
const DETECT_FRACTION = 0.75;
// Minimale Kantenstärke für eine gültige Kartengrenze
const EDGE_MIN_STRENGTH = 8;

interface ContourResult {
  edgesFound: number;
  cardDetected: boolean;
  topY: number;
  bottomY: number;
  leftX: number;
  rightX: number;
}

/**
 * Kontur-Erkennung: Sucht in 4 Scan-Bändern die stärkste Kante,
 * prüft Seitenverhältnis (~1.4 = Pokémon-Karte).
 * Gibt neben edgesFound/cardDetected auch die Corner-Koordinaten zurück
 * (im EDGE_W × EDGE_H Analyse-Koordinatensystem).
 */
function detectCardContour(data: Uint8ClampedArray, W: number, H: number): ContourResult {
  const none: ContourResult = { edgesFound: 0, cardDetected: false, topY: 0, bottomY: H, leftX: 0, rightX: W };

  const grayAt = (y: number, x: number) => {
    const p = (y * W + x) * 4;
    return (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  };

  const xA = Math.round(W * 0.1), xB = Math.round(W * 0.9);
  const yA = Math.round(H * 0.1), yB = Math.round(H * 0.9);

  const findHEdge = (yFrom: number, yTo: number): [number, number] => {
    let bestY = -1, best = 0;
    for (let y = Math.max(1, yFrom); y < Math.min(H - 1, yTo); y++) {
      let sum = 0, n = 0;
      for (let x = xA; x < xB; x += 4) {
        sum += Math.abs(grayAt(y + 1, x) - grayAt(y - 1, x));
        n++;
      }
      const avg = n > 0 ? sum / n : 0;
      if (avg > best) { best = avg; bestY = y; }
    }
    return [bestY, best];
  };

  const findVEdge = (xFrom: number, xTo: number): [number, number] => {
    let bestX = -1, best = 0;
    for (let x = Math.max(1, xFrom); x < Math.min(W - 1, xTo); x++) {
      let sum = 0, n = 0;
      for (let y = yA; y < yB; y += 4) {
        sum += Math.abs(grayAt(y, x + 1) - grayAt(y, x - 1));
        n++;
      }
      const avg = n > 0 ? sum / n : 0;
      if (avg > best) { best = avg; bestX = x; }
    }
    return [bestX, best];
  };

  const [topY,    topStr]    = findHEdge(1,                    Math.round(H * 0.45));
  const [bottomY, bottomStr] = findHEdge(Math.round(H * 0.55), H - 1);
  const [leftX,   leftStr]   = findVEdge(1,                    Math.round(W * 0.45));
  const [rightX,  rightStr]  = findVEdge(Math.round(W * 0.55), W - 1);

  const strengths  = [topStr, bottomStr, leftStr, rightStr];
  const edgesFound = strengths.filter(s => s > EDGE_MIN_STRENGTH).length;

  if (edgesFound < 4) return { ...none, edgesFound };

  const cardW = rightX - leftX;
  const cardH = bottomY - topY;
  if (cardW <= 0 || cardH <= 0) return { ...none, edgesFound: 3 };

  const aspect = cardH / cardW;
  if (aspect < 1.1 || aspect > 1.7) return { ...none, edgesFound: 3 };

  if ((cardW * cardH) / (W * H) < 0.08) return { ...none, edgesFound: 3 };

  return { edgesFound: 4, cardDetected: true, topY, bottomY, leftX, rightX };
}

export function CameraCapture({ onCapture, pendingCount = 0, paused = false }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const sampleRef   = useRef<HTMLCanvasElement>(null);
  const prevRef     = useRef<HTMLCanvasElement>(null);
  const edgeRef     = useRef<HTMLCanvasElement>(null);
  const overlayRef  = useRef<HTMLCanvasElement>(null); // sichtbares Kontur-Overlay
  const streamRef   = useRef<MediaStream | null>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const stableFramesRef = useRef<number>(0);
  const cooldownRef = useRef<boolean>(false);
  const onCaptureRef = useRef(onCapture);

  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  // Zeichnet grünen Kartenrahmen auf das Overlay-Canvas.
  // corners: Koordinaten im EDGE_W×EDGE_H Analyse-Raum, plus Video-Crop-Infos.
  const drawCardOverlay = useCallback((
    corners: { topY: number; bottomY: number; leftX: number; rightX: number } | null,
    vw: number, vh: number,
    desx: number, desy: number, dw: number, dh: number,
  ) => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const dispW = overlay.clientWidth;
    const dispH = overlay.clientHeight;
    if (dispW === 0 || dispH === 0) return;
    overlay.width  = dispW;
    overlay.height = dispH;

    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, dispW, dispH);
    if (!corners || !vw || !vh) return;

    // Video-Pixel → Display-Pixel (object-cover Mapping)
    const videoAspect = vw / vh;
    const dispAspect  = dispW / dispH;
    let scale: number, offX: number, offY: number;
    if (videoAspect > dispAspect) {
      scale = dispH / vh;
      offX  = -(vw * scale - dispW) / 2;
      offY  = 0;
    } else {
      scale = dispW / vw;
      offX  = 0;
      offY  = -(vh * scale - dispH) / 2;
    }

    // Analyse-Pixel → Video-Pixel → Display-Pixel
    const toDispX = (ex: number) => (desx + (ex / EDGE_W) * dw) * scale + offX;
    const toDispY = (ey: number) => (desy + (ey / EDGE_H) * dh) * scale + offY;

    const x0 = toDispX(corners.leftX);
    const x1 = toDispX(corners.rightX);
    const y0 = toDispY(corners.topY);
    const y1 = toDispY(corners.bottomY);

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x0, y1);
    ctx.closePath();
    ctx.strokeStyle = '#48bb78';
    ctx.lineWidth   = 3;
    ctx.shadowColor = 'rgba(72,187,120,0.6)';
    ctx.shadowBlur  = 8;
    ctx.stroke();
  }, []);

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

        // ── 2. Kontur-Check ──────────────────────────────────────────────
        let edges = 0;
        let localCardDetected = false;
        let cropParams = { desx: 0, desy: 0, dw: 0, dh: 0 };

        if (hasObject) {
          const dw = Math.min(Math.round(Math.min(vw, vh) * DETECT_FRACTION), vw);
          const dh = Math.min(Math.round(dw * CARD_ASPECT), vh);
          const desx = Math.max(0, (vw - dw) / 2);
          const desy = Math.max(0, (vh - dh) / 2);
          cropParams = { desx, desy, dw, dh };

          const eCtx = edge.getContext('2d')!;
          eCtx.drawImage(video, desx, desy, dw, dh, 0, 0, EDGE_W, EDGE_H);
          const eData = eCtx.getImageData(0, 0, EDGE_W, EDGE_H).data;
          const contour = detectCardContour(eData, EDGE_W, EDGE_H);
          edges = contour.edgesFound;
          localCardDetected = contour.cardDetected;

          if (localCardDetected) {
            drawCardOverlay(contour, vw, vh, desx, desy, dw, dh);
          } else {
            drawCardOverlay(null, vw, vh, desx, desy, dw, dh);
          }
        } else {
          drawCardOverlay(null, 0, 0, 0, 0, 0, 0);
        }

        setEdgesFound(edges);
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
  }, [doCapture, paused, drawCardOverlay]);

  // ── Torch ────────────────────────────────────────────────────────────────
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(t => !t);
    } catch { /* nicht unterstützt */ }
  };

  // Rahmenfarbe: weiß → orange (Kanten erkannt, falsche Form) → gelb (Karte mit korrekter Form) → grün (Snap)
  const frameColor = paused || inCooldown
    ? 'rgba(255,255,255,0.2)'
    : progress > 0
      ? '#48bb78'                           // grün: Snap
      : cardDetected
        ? '#ecc94b'                         // gelb: Pokémon-Karte mit korrekter Form
        : edgesFound >= 2
          ? '#f6ad55'                       // orange: Kanten erkannt, aber falsche Form
          : 'rgba(255,255,255,0.4)';        // weiß: nichts

  const hintText = paused
    ? 'Scannen pausiert'
    : inCooldown
      ? 'Nächste Karte bereithalten…'
      : progress > 0
        ? 'Foto wird gemacht…'
        : cardDetected
          ? 'Karte erkannt — kurz stillhalten'
          : edgesFound >= 2
            ? 'Karte vollständig in den Rahmen halten'
            : 'Pokémon-Karte in den Rahmen halten';

  return (
    <div className="relative w-full flex flex-col items-center">
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={sampleRef} width={FRAME_W} height={FRAME_H} className="hidden" />
      <canvas ref={prevRef}   width={FRAME_W} height={FRAME_H} className="hidden" />
      <canvas ref={edgeRef}   width={EDGE_W}  height={EDGE_H}  className="hidden" />
      {/* Overlay-Canvas — sichtbar, über dem Video */}

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
          <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 2 }} />

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
