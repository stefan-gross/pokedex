'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Zap, ZapOff, RefreshCw, Loader2 } from 'lucide-react';
import { loadCardDetectorSession, detectCardInFrame, type CardBox } from '@/lib/scanner/card-detector-onnx';

interface Props {
  onCapture: (imageBase64: string, mimeType: string) => void;
  pendingCount?: number;
  paused?: boolean;
}

// Motion-Sample-Canvas (klein, nur für Bewegungsmessung)
const SAMPLE_W = 190;
const SAMPLE_H = 266;

const CHECK_MS               = 150;   // ONNX-Inferenz ~80ms → etwas mehr Budget
const MOTION_RESET_THRESHOLD = 1200;  // nur grobe Bewegung stoppt Snap
const SNAP_STABLE_FRAMES     = 3;     // ~450ms Ruhe → Auslöser
const SNAP_INSTANT_CONF      = 0.85;  // bei sehr hoher Konfidenz sofort auslösen
const SNAP_COOLDOWN_MS       = 2000;

// Rand um die ONNX-Box beim Zuschneiden für Gemini (Pixel in Video-Koordinaten)
const CROP_PADDING = 24;

interface DebugInfo {
  conf: number;
  mse: number;
  stable: number;
  detected: boolean;
  sessionReady: boolean;
  cropSize: string;
}

