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

const CHECK_MS               = 150; // ONNX-Inferenz ~80ms → etwas mehr Budget
const MOTION_RESET_THRESHOLD = 800;
const CARD_DETECT_VARIANCE   = 80;   // niedrig → Detection läuft fast immer
const SNAP_STABLE_FRAMES     = 7;  // ~1 s Ruhe mit erkanntem Quad → Auslöser
const SNAP_STABLE_FALLBACK   = 8;  // ~1,2 s Ruhe ohne Quad (ONNX-only Modus)
const SNAP_COOLDOWN_MS       = 2000;

// Analyse-Canvas: feste Größe für konsistente Erkennung
const EDGE_W = 320;
const EDGE_H = 448; // ~1.4 Seitenverhältnis
// Anteil des Videobilds der analysiert wird (groß = auch außermittige Karten)
const DETECT_FRACTION = 0.90;

// ─── Canny + Hough-Transform Kartenerkennung ─────────────────────────────
interface CardQuad {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  bl: { x: number; y: number };
  br: { x: number; y: number };
}

// Einmalig beim Laden: sin/cos-Tabellen (werden im Hough-Hot-Loop genutzt)
const HOUGH_N = 180;
const COS_LUT = new Float32Array(HOUGH_N);
const SIN_LUT = new Float32Array(HOUGH_N);
for (let t = 0; t < HOUGH_N; t++) {
  const r = (t * Math.PI) / 180;
  COS_LUT[t] = Math.cos(r);
  SIN_LUT[t] = Math.sin(r);
}
// Hough-Akkumulator vorab allozieren (wiederverwendet, kein GC-Druck)
const _HMAXRHO   = Math.ceil(Math.sqrt(320 * 320 + 448 * 448)); // ≈ 552
const _HROFF     = _HMAXRHO;
const _HRRANGE   = 2 * _HMAXRHO + 1;                            // ≈ 1105
const _HACC      = new Int32Array(HOUGH_N * _HRRANGE);           // ≈ 800 KB
const _HSUP      = new Uint8Array(HOUGH_N * _HRRANGE);           // ≈ 200 KB

/** Gauß-Blur 5×5 — separabler Kernel [1,4,6,4,1]/16 */
function gaussBlur(gray: Uint8Array, W: number, H: number): Uint8Array {
  const K = [1, 4, 6, 4, 1];
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, w = 0;
      for (let d = -2; d <= 2; d++) {
        const xi = x + d;
        if (xi >= 0 && xi < W) { s += gray[y * W + xi] * K[d + 2]; w += K[d + 2]; }
      }
      tmp[y * W + x] = (s / w + 0.5) | 0;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, w = 0;
      for (let d = -2; d <= 2; d++) {
        const yi = y + d;
        if (yi >= 0 && yi < H) { s += tmp[yi * W + x] * K[d + 2]; w += K[d + 2]; }
      }
      out[y * W + x] = (s / w + 0.5) | 0;
    }
  }
  return out;
}

/** Sobel: L1-Magnitude + quantisierte Richtung (4 Bins) */
function sobelGrad(px: Uint8Array, W: number, H: number): { mag: Uint16Array; dir: Uint8Array } {
  const mag = new Uint16Array(W * H);
  const dir = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const tl=px[(y-1)*W+(x-1)], tc=px[(y-1)*W+x], tr=px[(y-1)*W+(x+1)];
      const ml=px[ y   *W+(x-1)],                    mr=px[ y   *W+(x+1)];
      const bl=px[(y+1)*W+(x-1)], bc=px[(y+1)*W+x], br=px[(y+1)*W+(x+1)];
      const gx = -tl - 2*ml - bl + tr + 2*mr + br;
      const gy = -tl - 2*tc - tr + bl + 2*bc + br;
      mag[y*W+x] = Math.min(Math.abs(gx) + Math.abs(gy), 65535);
      const a = ((Math.atan2(gy, gx) * 180 / Math.PI) + 180) % 180;
      dir[y*W+x] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
    }
  }
  return { mag, dir };
}

