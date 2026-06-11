'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Zap, ZapOff, Camera } from 'lucide-react';
import { loadCardDetectorSession, detectCardInFrame, type CardBox } from '@/lib/scanner/card-detector-onnx';

interface Props {
  onCapture: (imageBase64: string, mimeType: string) => void;
  pendingCount?: number;
  /** Soft-Pause: Stream läuft, Detection + Snap pausieren. */
  paused?: boolean;
  /** Hard-Active: false → kein Stream (kein getUserMedia). Parent kontrolliert
   *  Lifecycle via Footer-FAB. Aufnahme erfolgt nur per direkter Nutzer-Geste. */
  active: boolean;
}

// ─── Modul-Level: Stream-Referenz für Visibility-Handler ─────────────────────
// _kameraStream wird beim startCamera() gesetzt und beim Unmount sofort gestoppt.
// Modul-Level (nicht Ref), damit der visibilitychange-Handler den aktuellen
// Track-Status prüfen kann ohne via Closure den Ref-Stand zu kennen.
let _kameraStream:   MediaStream | null = null;
let _mountGeneration = 0; // steigt bei jedem Mount — für Debug sichtbar

// sessionStorage überlebt iOS-PWA-Reloads (im Gegensatz zu Modul-State).
// Counter > 0 beim Mount = wir wurden gerade reloaded → Permission war schon
// einmal in dieser Session gegeben → wir können das „Kamera starten"-Overlay
// überspringen und direkt erneut prompten.
const CAM_MOUNT_KEY = 'cam-mounts';
const initialReloadCount = (() => {
  if (typeof window === 'undefined') return 0;
  try { return Number(sessionStorage.getItem(CAM_MOUNT_KEY) ?? '0'); }
  catch { return 0; }
})();

// ─── Gerundetes Polygon für rotierten Karten-Rahmen ──────────────────────────
function drawRoundedPolygon(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  radius: number,
) {
  const n = pts.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const d1 = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    const d2 = Math.hypot(next[0] - curr[0], next[1] - curr[1]);
    if (d1 < 1 || d2 < 1) { ctx.lineTo(curr[0], curr[1]); continue; }
    const r   = Math.min(radius, d1 / 2, d2 / 2);
    const p1x = curr[0] - r * (curr[0] - prev[0]) / d1;
    const p1y = curr[1] - r * (curr[1] - prev[1]) / d1;
    const p2x = curr[0] + r * (next[0] - curr[0]) / d2;
    const p2y = curr[1] + r * (next[1] - curr[1]) / d2;
    if (i === 0) ctx.moveTo(p1x, p1y); else ctx.lineTo(p1x, p1y);
    ctx.quadraticCurveTo(curr[0], curr[1], p2x, p2y);
  }
  ctx.closePath();
}

// Motion-Sample-Canvas (klein, nur für Bewegungsmessung)
const SAMPLE_W = 190;
const SAMPLE_H = 266;

const CHECK_MS               = 150;   // ONNX-Inferenz ~80ms → etwas mehr Budget
const MOTION_RESET_THRESHOLD = 1200;  // grobe Bewegung → stable zurücksetzen
const MOTION_SNAP_THRESHOLD  = 700;   // unter diesem MSE-Wert gilt es als "ruhig"
const SNAP_STABLE_FRAMES     = 1;     // 1 ruhiger Frame reicht
const BOX_SETTLED_THRESHOLD  = 35;   // px — Box-Mittelpunkt-Drift zwischen ONNX-Frames
const CONSECUTIVE_SNAP_FRAMES = 2;   // Fallback: nach N aufeinander folgenden Treffern immer auslösen (3→2 spart 150ms zum Snap)
// Szenen-Änderungs-Cooldown: nach Snap warten bis MSE vs. Snapshot > Threshold.
// Verhindert Duplikat-Scans wenn dieselbe Karte noch im Bild liegt.
//
// MSE-Skala (kalibriert in der Praxis):
//   <100   = Karte ruht (Sensor-Rauschen, Autofokus-Mikro-Drift)
//   100-800 = Karte minimal verschoben, Hand-Tremor, leichte Lichtänderung
//   >1500  = neue Karte oder bewusste Bewegung
// Bei 200 wurde fälschlich JEDE Sekunde Szenen-Änderung erkannt → Endlos-Snaps.
const CHANGE_DETECT_THRESHOLD = 1500;
const SNAP_COOLDOWN_MIN_MS    = 800;  // Mindest-Wartezeit nach Snap (verlängert von 300ms)

