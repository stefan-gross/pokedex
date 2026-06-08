'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Zap, ZapOff, RefreshCw, Loader2 } from 'lucide-react';

interface Props {
  onCapture: (imageBase64: string, mimeType: string) => void;
  pendingCount?: number;
  paused?: boolean;
}

// Motion-Sample-Canvas (klein, nur für Bewegungsmessung)
const SAMPLE_W = 190;
const SAMPLE_H = 266;

const CHECK_MS               = 100;
const MOTION_RESET_THRESHOLD = 800;
const CARD_DETECT_VARIANCE   = 600;
const SNAP_STABLE_FRAMES     = 3;
const SNAP_COOLDOWN_MS       = 2000;

// Analyse-Canvas: feste Größe für konsistente Erkennung
const EDGE_W = 280;
const EDGE_H = 392; // ~1.4 Seitenverhältnis
// Anteil des Videobilds der analysiert wird (groß = auch außermittige Karten)
const DETECT_FRACTION = 0.85;

// ─── Rotationsrobuste Kartenerkennung ──────────────────────────────────────
interface CardQuad {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  bl: { x: number; y: number };
  br: { x: number; y: number };
}

/**
 * Erkennt eine Pokémon-Karte im Pixel-Buffer via Sobel-Kanten + linearer Regression.
 * Funktioniert auch bei leichter Rotation und off-center Lage, weil statt fixer
 * Bandpositionen Geraden durch alle Kantenpunkte gefittet werden.
 */
function detectCard(data: Uint8ClampedArray, W: number, H: number): CardQuad | null {
  // Graustufen
  const gray = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  }

  // Schneller Gradientenbetrag (ohne sqrt, Manhattan-Norm reicht)
  const edge = (y: number, x: number): number => {
    if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) return 0;
    return Math.abs(gray[y * W + x + 1] - gray[y * W + x - 1]) +
           Math.abs(gray[(y + 1) * W + x] - gray[(y - 1) * W + x]);
  };

  // Adaptiver Schwellwert (sparse sample)
  let maxE = 0;
  for (let y = 2; y < H - 2; y += 4) {
    for (let x = 2; x < W - 2; x += 4) {
      const e = edge(y, x); if (e > maxE) maxE = e;
    }
  }
  if (maxE < 18) return null;
  const thr = maxE * 0.22;

  const xM = Math.round(W * 0.06);
  const yM = Math.round(H * 0.06);

  // Kantenpunkte pro Seite sammeln
  const topPts: [number, number][] = [];   // [x, y] → y = f(x)
  const botPts: [number, number][] = [];
  const lftPts: [number, number][] = [];   // [y, x] → x = f(y)
  const rgtPts: [number, number][] = [];

  for (let x = xM; x < W - xM; x += 2) {
    for (let y = yM; y < H * 0.70; y++) {
      if (edge(y, x) >= thr) { topPts.push([x, y]); break; }
    }
    for (let y = H - yM; y > H * 0.30; y--) {
      if (edge(y, x) >= thr) { botPts.push([x, y]); break; }
    }
  }
  for (let y = yM; y < H - yM; y += 2) {
    for (let x = xM; x < W * 0.70; x++) {
      if (edge(y, x) >= thr) { lftPts.push([y, x]); break; }
    }
    for (let x = W - xM; x > W * 0.30; x--) {
      if (edge(y, x) >= thr) { rgtPts.push([y, x]); break; }
    }
  }

  const MIN = 10;
  if (topPts.length < MIN || botPts.length < MIN || lftPts.length < MIN || rgtPts.length < MIN) return null;

  // Lineare Regression: y = slope*x + intercept, gibt auch R² zurück
  const fit = (pts: [number, number][]): { s: number; b: number; r2: number } => {
    const n = pts.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const d = n * sxx - sx * sx;
    if (Math.abs(d) < 1) return { s: 0, b: sy / n, r2: 0 };
    const s = (n * sxy - sx * sy) / d;
    const b = (sy - s * sx) / n;
    const ym = sy / n;
    let sr = 0, st = 0;
    for (const [x, y] of pts) { sr += (y - s * x - b) ** 2; st += (y - ym) ** 2; }
    return { s, b, r2: st > 0 ? 1 - sr / st : 1 };
  };

  const top = fit(topPts);   // y = top.s*x + top.b
  const bot = fit(botPts);
  const lft = fit(lftPts);   // x = lft.s*y + lft.b  (pts sind [y,x])
  const rgt = fit(rgtPts);

  // Mindest-Geradlinigkeit (R² > 0.6 → echte Kartenkante, kein Rauschen)
  if (top.r2 < 0.6 || bot.r2 < 0.6 || lft.r2 < 0.6 || rgt.r2 < 0.6) return null;

  // Schnittpunkt: y = ms*x + bs  UND  x = ml*y + bl
  const ix = (ms: number, bs: number, ml: number, bl: number) => {
    const d = 1 - ml * ms;
    if (Math.abs(d) < 0.001) return { x: bl, y: ms * bl + bs };
    const x = (ml * bs + bl) / d;
    return { x, y: ms * x + bs };
  };

  const tl = ix(top.s, top.b, lft.s, lft.b);
  const tr = ix(top.s, top.b, rgt.s, rgt.b);
  const bl = ix(bot.s, bot.b, lft.s, lft.b);
  const br = ix(bot.s, bot.b, rgt.s, rgt.b);

  // Größe & Seitenverhältnis prüfen
  const w = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
  const h = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;

  if (w < W * 0.15 || h < H * 0.15) return null;
  const asp = h / w;
  if (asp < 1.05 || asp > 1.85) return null;

  // Ecken dürfen nicht weit außerhalb des Analyse-Frames liegen
  for (const p of [tl, tr, bl, br]) {
    if (p.x < -W * 0.2 || p.x > W * 1.2 || p.y < -H * 0.2 || p.y > H * 1.2) return null;
  }

  return { tl, tr, bl, br };
}