/** Non-Maximum-Suppression — Kanten auf 1px Breite ausdünnen */
function nmsSup(mag: Uint16Array, dir: Uint8Array, W: number, H: number): Uint16Array {
  const out = new Uint16Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const m = mag[y*W+x];
      if (!m) continue;
      let n1: number, n2: number;
      switch (dir[y*W+x]) {
        case 0: n1=mag[y*W+(x-1)];     n2=mag[y*W+(x+1)];     break;
        case 1: n1=mag[(y-1)*W+(x+1)]; n2=mag[(y+1)*W+(x-1)]; break;
        case 2: n1=mag[(y-1)*W+x];     n2=mag[(y+1)*W+x];     break;
        default:n1=mag[(y-1)*W+(x-1)]; n2=mag[(y+1)*W+(x+1)]; break;
      }
      if (m >= n1 && m >= n2) out[y*W+x] = m;
    }
  }
  return out;
}

/** Hysterese-Schwellwert + BFS → binäre Kantenkarte */
function cannyHyst(nmsPx: Uint16Array, W: number, H: number): Uint8Array {
  const N = W * H;
  const hist = new Int32Array(1024);
  let total = 0;
  for (let i = 0; i < N; i++) {
    const v = Math.min(nmsPx[i], 1023);
    if (v > 0) { hist[v]++; total++; }
  }
  if (!total) return new Uint8Array(N);
  // High = 65. Perzentil der Nicht-Null-Pixel (weniger aggressiv als 80.)
  let cum = 0, hi = 10;
  const t65 = Math.floor(total * 0.65);
  for (let v = 0; v < 1024; v++) { cum += hist[v]; if (cum >= t65) { hi = v; break; } }
  const lo = Math.round(hi * 0.4);

  const mark = new Uint8Array(N);
  const q    = new Int32Array(N);
  let qn = 0;
  for (let i = 0; i < N; i++) {
    if (nmsPx[i] >= hi)      { mark[i] = 2; q[qn++] = i; }
    else if (nmsPx[i] >= lo) { mark[i] = 1; }
  }
  const DX = [-1,0,1,-1,1,-1,0,1];
  const DY = [-1,-1,-1,0,0,1,1,1];
  for (let qi = 0; qi < qn; qi++) {
    const idx = q[qi];
    const iy = (idx / W) | 0, ix = idx % W;
    for (let d = 0; d < 8; d++) {
      const nx = ix + DX[d], ny = iy + DY[d];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (mark[ni] === 1) { mark[ni] = 2; q[qn++] = ni; }
    }
  }
  const edges = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (mark[i] === 2) edges[i] = 255;
  return edges;
}

/** Hough-Transform: befüllt _HACC (vorab alloziiert) */
function houghAcc(edges: Uint8Array, W: number, H: number): void {
  _HACC.fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!edges[y * W + x]) continue;
      for (let t = 0; t < HOUGH_N; t++) {
        const rho = Math.round(x * COS_LUT[t] + y * SIN_LUT[t]);
        _HACC[t * _HRRANGE + _HROFF + rho]++;
      }
    }
  }
}