export function CameraCapture({ onCapture, pendingCount = 0, paused = false }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const sampleRef  = useRef<HTMLCanvasElement>(null);
  const prevRef    = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const stableRef    = useRef(0);
  const cooldownRef  = useRef(false);
  const onCaptureRef = useRef(onCapture);

  // Letztes ONNX-Ergebnis in Video-Koordinaten (für Overlay + Snap-Trigger + Crop)
  const onnxBoxRef    = useRef<CardBox | null>(null);
  const onnxStickyRef = useRef(0);
  const ONNX_STICKY   = 4;
  const inferringRef  = useRef(false);
  const sessionReadyRef = useRef(false);

  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torch,      setTorch]      = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [progress,   setProgress]   = useState(0);
  const [detected,   setDetected]   = useState(false);
  const [inCooldown, setInCooldown] = useState(false);
  const [flashing,   setFlashing]   = useState(false);
  const [debug,      setDebug]      = useState<DebugInfo>({
    conf: 0, mse: 0, stable: 0, detected: false, sessionReady: false, cropSize: '–',
  });

  // ONNX-Session beim Mount laden
  useEffect(() => {
    loadCardDetectorSession()
      .then(() => { sessionReadyRef.current = true; })
      .catch(console.warn);
  }, []);

  // ── Overlay: ONNX-Box oder gestrichelter Hilfsrahmen ─────────────────────
  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const dispW = overlay.clientWidth;
    const dispH = overlay.clientHeight;
    if (!dispW || !dispH) return;
    overlay.width  = dispW;
    overlay.height = dispH;
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, dispW, dispH);

    const video = videoRef.current;
    const vw = video?.videoWidth  ?? 0;
    const vh = video?.videoHeight ?? 0;

    const box = onnxBoxRef.current;
    if (box && vw && vh) {
      const vAsp = vw / vh, dAsp = dispW / dispH;
      let scale: number, ox: number, oy: number;
      if (vAsp > dAsp) { scale = dispH / vh; ox = -(vw * scale - dispW) / 2; oy = 0; }
      else             { scale = dispW / vw; ox = 0; oy = -(vh * scale - dispH) / 2; }

      const bx = box.x * scale + ox;
      const by = box.y * scale + oy;
      const bw = box.w * scale;
      const bh = box.h * scale;

      // Grüner Rahmen mit runden Ecken
      ctx.strokeStyle = '#48bb78';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(72,187,120,0.6)';
      ctx.shadowBlur  = 12;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 14);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Halbtransparente Füllung
      ctx.fillStyle = 'rgba(72,187,120,0.07)';
      ctx.fill();
      return;
    }

    // Kein ONNX-Treffer → gestrichelter Hilfsrahmen
    const guideW = Math.min(dispW * 0.62, dispH * 0.50);
    const guideH = guideW * 1.4;
    const gx = (dispW - guideW) / 2;
    const gy = (dispH - guideH) / 2;
    const r = 14;
    ctx.setLineDash([10, 7]);
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx + r, gy);
    ctx.lineTo(gx + guideW - r, gy);
    ctx.arcTo(gx + guideW, gy, gx + guideW, gy + r, r);
    ctx.lineTo(gx + guideW, gy + guideH - r);
    ctx.arcTo(gx + guideW, gy + guideH, gx + guideW - r, gy + guideH, r);
    ctx.lineTo(gx + r, gy + guideH);
    ctx.arcTo(gx, gy + guideH, gx, gy + guideH - r, r);
    ctx.lineTo(gx, gy + r);
    ctx.arcTo(gx, gy, gx + r, gy, r);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
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

    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);

    // ONNX-Box bekannt → Karte ausschneiden für bessere Gemini-Erkennung
    const box = onnxBoxRef.current;
    let imageBase64: string;
    let cropInfo = `${canvas.width}×${canvas.height} (voll)`;

    if (box && box.w > 50 && box.h > 50) {
      const pad = CROP_PADDING;
      const cx = Math.max(0, Math.round(box.x - pad));
      const cy = Math.max(0, Math.round(box.y - pad));
      const cw = Math.min(canvas.width  - cx, Math.round(box.w + pad * 2));
      const ch = Math.min(canvas.height - cy, Math.round(box.h + pad * 2));
      const crop = document.createElement('canvas');
      crop.width  = cw;
      crop.height = ch;
      crop.getContext('2d')!.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
      imageBase64 = crop.toDataURL('image/jpeg', 0.92).split(',')[1];
      cropInfo = `${cw}×${ch} (crop)`;
    } else {
      imageBase64 = canvas.toDataURL('image/jpeg', 0.90).split(',')[1];
    }

    setDebug(d => ({ ...d, cropSize: cropInfo }));
    onCaptureRef.current(imageBase64, 'image/jpeg');

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
        const prev = prevRef.current;
        if (!video || !sample || !prev || video.readyState < 2) return;
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;

        // 1. Motion-Sample
        const sw = Math.min(SAMPLE_W, vw), sh = Math.min(SAMPLE_H, vh);
        const sx = Math.max(0, (vw - sw) / 2), sy = Math.max(0, (vh - sh) / 2);
        const sCtx = sample.getContext('2d')!;
        sCtx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
        const sData = sCtx.getImageData(0, 0, sw, sh).data;
        const pCtx = prev.getContext('2d')!;
        const pData = pCtx.getImageData(0, 0, sw, sh).data;

        // 2. ONNX: fire-and-forget
        if (!inferringRef.current && vw > 0) {
          inferringRef.current = true;
          detectCardInFrame(video).then(box => {
            if (box) {
              onnxBoxRef.current    = box;
              onnxStickyRef.current = ONNX_STICKY;
            } else {
              onnxStickyRef.current = Math.max(0, onnxStickyRef.current - 1);
              if (onnxStickyRef.current === 0) onnxBoxRef.current = null;
            }
          }).catch(() => {
            onnxBoxRef.current    = null;
            onnxStickyRef.current = 0;
          }).finally(() => {
            inferringRef.current = false;
          });
        }
        const cardDetected = onnxBoxRef.current !== null;

        // 3. Overlay
        drawOverlay();
        setDetected(cardDetected);

        // 4. MSE
        let mse = 0, mc = 0;
        for (let i = 0; i < sData.length; i += 32) {
          const d = sData[i] - pData[i]; mse += d * d; mc++;
        }
        mse = mc > 0 ? mse / mc : 0;
        pCtx.drawImage(sample, 0, 0);

        // 5. Debug-State aktualisieren
        setDebug({
          conf:    onnxBoxRef.current?.conf ?? 0,
          mse:     Math.round(mse),
          stable:  stableRef.current,
          detected: cardDetected,
          sessionReady: sessionReadyRef.current,
          cropSize: '',  // wird nur bei Snap gesetzt
        });

        // 6. Snap-Trigger
        const highConf = (onnxBoxRef.current?.conf ?? 0) >= SNAP_INSTANT_CONF;
        if (!cooldownRef.current && cardDetected && highConf && mse < MOTION_RESET_THRESHOLD / 2) {
          setProgress(1);
          doCapture();
        } else {
          if (cooldownRef.current || mse > MOTION_RESET_THRESHOLD || !cardDetected) {
            stableRef.current = 0;
            if (!cooldownRef.current) setProgress(0);
          } else {
            stableRef.current += 1;
            setProgress(Math.min(stableRef.current / SNAP_STABLE_FRAMES, 1));
            if (stableRef.current >= SNAP_STABLE_FRAMES) doCapture();
          }
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

  const hintText = paused             ? 'Scannen pausiert'
    : inCooldown                      ? 'Nächste Karte bereithalten …'
    : detected && progress > 0        ? 'Karte erkannt — kurz stillhalten'
    : detected                        ? 'Karte erkannt'
    : progress > 0                    ? 'Kurz stillhalten …'
    :                                   'Karte in den Rahmen halten und stillhalten';

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

          {/* ── DEBUG-Panel ────────────────────────────────────────── */}
          <div
            className="absolute left-0 right-0 pointer-events-none"
            style={{
              top: 'calc(env(safe-area-inset-top, 0px) + 60px)',
              zIndex: 10,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                background: 'rgba(0,0,0,0.72)',
                borderRadius: 10,
                padding: '6px 12px',
                fontFamily: 'monospace',
                fontSize: 12,
                color: '#fff',
                lineHeight: 1.6,
                minWidth: 220,
              }}
            >
              <div>
                Session:{' '}
                <span style={{ color: debug.sessionReady ? '#48bb78' : '#f87171' }}>
                  {debug.sessionReady ? 'bereit' : 'lädt …'}
                </span>
              </div>
              <div>
                Karte:{' '}
                <span style={{ color: debug.detected ? '#48bb78' : '#f87171' }}>
                  {debug.detected ? `erkannt (conf ${debug.conf.toFixed(2)})` : 'nicht erkannt'}
                </span>
              </div>
              <div>Bewegung (MSE): <span style={{ color: debug.mse > MOTION_RESET_THRESHOLD ? '#facc15' : '#fff' }}>{debug.mse}</span></div>
              <div>Stabil: {debug.stable} / {SNAP_STABLE_FRAMES}</div>
              {debug.cropSize && <div style={{ color: '#60a5fa' }}>Crop: {debug.cropSize}</div>}
            </div>
          </div>

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

          {/* Torch + Kamerawechsel */}
          <div
            className="absolute left-4 flex flex-col gap-2 pointer-events-auto"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 68px)', zIndex: 4 }}
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