// Rand um die ONNX-Box beim Zuschneiden für Gemini (Pixel in Video-Koordinaten)
const CROP_PADDING = 24;

// Upload-Optimierung: lange Kante auf 1024px begrenzen + JPEG-Quality 0.60.
// Vorher 0.75 ohne Resize → ~300-500KB Base64 → 20-40s Upload auf schwachem LTE.
// Gemini-OCR liest Schriften zuverlässig auch bei 0.60 / 1024px.
const MAX_EDGE_PX = 1024;
const JPEG_QUALITY = 0.60;
function encodeCropToJpeg(src: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number): string {
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(sw, sh));
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const out = document.createElement('canvas');
  out.width  = dw;
  out.height = dh;
  out.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
  return out.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1];
}

interface DebugInfo {
  conf: number;
  mse: number;
  stable: number;
  boxDelta: number;
  consecutiveFrames: number;
  detected: boolean;
  sessionReady: boolean;
  cropSize: string;
  triggerReason: string; // welcher Pfad den Snap ausgelöst hat
  changeMse: number;     // MSE vs. Snap-Snapshot (Kalibrierung CHANGE_DETECT_THRESHOLD)
}

export function CameraCapture({ onCapture, pendingCount = 0, paused = false, active }: Props) {
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
  const onnxStickyRef   = useRef(0);
  const ONNX_STICKY     = 2; // 2 × 150ms = 300ms bis Absence erkannt (war 4 = 600ms)
  const inferringRef    = useRef(false);
  const sessionReadyRef = useRef(false);
  const cropSizeRef     = useRef('–');
  const mountGenRef     = useRef(++_mountGeneration); // steigt bei jedem Remount

  // Race-Schutz: blockt Visibility-Handler während getUserMedia in flight ist.
  // Sonst sieht der Handler bei Dialog-Dismiss `_kameraStream === null` und
  // setzt fälschlich 'interrupted' → Error-UI flackert → User-Tap → zweiter Dialog.
  const startingRef     = useRef(false);
  // True erst NACHDEM ein Stream erfolgreich angehängt wurde. Verhindert dass
  // der Visibility-Handler beim allerersten Start „interrupted" feuert obwohl
  // wir noch nie einen Stream hatten.
  const streamHealthyRef = useRef(false);

  // Box-Settling: Drift zwischen zwei aufeinanderfolgenden ONNX-Ergebnissen
  const prevBoxRef    = useRef<CardBox | null>(null); // letztes ONNX-Ergebnis
  const boxDeltaRef   = useRef<number>(Infinity);     // Positions-/Größen-Drift in px

  // Aufeinanderfolgende ONNX-Treffer (Fallback-Trigger ohne Box-Settling)
  const consecutiveDetectRef = useRef(0);

  // Szenen-Änderungs-Cooldown: Snapshot beim Snap + Change-Detection
  const waitForChangeRef     = useRef(false);
  const capturedSampleRef    = useRef<ImageData | null>(null);
  const changeReadyAtRef     = useRef<number>(0);

  // Overlay-Skalierung (aus drawOverlay) für Snap-Animation-Positionierung
  const snapScaleRef = useRef<{ scale: number; ox: number; oy: number } | null>(null);

  // Geglättete Box für flüssiges Overlay-Rendering (Lerp zur ONNX-Zielbox bei 60fps)
  const lerpBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  const [streamReady, setStreamReady] = useState(false);
  // Front/Rück-Switch entfernt — Stream nutzt immer environment (Rückkamera).
  const facingMode = 'environment' as const;
  const [torch,      setTorch]      = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [progress,   setProgress]   = useState(0);
  const [detected,   setDetected]   = useState(false);
  const [inCooldown, setInCooldown] = useState(false);
  const [flashing,   setFlashing]   = useState(false);
  const [snapAnim,   setSnapAnim]   = useState<{
    left: number; top: number; width: number; height: number; phase: 'burst' | 'fade';
  } | null>(null);
  const [debug,      setDebug]      = useState<DebugInfo>({
    conf: 0, mse: 0, stable: 0, boxDelta: Infinity, consecutiveFrames: 0,
    detected: false, sessionReady: false, cropSize: '–', triggerReason: '–', changeMse: 0,
  });

  // Mount-Counter in sessionStorage hochzählen — überlebt iOS-PWA-Reloads.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { sessionStorage.setItem(CAM_MOUNT_KEY, String(initialReloadCount + 1)); }
    catch { /* ignorieren */ }
  }, []);

  // ONNX-Session eager beim Mount laden — parallel zum "Kamera starten"-
  // Overlay (User tippt ~1s nach Mount, Stream-Setup nochmal ~1s; in der
  // Zeit lädt das ~11 MB Modell). Reload-Mitigation (Lazy nach streamReady)
  // ist nicht mehr nötig seit der iOS-PWA-Stack stabil läuft.
  useEffect(() => {
    loadCardDetectorSession()
      .then(() => { sessionReadyRef.current = true; })
      .catch(console.warn);
  }, []);

  // ── Overlay: ONNX-Box oder gestrichelter Hilfsrahmen ─────────────────────
  // Läuft im rAF-Loop (60fps) → Lerp macht den Rahmen flüssig
  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const dispW = overlay.clientWidth;
    const dispH = overlay.clientHeight;
    if (!dispW || !dispH) return;
    // Canvas nur bei Größenänderung neu dimensionieren (verhindert State-Reset bei 60fps)
    if (overlay.width  !== dispW) overlay.width  = dispW;
    if (overlay.height !== dispH) overlay.height = dispH;
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.setLineDash([]); // Reset nach möglichem gestricheltem Hilfsrahmen

    const video = videoRef.current;
    const vw = video?.videoWidth  ?? 0;
    const vh = video?.videoHeight ?? 0;

    const target = onnxBoxRef.current;
    if (target && vw && vh) {
      // Skalierung: Video-Koordinaten → Bildschirmkoordinaten (object-cover)
      const vAsp = vw / vh, dAsp = dispW / dispH;
      let scale: number, ox: number, oy: number;
      if (vAsp > dAsp) { scale = dispH / vh; ox = -(vw * scale - dispW) / 2; oy = 0; }
      else             { scale = dispW / vw; ox = 0; oy = -(vh * scale - dispH) / 2; }
      snapScaleRef.current = { scale, ox, oy };

      // Exponentielles Lerp: Box fließend zur ONNX-Zielposition bewegen (60fps)
      const LERP_F = 0.28;
      const prev = lerpBoxRef.current;
      const lb = prev ? {
        x: prev.x + (target.x - prev.x) * LERP_F,
        y: prev.y + (target.y - prev.y) * LERP_F,
        w: prev.w + (target.w - prev.w) * LERP_F,
        h: prev.h + (target.h - prev.h) * LERP_F,
      } : { x: target.x, y: target.y, w: target.w, h: target.h };
      lerpBoxRef.current = lb;

      // Weißer Erkennungsrahmen — grüner Burst beim Snap übernimmt als Animation
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(255,255,255,0.35)';
      ctx.shadowBlur  = 10;

      const settled = boxDeltaRef.current < BOX_SETTLED_THRESHOLD;
      if (settled && target.corners?.length === 4) {
        // Box stabil → präzisen rotierten Rahmen aus Segmentierungsmaske
        const pts = target.corners.map(
          ([x, y]) => [x * scale + ox, y * scale + oy] as [number, number]
        );
        drawRoundedPolygon(ctx, pts, 14);
      } else {
        // Box noch am Einschwingen → geglättete AABB (ruckelfrei dank Lerp)
        ctx.beginPath();
        ctx.roundRect(lb.x * scale + ox, lb.y * scale + oy, lb.w * scale, lb.h * scale, 14);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fill();
      return;
    }

    // Kein Treffer → Lerp zurücksetzen + gestrichelter Hilfsrahmen
    lerpBoxRef.current = null;
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

  // ── rAF-Loop: Overlay bei 60fps rendern (Lerp macht Box flüssig) ──────────
  useEffect(() => {
    let raf: number;
    const loop = () => { drawOverlay(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [drawOverlay]);

  // ── Kamera starten ────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    // Vorhandenen Stream wiederverwenden — verhindert Permission-Dialog
    // wenn z.B. der Nutzer nach Track-Ended das 'Tippe zum Neustart'-Overlay
    // antippt, der Stream aber doch noch lebt.
    const existingTrack = _kameraStream?.getVideoTracks()[0];
    if (existingTrack && existingTrack.readyState !== 'ended') {
      const currentFacing = existingTrack.getSettings().facingMode;
      if (!currentFacing || currentFacing === facingMode) {
        streamRef.current = _kameraStream;
        const vid = videoRef.current;
        if (vid) {
          // srcObject nur setzen wenn nötig — verhindert iOS-Kamera-Indikator bei
          // unnötigem Re-Attach (iOS zeigt gelben Punkt bei jeder srcObject-Zuweisung)
          if (vid.srcObject !== _kameraStream) {
            vid.srcObject = _kameraStream;
          }
          // play() nur wenn Video wirklich pausiert ist (nicht nochmals triggern)
          if (vid.paused) {
            vid.play().catch(() => { /* iOS blockiert manchmal; kein fataler Fehler */ });
          }
        }
        streamHealthyRef.current = true;
        setStreamReady(true);
        return; // Kein neuer getUserMedia-Call
      }
    }

    // Neuen Stream öffnen
    _kameraStream?.getTracks().forEach(t => t.stop());
    _kameraStream = null;
    streamRef.current = null;
    setError(null); stableRef.current = 0; setProgress(0); setDetected(false);
    startingRef.current = true; // Visibility-Handler blockiert ab hier
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      _kameraStream = stream;
      streamRef.current = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        streamHealthyRef.current = false;
        setError('interrupted');
      });
      const vid = videoRef.current;
      if (vid) {
        if (vid.srcObject !== stream) vid.srcObject = stream;
        if (vid.paused) vid.play().catch(() => {});
      }
      streamHealthyRef.current = true; // erst NACH erfolgreicher Anbindung
      setStreamReady(true);            // triggert lazyen ONNX-Load
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      setError(name === 'NotAllowedError' ? 'blocked' : 'failed');
    } finally {
      startingRef.current = false;
    }
  }, [facingMode]);

  useEffect(() => {
    // Kein Auto-Start: getUserMedia darf nur als direkte Reaktion auf einen
    // Nutzer-Tap laufen. `active` wird vom Parent (Footer-FAB) gesetzt.
    if (!active) {
      // Wenn vorher aktiv war und jetzt nicht mehr → Stream sauber stoppen
      _kameraStream?.getTracks().forEach(t => t.stop());
      _kameraStream = null;
      streamRef.current = null;
      streamHealthyRef.current = false;
      setStreamReady(false);
      return;
    }
    startCamera();
    return () => {
      _kameraStream?.getTracks().forEach(t => t.stop());
      _kameraStream = null;
      streamRef.current = null;
    };
  }, [startCamera, active]);

  // ── App-Resume nach iOS-Background-Suspend ───────────────────────────────
  // iOS beendet Camera-Tracks wenn die PWA in den Hintergrund geht (Hardware
  // wird freigegeben). Wir starten die Kamera NICHT automatisch neu —
  // sonst poppt unerwartet ein Permission-Dialog auf während der Nutzer noch
  // gar nicht wieder im Scanner ist. Stattdessen:
  //   • Track-'ended'-Listener (in startCamera) zeigt 'Tippe zum Neustart'-UI
  //   • Bei sichtbarer App ohne Stream: ebenfalls Tippe-UI zeigen
  // So ist der Dialog immer eine direkte Reaktion auf einen Nutzer-Tap.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!active) return; // Nicht aktiv → nichts zu prüfen
      // iOS feuert visibilitychange wenn der Permission-Dialog erscheint/geht.
      // Während getUserMedia in-flight ist → Handler ignorieren, sonst rennen wir
      // gegen einen halb-acquireten Stream und feuern fälschlich 'interrupted'.
      if (startingRef.current) return;
      // Wenn wir nie einen Stream hatten → kein Anlass für 'interrupted'
      // (Startflow läuft noch oder Error-UI ist bereits aktiv).
      if (!streamHealthyRef.current) return;
      const track = _kameraStream?.getVideoTracks()[0];
      const vid   = videoRef.current;
      if (track && track.readyState === 'live' && vid && !vid.paused) return;
      setError('interrupted');
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [active]);

  // ── Foto auslösen ─────────────────────────────────────────────────────────
  const doCapture = useCallback(() => {
    if (cooldownRef.current || paused) return;
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);

    // Karte ausschneiden — Deskew wenn Corners bekannt, sonst AABB-Crop
    const box = onnxBoxRef.current;
    let imageBase64: string;
    let cropInfo = `${canvas.width}×${canvas.height} (voll)`;

    if (box?.corners?.length === 4) {
      // ── Corners-AABB-Crop ───────────────────────────────────────────────────
      // Achsenparalleler Bounding-Box der 4 Corners + großzügiges Padding.
      // Landscape-Video (1920×1080): die Corners spannen die Karte korrekt auf,
      // auch bei Neigung. Kein Deskew nötig — Gemini erkennt geneigte Karten.
      const xs   = box.corners.map(([x]) => x);
      const ys   = box.corners.map(([, y]) => y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const bw   = maxX - minX;
      const bh   = maxY - minY;
      // Konservatives Padding: Eckpunkte liegen bereits nah an Kartenkanten
      const padX = Math.round(bw * 0.05) + CROP_PADDING;
      const padY = Math.round(bh * 0.08) + CROP_PADDING;
      const cx   = Math.max(0, Math.round(minX - padX));
      const cy   = Math.max(0, Math.round(minY - padY));
      const cw   = Math.min(canvas.width  - cx, Math.round(bw + padX * 2));
      const ch   = Math.min(canvas.height - cy, Math.round(bh + padY * 2));
      imageBase64 = encodeCropToJpeg(canvas, cx, cy, cw, ch);
      cropInfo    = `${cw}×${ch} (corners)`;

    } else if (box && box.w > 50 && box.h > 50) {
      // ── Fallback: ONNX-AABB mit konservativem Padding ──────────────────────
      const padX = Math.max(CROP_PADDING, Math.round(box.w * 0.05));
      const padY = Math.max(CROP_PADDING, Math.round(box.h * 0.08));
      const cx   = Math.max(0, Math.round(box.x - padX));
      const cy   = Math.max(0, Math.round(box.y - padY));
      const cw   = Math.min(canvas.width  - cx, Math.round(box.w + padX * 2));
      const ch   = Math.min(canvas.height - cy, Math.round(box.h + padY * 2));
      imageBase64 = encodeCropToJpeg(canvas, cx, cy, cw, ch);
      cropInfo    = `${cw}×${ch} (aabb)`;
    } else {
      imageBase64 = encodeCropToJpeg(canvas, 0, 0, canvas.width, canvas.height);
    }

    cropSizeRef.current = cropInfo;
    onCaptureRef.current(imageBase64, 'image/jpeg');

    // Weißer Blitz
    setFlashing(true); setTimeout(() => setFlashing(false), 180);

    // Rahmen-Burst-Animation: Bildschirmkoordinaten jetzt berechnen (nicht erst beim Render)
    // — verhindert Timing-Probleme wenn snapScaleRef sich zwischen Snap und Render ändert
    const snapBox = onnxBoxRef.current;
    const ss = snapScaleRef.current;
    if (snapBox && ss) {
      setSnapAnim({
        left:   snapBox.x * ss.scale + ss.ox,
        top:    snapBox.y * ss.scale + ss.oy,
        width:  snapBox.w * ss.scale,
        height: snapBox.h * ss.scale,
        phase:  'burst',
      });
      setTimeout(() => setSnapAnim(s => s ? { ...s, phase: 'fade' } : null), 80);
      setTimeout(() => setSnapAnim(null), 380);
    }

    stableRef.current = 0; setProgress(0); setDetected(false);
    prevBoxRef.current = null; boxDeltaRef.current = Infinity;

    // Snapshot des Motion-Sample-Canvas für Szenen-Änderungs-Erkennung
    const s = sampleRef.current;
    if (s) {
      capturedSampleRef.current = s.getContext('2d')!.getImageData(0, 0, s.width, s.height);
    }

    // Cooldown: Ende wird durch Szenen-Änderung ausgelöst (nicht per Timer).
    // SNAP_COOLDOWN_MIN_MS verhindert sofortigen Doppel-Snap.
    cooldownRef.current      = true;
    setInCooldown(true);
    waitForChangeRef.current = true;
    changeReadyAtRef.current = Date.now() + SNAP_COOLDOWN_MIN_MS;
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
              // Box-Delta: Drift des Mittelpunkts + Größe zwischen zwei ONNX-Frames
              const prev = prevBoxRef.current;
              if (prev) {
                const dCx = (box.x + box.w / 2) - (prev.x + prev.w / 2);
                const dCy = (box.y + box.h / 2) - (prev.y + prev.h / 2);
                boxDeltaRef.current = Math.hypot(dCx, dCy) + Math.abs(box.w - prev.w) * 0.3;
              } else {
                boxDeltaRef.current = Infinity; // erster Treffer → noch nicht settled
              }
              prevBoxRef.current    = box;
              onnxBoxRef.current    = box;
              onnxStickyRef.current = ONNX_STICKY;
              consecutiveDetectRef.current += 1; // Zähler für Fallback-Trigger
            } else {
              onnxStickyRef.current = Math.max(0, onnxStickyRef.current - 1);
              if (onnxStickyRef.current === 0) {
                // Karte aus dem Bild — Overlay + Zähler zurücksetzen
                onnxBoxRef.current           = null;
                prevBoxRef.current           = null;
                boxDeltaRef.current          = Infinity;
                consecutiveDetectRef.current = 0; // frische Erkennung für nächste Karte
                // Cooldown läuft per Timer — hier kein Eingriff nötig
              }
            }
          }).catch(() => {
            onnxBoxRef.current           = null;
            onnxStickyRef.current        = 0;
            prevBoxRef.current           = null;
            boxDeltaRef.current          = Infinity;
            consecutiveDetectRef.current = 0;
          }).finally(() => {
            inferringRef.current = false;
          });
        }
        const cardDetected = onnxBoxRef.current !== null;

        // 3. Detected-State (Overlay läuft separat im rAF-Loop)
        setDetected(cardDetected);

        // 4. MSE
        let mse = 0, mc = 0;
        for (let i = 0; i < sData.length; i += 32) {
          const d = sData[i] - pData[i]; mse += d * d; mc++;
        }
        mse = mc > 0 ? mse / mc : 0;
        pCtx.drawImage(sample, 0, 0);

        // 5. Szenen-Änderungs-Erkennung: Cooldown per Snapshot-Vergleich beenden
        //    WICHTIG: changeDetectedThisTick verhindert, dass im SELBEN Tick
        //    Cooldown endet UND Snap auslöst (Race Condition → Doppel-Snap).
        let changeMse = 0;
        let changeDetectedThisTick = false;
        if (waitForChangeRef.current && Date.now() >= changeReadyAtRef.current) {
          const cap = capturedSampleRef.current;
          if (cap) {
            let cSum = 0, cCount = 0;
            for (let ci = 0; ci < sData.length && ci < cap.data.length; ci += 32) {
              const d = sData[ci] - cap.data[ci]; cSum += d * d; cCount++;
            }
            changeMse = cCount > 0 ? Math.round(cSum / cCount) : 0;
            if (changeMse > CHANGE_DETECT_THRESHOLD) {
              // Szene hat sich verändert → Cooldown beenden
              changeDetectedThisTick       = true; // Snap in DIESEM Tick blocken
              waitForChangeRef.current     = false;
              cooldownRef.current          = false;
              setInCooldown(false);
              // ONNX-State komplett zurücksetzen → erzwingt frische Erkennung
              // Verhindert Sofort-Snap nach Change-Detection (Box war noch settled)
              onnxBoxRef.current           = null;
              onnxStickyRef.current        = 0;
              prevBoxRef.current           = null;
              boxDeltaRef.current          = Infinity;
              lerpBoxRef.current           = null;
              consecutiveDetectRef.current = 0;
              stableRef.current            = 0;
              setProgress(0);
            }
          }
        }

        // 6. Snap-Trigger — zwei Pfade:
        //    A) Box-Delta settled (genau, aber langsam)
        //    B) N aufeinanderfolgende Treffer (Fallback für Stativ/Scanning-Station)
        const consFrames      = consecutiveDetectRef.current;
        const boxSettled      = boxDeltaRef.current < BOX_SETTLED_THRESHOLD;
        const consecutiveOk   = consFrames >= CONSECUTIVE_SNAP_FRAMES;
        // changeDetectedThisTick: Snap erst im nächsten Tick möglich (Race-Condition-Schutz)
        const snapCondition   = !cooldownRef.current && !changeDetectedThisTick && cardDetected && mse < MOTION_SNAP_THRESHOLD;
        const triggerReason   = boxSettled ? 'delta' : consecutiveOk ? 'consecutive' : '–';

        // 7. Debug-State aktualisieren
        setDebug({
          conf:              onnxBoxRef.current?.conf ?? 0,
          mse:               Math.round(mse),
          stable:            stableRef.current,
          boxDelta:          isFinite(boxDeltaRef.current) ? Math.round(boxDeltaRef.current) : 999,
          consecutiveFrames: consFrames,
          detected:          cardDetected,
          sessionReady:      sessionReadyRef.current,
          cropSize:          cropSizeRef.current,
          triggerReason,
          changeMse,
        });

        if (snapCondition && (boxSettled || consecutiveOk)) {
          stableRef.current += 1;
          setProgress(1);
          if (stableRef.current >= SNAP_STABLE_FRAMES) doCapture();
        } else if (!cooldownRef.current) {
          stableRef.current = 0;
          if (cardDetected) {
            // Progress: beste der beiden Konvergenz-Metriken
            const byDelta  = isFinite(boxDeltaRef.current)
              ? Math.max(0, 1 - boxDeltaRef.current / (BOX_SETTLED_THRESHOLD * 3))
              : 0;
            const byFrames = Math.min(consFrames / CONSECUTIVE_SNAP_FRAMES, 0.95);
            setProgress(Math.max(byDelta, byFrames));
          } else {
            setProgress(0);
          }
        }
      }, CHECK_MS);
    }, 300);

    return () => { clearTimeout(delay); if (timerRef.current) clearInterval(timerRef.current); };
  }, [doCapture, paused]);

  // ── Taschenlampe ─────────────────────────────────────────────────────────
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(t => !t); }
    catch { /* nicht unterstützt */ }
  };

  return (
    <div
      className="relative w-full h-full bg-black overflow-hidden"
      onClick={!inCooldown && !paused ? doCapture : undefined}
    >
      {/* Versteckte Canvases */}
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={sampleRef} width={SAMPLE_W} height={SAMPLE_H} className="hidden" />
      <canvas ref={prevRef}   width={SAMPLE_W} height={SAMPLE_H} className="hidden" />

      {!active ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
            <Camera size={28} color="rgba(255,255,255,0.5)" />
          </div>
          <p className="text-sm text-white/55 max-w-xs">
            Tippe auf den Kamera-Button unten, um den Stream zu starten.
          </p>
        </div>
      ) : error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center gap-4">
          {error === 'interrupted' && (
            <>
              <p className="text-base text-white font-semibold">
                Kamera wurde unterbrochen
              </p>
              <p className="text-sm text-white/60 max-w-xs">
                iOS hat den Kamera-Zugriff pausiert (z.B. weil eine andere App
                die Kamera kurzzeitig nutzte oder die PWA im Hintergrund war).
              </p>
              <button
                onClick={() => { streamHealthyRef.current = false; setError(null); startCamera(); }}
                className="mt-2 px-6 py-3 rounded-xl font-semibold text-white"
                style={{ background: 'var(--pokedex-red)' }}
              >
                Tippe zum Neustart
              </button>
            </>
          )}
          {error === 'blocked' && (
            <>
              <p className="text-base text-white font-semibold">
                Kamera-Zugriff blockiert
              </p>
              <p className="text-sm text-white/70 max-w-xs leading-relaxed">
                Damit der Permission-Dialog nicht immer wieder erscheint:
              </p>
              <p className="text-sm text-white/90 max-w-xs leading-relaxed">
                <strong>Einstellungen → Safari → Kamera → „Erlauben"</strong>
                <br />
                (gilt global für alle Websites)
              </p>
              <button
                onClick={() => { streamHealthyRef.current = false; setError(null); startCamera(); }}
                className="mt-2 px-6 py-3 rounded-xl font-semibold text-white"
                style={{ background: 'var(--pokedex-red)' }}
              >
                Erneut versuchen
              </button>
            </>
          )}
          {error === 'failed' && (
            <>
              <p className="text-sm text-white/60">
                Kamera konnte nicht gestartet werden.
              </p>
              <button
                onClick={() => { streamHealthyRef.current = false; setError(null); startCamera(); }}
                className="mt-2 px-6 py-3 rounded-xl font-semibold text-white"
                style={{ background: 'var(--pokedex-red)' }}
              >
                Erneut versuchen
              </button>
            </>
          )}
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

          {/* Rahmen-Burst: grüner dicker Rahmen leuchtet auf und faded weg (Foto gemacht) */}
          {snapAnim && (
            <div
              className="absolute pointer-events-none"
              style={{
                left:   snapAnim.left,
                top:    snapAnim.top,
                width:  snapAnim.width,
                height: snapAnim.height,
                borderRadius: 14,
                border: '5px solid #48bb78',
                boxShadow: '0 0 28px rgba(72,187,120,0.95), inset 0 0 14px rgba(72,187,120,0.2)',
                opacity:   snapAnim.phase === 'burst' ? 1 : 0,
                transform: snapAnim.phase === 'burst' ? 'scale(1.05)' : 'scale(1.0)',
                transition: snapAnim.phase === 'fade'
                  ? 'opacity 300ms ease-out, transform 300ms ease-out'
                  : 'none',
                transformOrigin: 'center',
                zIndex: 5,
              }}
            />
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

          {/* Taschenlampen-Switch oben links */}
          <div
            className="absolute left-3 flex flex-col gap-2 pointer-events-auto"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)', zIndex: 4 }}
            onClick={e => e.stopPropagation()}
          >
            <button onClick={toggleTorch} className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
              {torch ? <Zap size={17} color="#facc15" /> : <ZapOff size={17} color="#fff" />}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