export function CameraCapture({ onCapture, pendingCount = 0, paused = false }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const sampleRef  = useRef<HTMLCanvasElement>(null);
  const prevRef    = useRef<HTMLCanvasElement>(null);
  const edgeRef    = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const stableRef  = useRef(0);
  const cooldownRef = useRef(false);
  const onCaptureRef = useRef(onCapture);
  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torch,      setTorch]      = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [progress,   setProgress]   = useState(0);
  const [detected,   setDetected]   = useState(false);
  const [inCooldown, setInCooldown] = useState(false);
  const [flashing,   setFlashing]   = useState(false);

  // ── Overlay: zeichnet grünes Viereck um die erkannte Karte ────────────────
  const drawOverlay = useCallback((
    quad: CardQuad | null,
    vw: number, vh: number,
    desx: number, desy: number, dw: number, dh: number,
  ) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const dispW = overlay.clientWidth;
    const dispH = overlay.clientHeight;
    if (!dispW || !dispH) return;
    overlay.width  = dispW;
    overlay.height = dispH;
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, dispW, dispH);
    if (!quad || !vw || !vh) return;

    // object-cover Mapping: Analyse-Canvas → Video → Display
    const vAsp = vw / vh, dAsp = dispW / dispH;
    let scale: number, ox: number, oy: number;
    if (vAsp > dAsp) { scale = dispH / vh; ox = -(vw * scale - dispW) / 2; oy = 0; }
    else             { scale = dispW / vw; ox = 0; oy = -(vh * scale - dispH) / 2; }

    const toD = (ex: number, ey: number) => ({
      x: (desx + (ex / EDGE_W) * dw) * scale + ox,
      y: (desy + (ey / EDGE_H) * dh) * scale + oy,
    });

    const pts = [quad.tl, quad.tr, quad.br, quad.bl].map(p => toD(p.x, p.y));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.strokeStyle = '#48bb78';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(72,187,120,0.55)';
    ctx.shadowBlur  = 10;
    ctx.stroke();
  }, []);

  // ── Kamera starten ────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    setError(null); stableRef.current = 0; setProgress(0); setDetected(false);
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
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [startCamera]);

  // ── Foto auslösen ─────────────────────────────────────────────────────────
  const doCapture = useCallback(() => {
    if (cooldownRef.current || paused) return;
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    onCaptureRef.current(canvas.toDataURL('image/jpeg', 0.9).split(',')[1], 'image/jpeg');

    setFlashing(true); setTimeout(() => setFlashing(false), 180);
    stableRef.current = 0; setProgress(0); setDetected(false);
    cooldownRef.current = true; setInCooldown(true);
    setTimeout(() => { cooldownRef.current = false; setInCooldown(false); }, SNAP_COOLDOWN_MS);
  }, [paused]);

  // ── Detection-Loop ────────────────────────────────────────────────────────
  useEffect(() => {
    const delay = setTimeout(() => {
      timerRef.current = setInterval(() => {
        if (paused) return;
        const video = videoRef.current, sample = sampleRef.current;
        const prev = prevRef.current, edge = edgeRef.current;
        if (!video || !sample || !prev || !edge || video.readyState < 2) return;
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;

        // 1. Motion-Sample (für Varianz + MSE)
        const sw = Math.min(SAMPLE_W, vw), sh = Math.min(SAMPLE_H, vh);
        const sx = Math.max(0, (vw - sw) / 2), sy = Math.max(0, (vh - sh) / 2);
        const sCtx = sample.getContext('2d')!;
        sCtx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
        const sData = sCtx.getImageData(0, 0, sw, sh).data;
        const pCtx = prev.getContext('2d')!;
        const pData = pCtx.getImageData(0, 0, sw, sh).data;

        // Varianz-Veto
        let s = 0, sq = 0, n = 0;
        for (let i = 0; i < sData.length; i += 64) {
          const b = (sData[i] + sData[i + 1] + sData[i + 2]) / 3;
          s += b; sq += b * b; n++;
        }
        const hasObject = n > 0 && (sq / n - (s / n) ** 2) > CARD_DETECT_VARIANCE;

        // 2. Kartenerkennung
        let quad: CardQuad | null = null;
        let desx = 0, desy = 0, dw = 0, dh = 0;

        if (hasObject) {
          dw = Math.min(Math.round(Math.min(vw, vh) * DETECT_FRACTION), vw);
          dh = Math.min(Math.round(dw * (EDGE_H / EDGE_W)), vh);
          desx = Math.max(0, (vw - dw) / 2);
          desy = Math.max(0, (vh - dh) / 2);

          const eCtx = edge.getContext('2d')!;
          eCtx.drawImage(video, desx, desy, dw, dh, 0, 0, EDGE_W, EDGE_H);
          quad = detectCard(eCtx.getImageData(0, 0, EDGE_W, EDGE_H).data, EDGE_W, EDGE_H);
        }

        drawOverlay(quad, vw, vh, desx, desy, dw, dh);
        setDetected(!!quad);

        // 3. Bewegungsmessung (MSE)
        let mse = 0, mc = 0;
        for (let i = 0; i < sData.length; i += 32) {
          const d = sData[i] - pData[i]; mse += d * d; mc++;
        }
        mse = mc > 0 ? mse / mc : 0;
        pCtx.drawImage(sample, 0, 0);

        if (cooldownRef.current || mse > MOTION_RESET_THRESHOLD || !quad) {
          stableRef.current = 0;
          if (!cooldownRef.current) setProgress(0);
        } else {
          stableRef.current += 1;
          setProgress(Math.min(stableRef.current / SNAP_STABLE_FRAMES, 1));
          if (stableRef.current >= SNAP_STABLE_FRAMES) doCapture();
        }
      }, CHECK_MS);
    }, 800);

    return () => { clearTimeout(delay); if (timerRef.current) clearInterval(timerRef.current); };
  }, [doCapture, paused, drawOverlay]);

  // ── Taschenlampe ─────────────────────────────────────────────────────────
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(t => !t); }
    catch { /* nicht unterstützt */ }
  };

  const hintText = paused       ? 'Scannen pausiert'
    : inCooldown                ? 'Nächste Karte bereithalten …'
    : progress > 0              ? 'Foto wird gemacht …'
    : detected                  ? 'Karte erkannt — kurz stillhalten'
    :                             'Pokémon-Karte in die Kamera halten';

  const hintColor = (detected || progress > 0) && !inCooldown && !paused
    ? '#48bb78' : 'rgba(255,255,255,0.55)';

  return (
    <div
      className="relative w-full h-full bg-black overflow-hidden"
      onClick={!inCooldown && !paused ? doCapture : undefined}
    >
      {/* Versteckte Canvases */}
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={sampleRef} width={SAMPLE_W} height={SAMPLE_H} className="hidden" />
      <canvas ref={prevRef}   width={SAMPLE_W} height={SAMPLE_H} className="hidden" />
      <canvas ref={edgeRef}   width={EDGE_W}   height={EDGE_H}   className="hidden" />

      {error ? (
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
          <p className="text-sm text-white/50">{error}</p>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay playsInline muted
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Erkennungs-Overlay */}
          <canvas
            ref={overlayRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: 2 }}
          />

          {/* Weißer Blitz beim Snap */}
          {flashing && (
            <div className="absolute inset-0 bg-white/70 pointer-events-none" style={{ zIndex: 3 }} />
          )}

          {/* Pause-Overlay */}
          {paused && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center pointer-events-none" style={{ zIndex: 3 }}>
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                <div className="w-4 h-10 flex gap-1.5">
                  <div className="flex-1 bg-white rounded-sm" />
                  <div className="flex-1 bg-white rounded-sm" />
                </div>
              </div>
            </div>
          )}

          {/* Pending-Badge */}
          {pendingCount > 0 && (
            <div className="absolute top-4 left-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm" style={{ zIndex: 4 }}>
              <Loader2 size={12} color="#fff" className="animate-spin" />
              <span className="text-white text-xs font-medium">{pendingCount} Erkennend …</span>
            </div>
          )}

          {/* Torch + Kamerawechsel (rechts, etwas unterhalb des Headers) */}
          <div
            className="absolute right-4 flex flex-col gap-2 pointer-events-auto"
            style={{ top: 80, zIndex: 4 }}
            onClick={e => e.stopPropagation()}
          >
            <button onClick={toggleTorch} className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
              {torch ? <Zap size={17} color="#facc15" /> : <ZapOff size={17} color="#fff" />}
            </button>
            <button onClick={() => setFacingMode(m => m === 'environment' ? 'user' : 'environment')} className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
              <RefreshCw size={17} color="#fff" />
            </button>
          </div>

          {/* Hint-Text unten */}
          <p
            className="absolute left-0 right-0 text-center text-sm font-medium pointer-events-none"
            style={{ bottom: 100, color: hintColor, zIndex: 4, textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}
          >
            {hintText}
          </p>
        </>
      )}
    </div>
  );
}