/** Vier dominante Linien aus Hough-Akkumulator (2 horizontal + 2 vertikal) */
function fourLines(W: number, H: number): Array<{ t: number; rho: number }> | null {
  // Lokale Maxima (3×3-Fenster, mindestens 20 Stimmen) sammeln
  // → filtert schwache Schatten-/Hintergrundlinien sofort heraus
  type P = { t: number; rho: number; v: number };
  const cands: P[] = [];
  for (let t = 0; t < HOUGH_N; t++) {
    for (let ri = 1; ri < _HRRANGE - 1; ri++) {
      const v = _HACC[t * _HRRANGE + ri];
      if (v < 20) continue;
      let ok = true;
      for (let dt = -1; dt <= 1 && ok; dt++) {
        for (let dr = -1; dr <= 1 && ok; dr++) {
          if (!dt && !dr) continue;
          const tt = (t + dt + HOUGH_N) % HOUGH_N;
          const rr = ri + dr;
          if (rr >= 0 && rr < _HRRANGE && _HACC[tt * _HRRANGE + rr] > v) ok = false;
        }
      }
      if (ok) cands.push({ t, rho: ri - _HROFF, v });
    }
  }
  cands.sort((a, b) => b.v - a.v);

  // Greedy Non-Max-Suppression im Akkumulator-Raum
  const T_R = 20, R_R = 15;
  _HSUP.fill(0);
  const sel: P[] = [];
  for (const p of cands) {
    const ri = p.rho + _HROFF;
    if (_HSUP[p.t * _HRRANGE + ri]) continue;
    sel.push(p);
    for (let dt = -T_R; dt <= T_R; dt++) {
      for (let dr = -R_R; dr <= R_R; dr++) {
        const tt = (p.t + dt + HOUGH_N) % HOUGH_N;
        const rr = ri + dr;
        if (rr >= 0 && rr < _HRRANGE) _HSUP[tt * _HRRANGE + rr] = 1;
      }
    }
    if (sel.length >= 30) break;
  }

  // theta ≈ 90° → horizontale Linie (Ober-/Unterkante der Karte)
  // theta ≈ 0°/180° → vertikale Linie (Links-/Rechtskante)
  // Breiter Winkelbereich: erlaubt Neigung bis ±30°
  const hL = sel.filter(p => p.t >= 58 && p.t <= 122);
  const vL = sel.filter(p => p.t <= 30 || p.t >= 150);

  const pick2 = (ps: P[], minDist: number): [P, P] | null => {
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++)
        if (Math.abs(ps[i].rho - ps[j].rho) >= minDist) return [ps[i], ps[j]];
    return null;
  };

  const hPair = pick2(hL, H * 0.20);
  const vPair = pick2(vL, W * 0.15);
  if (!hPair || !vPair) return null;

  // Qualitätsschwelle: jede der 4 Linien muss mindestens 15 Stimmen haben.
  // Min. Karte ~20% Breite = 64px; nach Canny ~60% Überleben → ~38 Stimmen.
  // 15 lässt auch bei Unschärfe/Winkel noch echte Karten durch.
  const MIN_V = 15;
  if (hPair[0].v < MIN_V || hPair[1].v < MIN_V) return null;
  if (vPair[0].v < MIN_V || vPair[1].v < MIN_V) return null;

  // Sortieren: kleines rho → oben/links
  const [h1, h2] = hPair[0].rho < hPair[1].rho ? hPair : [hPair[1], hPair[0]];
  const [v1, v2] = vPair[0].rho < vPair[1].rho ? vPair : [vPair[1], vPair[0]];
  return [h1, h2, v1, v2];
}

/** Schnittpunkt zweier Hough-Linien (Cramer-Regel) */
function lineXsect(t1: number, r1: number, t2: number, r2: number): { x: number; y: number } | null {
  const det = COS_LUT[t1] * SIN_LUT[t2] - COS_LUT[t2] * SIN_LUT[t1];
  if (Math.abs(det) < 1e-6) return null;
  return {
    x: (r1 * SIN_LUT[t2] - r2 * SIN_LUT[t1]) / det,
    y: (r2 * COS_LUT[t1] - r1 * COS_LUT[t2]) / det,
  };
}

/** Vier Schnittpunkte validieren und in tl/tr/bl/br sortieren */
function toQuad(pts: Array<{ x: number; y: number } | null>, W: number, H: number): CardQuad | null {
  if (pts.some(p => !p)) return null;
  const pp = pts as Array<{ x: number; y: number }>;
  const M = 12;
  if (pp.some(p => p.x < -M || p.x > W + M || p.y < -M || p.y > H + M)) return null;
  const s   = [...pp].sort((a, b) => a.y - b.y);
  const top = s.slice(0, 2).sort((a, b) => a.x - b.x);
  const bot = s.slice(2).sort((a, b) => a.x - b.x);
  const [tl, tr, bl, br] = [top[0], top[1], bot[0], bot[1]];
  const cw = ((tr.x - tl.x) + (br.x - bl.x)) / 2;
  const ch = ((bl.y - tl.y) + (br.y - tr.y)) / 2;
  if (cw < W * 0.18 || ch < H * 0.22) return null;
  const asp = ch / cw;
  // Pokémon-Karten: 63×88mm = Ratio 1.397 — Spielraum für Perspektive/Winkel
  if (asp < 1.15 || asp > 1.75) return null;
  return { tl, tr, bl, br };
}

/** Pokémon-Karte via Canny-Kanten + Hough-Transform erkennen */
function detectCard(data: Uint8ClampedArray, W: number, H: number): CardQuad | null {
  // Graustufen
  const gray = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = (data[i*4]*77 + data[i*4+1]*150 + data[i*4+2]*29) >> 8;
  }
  // Canny-Pipeline: Blur → Sobel → NMS → Hysterese
  const blurred       = gaussBlur(gray, W, H);
  const { mag, dir }  = sobelGrad(blurred, W, H);
  const nmsPx         = nmsSup(mag, dir, W, H);
  const edges         = cannyHyst(nmsPx, W, H);

  // Edge-Count Gate: zu wenige Kanten → leeres Bild
  let ec = 0;
  for (let i = 0; i < edges.length; i++) if (edges[i]) ec++;
  if (ec < 30) return null;

  // Hough-Transform + 4 dominante Linien
  houghAcc(edges, W, H);
  const lines = fourLines(W, H);
  if (!lines) return null;
  const [h1, h2, v1, v2] = lines;

  // Schnittpunkte → CardQuad
  return toQuad([
    lineXsect(h1.t, h1.rho, v1.t, v1.rho),
    lineXsect(h1.t, h1.rho, v2.t, v2.rho),
    lineXsect(h2.t, h2.rho, v1.t, v1.rho),
    lineXsect(h2.t, h2.rho, v2.t, v2.rho),
  ], W, H);
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
  const stableRef    = useRef(0);
  const cooldownRef  = useRef(false);
  const onCaptureRef = useRef(onCapture);
  // Quad-Stabilisierung: Rahmen springt nicht bei Einzelframe-Falschpositivem
  const lastQuadRef  = useRef<CardQuad | null>(null);
  const quadFrameRef = useRef(0); // aufeinanderfolgende Frames mit ähnlichem Quad
  // Letztes ONNX-Ergebnis in Video-Koordinaten (für Overlay + Snap-Trigger)
  const onnxBoxRef   = useRef<CardBox | null>(null);
  // Sticky-Counter: ONNX-Ergebnis bleibt für N Frames erhalten nach letzter Erkennung.
  // Verhindert, dass einzelne Ausreißer-Frames den Snap-Counter resetten.
  const onnxStickyRef = useRef(0);
  const ONNX_STICKY   = 4; // Frames die ein positives Ergebnis "überbrückt"
  // Verhindert überlappende ONNX-Inferenz-Aufrufe
  const inferringRef = useRef(false);
  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  // ONNX-Session beim Mount laden (im Hintergrund, blockiert UI nicht)
  useEffect(() => { loadCardDetectorSession().catch(console.warn); }, []);

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
    if (!vw || !vh) return;

    if (!quad) {
      // ONNX-Box: gelbes Rechteck wenn Karte erkannt aber kein Hough-Quad
      const box = onnxBoxRef.current;
      if (box && vw && vh) {
        const vAsp2 = vw / vh, dAsp2 = dispW / dispH;
        let scale2: number, ox2: number, oy2: number;
        if (vAsp2 > dAsp2) { scale2 = dispH / vh; ox2 = -(vw * scale2 - dispW) / 2; oy2 = 0; }
        else               { scale2 = dispW / vw; ox2 = 0; oy2 = -(vh * scale2 - dispH) / 2; }
        // box ist in Video-Koordinaten (sample-canvas auf Video gemappt)
        const bx = box.x * scale2 + ox2;
        const by = box.y * scale2 + oy2;
        const bw = box.w * scale2;
        const bh = box.h * scale2;
        ctx.strokeStyle = 'rgba(255, 200, 0, 0.75)';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(255,200,0,0.4)';
        ctx.shadowBlur  = 8;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.shadowBlur = 0;
        return;
      }

      // Statischer gestrichelter Kartenrahmen als Orientierungshilfe
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
      return;
    }

    // Grünes Viereck um erkannte Karte
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

        // 1b. ONNX: fire-and-forget (Ergebnis wird im nächsten Frame genutzt)
        // Überlappsschutz via inferringRef — sample ist in Video-Mitte-Koordinaten
        if (!inferringRef.current && vw > 0) {
          inferringRef.current = true;
          // Video direkt übergeben → Modell sieht das vollständige Bild, nicht nur den Mittenausschnitt
          detectCardInFrame(video).then(box => {
            if (box) {
              // Koordinaten sind bereits in Video-Space (Letterboxing schon rückgerechnet)
              onnxBoxRef.current  = box;
              onnxStickyRef.current = ONNX_STICKY;
            } else {
              // Kein Ergebnis → Sticky runterzählen, erst bei 0 wirklich löschen
              onnxStickyRef.current = Math.max(0, onnxStickyRef.current - 1);
              if (onnxStickyRef.current === 0) onnxBoxRef.current = null;
            }
          }).catch(() => {
            onnxBoxRef.current = null;
            onnxStickyRef.current = 0;
          }).finally(() => {
            inferringRef.current = false;
          });
        }
        const cardDetected = onnxBoxRef.current !== null;

        // 2. Hough-Kartenerkennung (für grünen Quad-Overlay, optional)
        let quad: CardQuad | null = null;
        let desx = 0, desy = 0, dw = 0, dh = 0;

        if (cardDetected) {
          dw = Math.min(Math.round(Math.min(vw, vh) * DETECT_FRACTION), vw);
          dh = Math.min(Math.round(dw * (EDGE_H / EDGE_W)), vh);
          desx = Math.max(0, (vw - dw) / 2);
          desy = Math.max(0, (vh - dh) / 2);

          const eCtx = edge.getContext('2d')!;
          eCtx.drawImage(video, desx, desy, dw, dh, 0, 0, EDGE_W, EDGE_H);
          quad = detectCard(eCtx.getImageData(0, 0, EDGE_W, EDGE_H).data, EDGE_W, EDGE_H);
        }

        // Quad-Stabilisierung: grüner Rahmen erscheint erst nach 2 konsekutiven
        // Frames mit ähnlicher Position (≤50px Mittelpunkt-Versatz).
        // Verhindert das Springen durch einzelne Falschpositive.
        let stableQuad: CardQuad | null = null;
        if (quad) {
          const prev = lastQuadRef.current;
          const cx = (quad.tl.x + quad.tr.x + quad.bl.x + quad.br.x) / 4;
          const cy = (quad.tl.y + quad.tr.y + quad.bl.y + quad.br.y) / 4;
          if (prev) {
            const pcx = (prev.tl.x + prev.tr.x + prev.bl.x + prev.br.x) / 4;
            const pcy = (prev.tl.y + prev.tr.y + prev.bl.y + prev.br.y) / 4;
            const dist = Math.sqrt((cx - pcx) ** 2 + (cy - pcy) ** 2);
            quadFrameRef.current = dist < 50 ? quadFrameRef.current + 1 : 1;
          } else {
            quadFrameRef.current = 1;
          }
          lastQuadRef.current = quad;
          if (quadFrameRef.current >= 2) stableQuad = quad;
        } else {
          quadFrameRef.current = 0;
          lastQuadRef.current = null;
        }

        drawOverlay(stableQuad, vw, vh, desx, desy, dw, dh);
        setDetected(!!stableQuad);

        // 3. Bewegungsmessung (MSE)
        let mse = 0, mc = 0;
        for (let i = 0; i < sData.length; i += 32) {
          const d = sData[i] - pData[i]; mse += d * d; mc++;
        }
        mse = mc > 0 ? mse / mc : 0;
        pCtx.drawImage(sample, 0, 0);

        // Snap-Trigger: zwei Modi
        // • Quad erkannt → 1 s Ruhe (SNAP_STABLE_FRAMES)
        // • Kein Quad, aber Objekt still → 1,5 s Fallback (SNAP_STABLE_FALLBACK)
        //   → Karte auch dann auslösen, wenn sie nicht exakt im Rahmen liegt
        const snapTarget = stableQuad ? SNAP_STABLE_FRAMES : SNAP_STABLE_FALLBACK;
        if (cooldownRef.current || mse > MOTION_RESET_THRESHOLD || !cardDetected) {
          stableRef.current = 0;
          if (!cooldownRef.current) setProgress(0);
        } else {
          stableRef.current += 1;
          setProgress(Math.min(stableRef.current / snapTarget, 1));
          if (stableRef.current >= snapTarget) doCapture();
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
      <canvas ref={edgeRef} width={EDGE_W} height={EDGE_H} className="hidden" />

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

          {/* Torch + Kamerawechsel (links, unterhalb des Headers — X-Button ist rechts) */}
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
