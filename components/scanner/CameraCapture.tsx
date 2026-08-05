'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Flashlight, FlashlightOff, Camera, RefreshCw } from 'lucide-react';
import { loadCardDetectorSession, detectCardInFrame, type CardBox } from '@/lib/scanner/card-detector-onnx';
import { computePixelMetrics, assessQuality, computeCriticalGlare, type QualityResult } from '@/lib/scanner/frame-quality';
import { useScannerDebug } from '@/lib/scanner/debug-flags';

/** Momentaufnahme der Auslöse-Metriken (für KI-Debug-Vorschau). */
export interface CaptureMeta {
  trigger: 'auto' | 'manual' | 'test';
  level: string;
  reason?: string;
  boxDelta: number;
  sharpness: number;
  contrast: number;
  glare: number;
  softGlare: number;
  nameGlare: number;
  codeGlare: number;
  meanLum: number;
  fill: number;
  cornersN: number;
  angleDeg: number;
}

interface Props {
  onCapture: (imageBase64: string, mimeType: string, meta?: CaptureMeta) => void;
  pendingCount?: number;
  /** Soft-Pause: Stream läuft, Detection + Snap pausieren. */
  paused?: boolean;
  /** Hard-Active: false → kein Stream (kein getUserMedia). Parent kontrolliert
   *  Lifecycle via Footer-FAB. Aufnahme erfolgt nur per direkter Nutzer-Geste. */
  active: boolean;
  /** Detection-Rahmen-Overlay ausblenden — z. B. im Einzeln-Modus nach Snap. */
  hideFrame?: boolean;
  /** Auslöse-Modus. true = Auto (Live-Erkennung + grün-gegateter Auto-Trigger, wie
   *  bisher). false = Manuell: keine Live-Erkennung/Ampel, nur Ziel-Rahmen; Foto
   *  wird per `shutterSignal` ausgelöst, Erkennung/Zuschnitt danach am Standbild. */
  autoDetect?: boolean;
  /** Monoton steigender Zähler — jede Erhöhung löst im Manuell-Modus ein Foto aus
   *  (der Footer-Scan-Button erhöht ihn). */
  shutterSignal?: number;
  /** true, sobald die erkannte Karte (Seiten-Overlay) angezeigt wird. Beendet im
   *  Manuell-Modus den eingefrorenen Foto-Freeze → dahinter erscheint die
   *  abgedunkelte (pausierte) Kamera, genau wie im Auto-Modus. */
  recognized?: boolean;
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

// Motion-Sample-Canvas (klein, nur für Bewegungsmessung). Exportiert, damit der
// Testmodus (ScanTestPanel) die Qualitäts-Metriken auf DERSELBEN Fenstergröße
// misst → identische Ampel-Schwellen.
export const SAMPLE_W = 190;
export const SAMPLE_H = 266;

const CHECK_MS               = 150;   // ONNX-Inferenz ~80ms → etwas mehr Budget
const MOTION_RESET_THRESHOLD = 1200;  // grobe Bewegung → stable zurücksetzen
const MOTION_SNAP_THRESHOLD  = 2000;  // unter diesem MSE-Wert gilt es als "ruhig".
                                      // War 700 → Haupt-Blocker bei Glanz-/Holo-Karten aus der Hand
                                      // (Folienflimmern hält mse hoch, obwohl die Box ruhig liegt).
                                      // Box-Ruhe (Δbox<35) + Schärfe-Gate schützen weiterhin vor
                                      // echter Bewegung/Unschärfe.
const SNAP_STABLE_FRAMES     = 1;     // 1 grüner Frame reicht — „grün" ist bereits scharf+ruhig+
                                      // im Rahmen+reflexionsfrei gegatet, ein 2. Tick verzögerte nur
                                      // (grün flackert durch Hand-Mikrobewegung → Zähler-Reset).
const BOX_SETTLED_THRESHOLD  = 22;    // px — Box-Mittelpunkt-Drift zwischen ONNX-Frames.
                                      // War 35 → löste teils bei noch driftender Karte aus (Δbox ~31);
                                      // der 3-Frame-Median verschmierte dann die Ecken → Rahmen zu groß/
                                      // versetzt. 22 verlangt eine wirklich ruhige Box → Rahmen sitzt sauber.
const CONSECUTIVE_SNAP_FRAMES = 2;    // Fallback: 2 aufeinanderfolgende Treffer
// Szenen-Änderungs-Cooldown: nach Snap warten bis MSE vs. Snapshot > Threshold.
// Verhindert Duplikat-Scans wenn dieselbe Karte noch im Bild liegt.
//
// MSE-Skala (kalibriert in der Praxis):
//   <100   = Karte ruht (Sensor-Rauschen, Autofokus-Mikro-Drift)
//   100-800 = Karte minimal verschoben, Hand-Tremor, leichte Lichtänderung
//   >1500  = neue Karte oder bewusste Bewegung
const CHANGE_DETECT_THRESHOLD = 1500;
const SNAP_COOLDOWN_MIN_MS    = 800;  // Mindest-Wartezeit nach Snap (verlängert von 300ms)

// Rand um die ONNX-Box beim Zuschneiden für Gemini (Pixel in Video-Koordinaten)
const CROP_PADDING = 24;

/** Median über N Zahlen (kleines N, naiv per Sort). */
function median(values: number[]): number {
  const a = values.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Median über die letzten Roh-Detektionen — glättet Hand-Zittern + Maske-Jitter.
 *  - x/y/w/h/conf: numerische Mediane der Box-Felder
 *  - corners: pro der 4 Ecken Median in x und y (sofern alle Boxen Corners haben) */
function medianCardBox(history: CardBox[]): CardBox {
  const xs    = history.map(b => b.x);
  const ys    = history.map(b => b.y);
  const ws    = history.map(b => b.w);
  const hs    = history.map(b => b.h);
  const confs = history.map(b => b.conf);

  let corners: [number, number][] | null | undefined;
  const allHaveCorners = history.every(
    b => b.corners != null && b.corners.length === 4
  );
  if (allHaveCorners) {
    corners = [0, 1, 2, 3].map(ci => {
      const cx = history.map(b => (b.corners as [number, number][])[ci][0]);
      const cy = history.map(b => (b.corners as [number, number][])[ci][1]);
      return [median(cx), median(cy)] as [number, number];
    });
  }

  return {
    x: median(xs),
    y: median(ys),
    w: median(ws),
    h: median(hs),
    conf: median(confs),
    corners,
  };
}

// Upload-Optimierung vs. Lesbarkeit: Set-Kürzel/-Nummer sind winzig und für die
// Erkennung kritisch. 1024px/0.60 machten sie matschig → 1280px lange Kante +
// JPEG 0.78. Nach dem Deskew ist die Karte formatfüllend (kein Hintergrund mehr),
// daher bleibt die Datei trotzdem klein (~80–140KB Base64).
const MAX_EDGE_PX = 1400;
const JPEG_QUALITY = 0.82;
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

/** Fallback ohne erkannte Ecken: zentrierter Zuschnitt in Karten-Seitenverhältnis
 *  (~5:7) — entspricht optisch dem Ziel-Rahmen und schneidet Nachbarkarten weg,
 *  statt das ganze Bild (inkl. Umgebung) zu senden. */
function encodeCenterCardCrop(src: HTMLCanvasElement): string {
  const AR = 5 / 7; // Breite/Höhe einer TCG-Karte
  let ch = Math.round(src.height * 0.86);
  let cw = Math.round(ch * AR);
  if (cw > src.width * 0.92) { cw = Math.round(src.width * 0.92); ch = Math.round(cw / AR); }
  const cx = Math.round((src.width - cw) / 2);
  const cy = Math.round((src.height - ch) / 2);
  return encodeCropToJpeg(src, cx, cy, cw, ch);
}

/** Entzerrter Karten-Zuschnitt: die 4 Ecken [tl,tr,br,bl] werden auf ein
 *  aufrechtes Rechteck gedreht+beschnitten → Gemini sieht NUR die Karte, gerade,
 *  ohne Hintergrund. (Die Ecken bilden bereits ein Rechteck → reine Rotation +
 *  Crop, keine perspektivische Verzerrung nötig.) */
function deskewCornersToJpeg(src: HTMLCanvasElement, corners: [number, number][]): string {
  const [tl, tr, , bl] = corners;
  const d = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const wCard = d(tl, tr);
  const hCard = d(tl, bl);
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(wCard, hCard));
  const W = Math.max(1, Math.round(wCard * scale));
  const H = Math.max(1, Math.round(hCard * scale));
  const angle = Math.atan2(tr[1] - tl[1], tr[0] - tl[0]);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d')!;
  // dest = scale · R(−angle) · (src − tl)  ⇒ tl→(0,0), tr→(W,0), bl→(0,H)
  octx.scale(scale, scale);
  octx.rotate(-angle);
  octx.translate(-tl[0], -tl[1]);
  octx.drawImage(src, 0, 0);
  return out.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1];
}

/** 8×8-LGS via Gauß-Elimination mit Teilpivotisierung. Gibt die 8 Unbekannten
 *  oder null (singulär) zurück. */
function gaussSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-9) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const dv = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= dv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map(row => row[n]);
}

/** Homographie [a,b,c,d,e,f,g,h] (h_33=1), die `dst`→`src` abbildet. */
function solveHomography(dst: [number, number][], src: [number, number][]): number[] | null {
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = dst[i];
    const [x, y] = src[i];
    A.push([X, Y, 1, 0, 0, 0, -X * x, -Y * x]); B.push(x);
    A.push([0, 0, 0, X, Y, 1, -X * y, -Y * y]); B.push(y);
  }
  return gaussSolve(A, B);
}

/** Perspektivisch entzerrter Karten-Zuschnitt: das (evtl. trapezförmige) Viereck
 *  [tl,tr,br,bl] wird per Homographie auf ein exaktes Rechteck gewarpt → Gemini
 *  sieht die Karte frontal, ohne perspektivische Verzerrung. Nearest-Sampling
 *  (für OCR bei dieser Auflösung ausreichend). Fällt bei singulärer Lösung auf
 *  den affinen Deskew zurück. */
function perspectiveWarpToJpeg(src: HTMLCanvasElement, corners: [number, number][]): string {
  const [tl, tr, br, bl] = corners;
  const d = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const wCard = Math.max(d(tl, tr), d(bl, br));
  const hCard = Math.max(d(tl, bl), d(tr, br));
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(wCard, hCard));
  const W = Math.max(1, Math.round(wCard * scale));
  const H = Math.max(1, Math.round(hCard * scale));
  const dst: [number, number][] = [[0, 0], [W, 0], [W, H], [0, H]];
  const Hm = solveHomography(dst, corners); // dst(x,y) → src(u,v)
  if (!Hm) return deskewCornersToJpeg(src, corners);

  // Quell-AABB (nur diesen Bereich auslesen statt des ganzen Frames)
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
  const ax = Math.max(0, Math.floor(Math.min(...xs)));
  const ay = Math.max(0, Math.floor(Math.min(...ys)));
  const aw = Math.min(src.width  - ax, Math.ceil(Math.max(...xs)) - ax);
  const ah = Math.min(src.height - ay, Math.ceil(Math.max(...ys)) - ay);
  if (aw < 2 || ah < 2) return deskewCornersToJpeg(src, corners);
  const sImg = src.getContext('2d', { willReadFrequently: true })!.getImageData(ax, ay, aw, ah).data;

  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d')!;
  const oImg = octx.createImageData(W, H);
  // Hm = [a,b,c, d,e,f, g,h]: u=(ax+by+c)/w, v=(dx+ey+f)/w, w=gx+hy+1
  const [a, b, c, e, f, g, p, q] = Hm;
  const od = oImg.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const w = p * x + q * y + 1;
      const fu = (a * x + b * y + c) / w - ax;
      const fv = (e * x + f * y + g) / w - ay;
      const oi = (y * W + x) * 4;
      od[oi + 3] = 255;
      const u0 = Math.floor(fu), v0 = Math.floor(fv);
      if (u0 >= 0 && u0 + 1 < aw && v0 >= 0 && v0 + 1 < ah) {
        // Bilineare Interpolation über die 4 Nachbarpixel → schärferer Kleintext
        const du = fu - u0, dv = fv - v0;
        const w00 = (1 - du) * (1 - dv), w10 = du * (1 - dv), w01 = (1 - du) * dv, w11 = du * dv;
        const i00 = (v0 * aw + u0) * 4, i10 = i00 + 4, i01 = i00 + aw * 4, i11 = i01 + 4;
        od[oi]     = sImg[i00]     * w00 + sImg[i10]     * w10 + sImg[i01]     * w01 + sImg[i11]     * w11;
        od[oi + 1] = sImg[i00 + 1] * w00 + sImg[i10 + 1] * w10 + sImg[i01 + 1] * w01 + sImg[i11 + 1] * w11;
        od[oi + 2] = sImg[i00 + 2] * w00 + sImg[i10 + 2] * w10 + sImg[i01 + 2] * w01 + sImg[i11 + 2] * w11;
      } else {
        // Rand: nächstliegendes Pixel (geklemmt)
        const u = Math.min(aw - 1, Math.max(0, Math.round(fu)));
        const v = Math.min(ah - 1, Math.max(0, Math.round(fv)));
        const si = (v * aw + u) * 4;
        od[oi] = sImg[si]; od[oi + 1] = sImg[si + 1]; od[oi + 2] = sImg[si + 2];
      }
    }
  }
  unsharpMask(od, W, H, 0.7); // Kanten/Kleintext anheben → lesbarere Set-Nummer
  octx.putImageData(oImg, 0, 0);
  return out.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1];
}

/** Unsharp-Mask (in-place): hebt Kanten/Kleintext an. out = orig + amount·(orig−blur),
 *  blur = 3×3-Box-Mittel. amount ~0.5–1.0. Uint8ClampedArray klemmt automatisch.
 *  Ränder bleiben unverändert. Läuft nur einmal beim Aufnehmen (nicht je Frame). */
function unsharpMask(data: Uint8ClampedArray, w: number, h: number, amount: number): void {
  const src = new Uint8ClampedArray(data); // Originalwerte für die Faltung
  const stride = w * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const base = y * stride + x * 4;
      for (let ch = 0; ch < 3; ch++) {
        const i = base + ch;
        const blur = (
          src[i - stride - 4] + src[i - stride] + src[i - stride + 4] +
          src[i - 4]          + src[i]          + src[i + 4]          +
          src[i + stride - 4] + src[i + stride] + src[i + stride + 4]
        ) / 9;
        data[i] = src[i] + amount * (src[i] - blur);
      }
    }
  }
}

/** Karte aufrecht entzerrt in ein kleines Canvas rendern und als ImageData
 *  zurückgeben — für die Zonen-Reflexionsmessung je Tick (billig, ~120×168).
 *  Exportiert für den Testmodus (identische Zonen-Reflexionsmessung). */
export function deskewCornersToImageData(
  src: CanvasImageSource, corners: [number, number][], out: HTMLCanvasElement, targetLong = 168,
): ImageData | null {
  const [tl, tr, , bl] = corners;
  const d = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const wCard = d(tl, tr), hCard = d(tl, bl);
  if (wCard < 8 || hCard < 8) return null;
  const scale = targetLong / Math.max(wCard, hCard);
  const W = Math.max(1, Math.round(wCard * scale));
  const H = Math.max(1, Math.round(hCard * scale));
  out.width = W; out.height = H;
  const octx = out.getContext('2d', { willReadFrequently: true })!;
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, W, H);
  octx.scale(scale, scale);
  octx.rotate(-Math.atan2(tr[1] - tl[1], tr[0] - tl[0]));
  octx.translate(-tl[0], -tl[1]);
  octx.drawImage(src, 0, 0);
  octx.setTransform(1, 0, 0, 1, 0, 0);
  return octx.getImageData(0, 0, W, H);
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
  // Live-Scanqualität (Debug-Modus „Scannen")
  level: string;         // neutral | red | yellow | green
  reason: string;        // Ampel-Grund (leer wenn grün/neutral)
  sharpness: number;     // Laplace-Varianz
  glare: number;         // % ausgebrannte Pixel
  softGlare: number;     // % weich-helle Pixel (Schleier-Reflexion)
  nameGlare: number;     // % Reflexion in der Namenszone (oben)
  codeGlare: number;     // % Reflexion in der Set-Code-Zone (unten links)
  meanLum: number;       // 0..255
  contrast: number;      // 0..255
  fill: number;          // % Kartenfläche am Bild
  tickMs: number;        // Sync-Kosten dieses Detection-Ticks
  cornersN: number;      // erkannte Ecken (4 = rotierter Rahmen möglich)
  angleDeg: number;      // Kartenwinkel aus den Ecken (0 = aufrecht)
}

export function CameraCapture({ onCapture, pendingCount = 0, paused = false, active, hideFrame = false, autoDetect = true, shutterSignal = 0, recognized = false }: Props) {
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
  // Auslöse-Modus als Ref (Detection-Tick liest ihn ohne Re-Setup).
  const autoDetectRef = useRef(autoDetect);
  useEffect(() => { autoDetectRef.current = autoDetect; }, [autoDetect]);

  // Letztes (geglättetes) ONNX-Ergebnis in Video-Koordinaten (Overlay + Snap-Crop)
  const onnxBoxRef    = useRef<CardBox | null>(null);
  // Ring-Buffer der letzten 3 Roh-Detektionen für Median-Glättung
  const cornerHistoryRef = useRef<CardBox[]>([]);
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

  // Kleines Canvas für die entzerrte Zonen-Reflexionsmessung (je Tick wiederverwendet)
  const critCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Letzter Debug-Snapshot (für die Auslöse-Metriken in der KI-Debug-Vorschau)
  const lastDebugRef  = useRef<DebugInfo | null>(null);

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
  // Geglättete Ecken (Lerp bei 60fps) → flüssiges, schnelles Mitdrehen des Rahmens
  const lerpCornersRef = useRef<[number, number][] | null>(null);

  // Live-Scanqualität (Ampel-Rahmen + Hinweis). Ref, weil drawOverlay im
  // 60fps-rAF-Loop liest; wird je Detection-Tick (150ms) aktualisiert.
  const qualityRef = useRef<QualityResult>({ level: 'neutral', reason: null });

  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  // Debug-Flags: bei „Scannen" wird NICHT ausgelöst (kein Foto/Gemini), nur
  // die Ampel/Metriken angezeigt. Ref-Spiegel für Nutzung in Closures (Tick/doCapture).
  const debugFlags = useScannerDebug();
  const scanDebugRef = useRef(debugFlags.scan);
  useEffect(() => { scanDebugRef.current = debugFlags.scan; }, [debugFlags.scan]);

  // Scannen-Debug: Zeit von „Karte zuerst erkannt" bis „würde auslösen" messen,
  // dann NUR stoppen (kein Foto). Log sammeln + kopierbar.
  const firstDetectAtRef    = useRef<number | null>(null);
  const scanDebugStoppedRef = useRef(false);
  const [scanDebugStopped, setScanDebugStopped] = useState(false);
  const [scanDebugLog, setScanDebugLog] = useState<string[]>([]);
  const scanLogCounterRef   = useRef(0);
  const [scanLogCopied, setScanLogCopied] = useState(false);
  // Zählt je Tick, welcher Grund „grün/Auslösen" blockiert — zeigt den Engpass.
  const scanBlockCountsRef  = useRef<Record<string, number>>({});

  const [streamReady, setStreamReady] = useState(false);
  // Front/Rück-Switch entfernt — Stream nutzt immer environment (Rückkamera).
  const facingMode = 'environment' as const;
  const [torch,      setTorch]      = useState(false);
  // Taschenlampe: funktioniert per applyConstraints (iOS 26.x/WebKit + Android).
  // Button immer sichtbar; `torchHint` zeigt kurz einen Hinweis, falls ein Gerät
  // es doch nicht schaltet.
  const [torchHint, setTorchHint] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [progress,   setProgress]   = useState(0);
  const [detected,   setDetected]   = useState(false);
  const [inCooldown, setInCooldown] = useState(false);
  const [flashing,   setFlashing]   = useState(false);
  // Manueller Modus: eingefrorenes Standbild direkt nach dem Auslöser — der
  // Ampel-Rahmen (grün/gelb/rot) wird über diesem Foto gezeichnet (drawOverlay
  // liest onnxBoxRef/qualityRef), BEVOR die Karte an Gemini geht. Erst danach
  // übernimmt die große erkannte Karte (Seiten-Overlay).
  const [frozenStill, setFrozenStill] = useState(false);
  const freezeRef      = useRef<HTMLCanvasElement>(null);
  // Während des Freezes darf der Detection-Tick onnxBoxRef NICHT leeren
  // (sonst verschwände die Ampel-Kontur sofort wieder).
  const manualHoldRef  = useRef(false);
  // Manuell-Modus: Auslöser ergab gelb/rot → NICHT erkennen, Foto + Ampel-Rahmen
  // + Hinweis stehen lassen, Nutzer kann direkt erneut auslösen.
  const [manualRetry, setManualRetry] = useState(false);
  const [snapAnim,   setSnapAnim]   = useState<{
    left: number; top: number; width: number; height: number; phase: 'burst' | 'fade';
  } | null>(null);
  const [debug,      setDebug]      = useState<DebugInfo>({
    conf: 0, mse: 0, stable: 0, boxDelta: Infinity, consecutiveFrames: 0,
    detected: false, sessionReady: false, cropSize: '–', triggerReason: '–', changeMse: 0,
    level: 'neutral', reason: '', sharpness: 0, glare: 0, softGlare: 0, nameGlare: 0, codeGlare: 0, meanLum: 0, contrast: 0, fill: 0, tickMs: 0,
    cornersN: 0, angleDeg: 0,
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

      // Ampel-Rahmen nach Live-Scanqualität: grün = bereit, gelb/rot = Mängel,
      // weiß = Karte erkannt, aber (noch) keine Bewertung.
      const qlvl = qualityRef.current.level;
      const frameColor =
        qlvl === 'green'  ? 'rgba(72,187,120,0.95)' :
        qlvl === 'yellow' ? 'rgba(236,201,75,0.95)' :
        qlvl === 'red'    ? 'rgba(239,68,68,0.95)'  :
                            'rgba(255,255,255,0.85)';
      const frameGlow =
        qlvl === 'green'  ? 'rgba(72,187,120,0.40)' :
        qlvl === 'yellow' ? 'rgba(236,201,75,0.40)' :
        qlvl === 'red'    ? 'rgba(239,68,68,0.40)'  :
                            'rgba(255,255,255,0.35)';
      ctx.strokeStyle = frameColor;
      ctx.lineWidth = 3;
      ctx.shadowColor = frameGlow;
      ctx.shadowBlur  = 10;

      if (target.corners?.length === 4) {
        // Ecken bei 60fps zur Zielposition lerpen → flüssiges, schnelles
        // Mitdrehen des Rahmens (statt 7×/s zu springen).
        const CORNER_LERP = 0.35;
        const tc = target.corners;
        const prevC = lerpCornersRef.current;
        const lc: [number, number][] = (prevC && prevC.length === 4)
          ? tc.map((c, i) => [
              prevC[i][0] + (c[0] - prevC[i][0]) * CORNER_LERP,
              prevC[i][1] + (c[1] - prevC[i][1]) * CORNER_LERP,
            ] as [number, number])
          : tc.map(c => [c[0], c[1]] as [number, number]);
        lerpCornersRef.current = lc;
        const pts = lc.map(([x, y]) => [x * scale + ox, y * scale + oy] as [number, number]);
        drawRoundedPolygon(ctx, pts, 14);
      } else {
        // Noch keine Ecken (erste Frames) → geglättete AABB (ruckelfrei dank Lerp)
        lerpCornersRef.current = null;
        ctx.beginPath();
        ctx.roundRect(lb.x * scale + ox, lb.y * scale + oy, lb.w * scale, lb.h * scale, 14);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fill();

      // Hinweistext DIREKT unter dem Rahmen (nur wenn nicht grün) — z.B.
      // „Unscharf", „Zu dunkel", „Reflexion". Klebt an der Box-Unterkante.
      const q = qualityRef.current;
      if (q.reason && q.level !== 'green' && q.level !== 'neutral') {
        const cx = (lb.x + lb.w / 2) * scale + ox;
        const boxBottom = (lb.y + lb.h) * scale + oy;
        const ty = Math.min(boxBottom + 20, dispH - 16);
        ctx.font = '600 15px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur = 0;
        const tw = ctx.measureText(q.reason).width;
        const padX = 11, pillH = 26, rw = tw + padX * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.beginPath();
        ctx.roundRect(cx - rw / 2, ty - pillH / 2, rw, pillH, 13);
        ctx.fill();
        ctx.fillStyle = q.level === 'red' ? '#ff6b6b' : '#f2cf4a';
        ctx.fillText(q.reason, cx, ty);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }
      return;
    }

    // Kein Treffer → Lerp zurücksetzen + gestrichelter Hilfsrahmen
    lerpBoxRef.current = null;
    lerpCornersRef.current = null;
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
      // Full HD: die Karte füllt oft nur ~25% des Bildes, bei 1280×720 blieben
      // dem winzigen Set-Kürzel/-Nummer zu wenig native Pixel (unscharf nach
      // Deskew-Upscaling). 1920×1080 gibt ~50% mehr lineare Auflösung → lesbarer.
      // Detection läuft ohnehin auf 640px-Downscale, kostet also nicht mehr.
      const resolution = { width: { ideal: 1920 }, height: { ideal: 1080 } };
      // facingMode EXACT bevorzugen: bindet an die echte Rückkamera — auf iOS
      // zündet die Taschenlampe (torch) nur mit dem korrekten physischen Device
      // zuverlässig. Fällt auf die weiche Präferenz zurück (Desktop / Geräte ohne
      // striktes „environment", sonst OverconstrainedError).
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: 'environment' }, ...resolution },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, ...resolution },
        });
      }
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
  // `force=true` ignoriert den Cooldown — wird vom manuellen Tap aufs Kamera-
  // bild genutzt, damit der User auch ohne abgewartete Stille snappen kann.
  const doCapture = useCallback((force = false) => {
    if (paused) return;
    // Debug „Scannen": nur beobachten — kein Foto, kein Gemini (auch nicht per Tap).
    if (scanDebugRef.current) return;
    if (!force && cooldownRef.current) return;
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
      // ── Perspektivische Entzerrung auf die 4 Ecken ─────────────────────────
      // Das (evtl. trapezförmige) Karten-Viereck wird per Homographie frontal
      // geradegezogen und exakt auf den grünen Rahmen beschnitten → Gemini sieht
      // NUR die Karte, ohne Neigung/Perspektive → zuverlässigere OCR.
      imageBase64 = perspectiveWarpToJpeg(canvas, box.corners);
      cropInfo    = `warp (corners)`;

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
      // Keine Box → zentrierter Karten-Zuschnitt (statt Vollbild) → Nachbarkarten weg.
      imageBase64 = encodeCenterCardCrop(canvas);
      cropInfo    = `center-card`;
    }

    cropSizeRef.current = cropInfo;
    const ds = lastDebugRef.current;
    const meta: CaptureMeta | undefined = ds ? {
      trigger:   force ? 'manual' : 'auto',
      level:     ds.level,
      reason:    ds.reason || undefined,
      boxDelta:  ds.boxDelta,
      sharpness: ds.sharpness,
      contrast:  ds.contrast,
      glare:     ds.glare,
      softGlare: ds.softGlare,
      nameGlare: ds.nameGlare,
      codeGlare: ds.codeGlare,
      meanLum:   ds.meanLum,
      fill:      ds.fill,
      cornersN:  ds.cornersN,
      angleDeg:  ds.angleDeg,
    } : undefined;
    onCaptureRef.current(imageBase64, 'image/jpeg', meta);

    // Haptik: Auto-Trigger = Doppelpuls („für dich ausgelöst"), manueller Tap =
    // kurzer Einzelpuls. Nur Android — iOS Safari kennt navigator.vibrate nicht.
    try { navigator.vibrate?.(force ? 35 : [0, 30, 60, 30]); } catch { /* nicht unterstützt */ }

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

  // ── Manueller Auslöser ─────────────────────────────────────────────────────
  // Im Manuell-Modus: Standbild aufnehmen, DANN Ecken erkennen (mit Toleranz →
  // Karte darf leicht aus dem Ziel-Rahmen ragen), entzerren/zuschneiden und
  // Reflexions-/Schärfe-Metriken am Standbild messen (nur Hinweis, nicht-blockierend).
  const doManualCapture = useCallback(async () => {
    if (paused || scanDebugRef.current) return;
    setManualRetry(false); // neuer Versuch → alten Retry-Hinweis weg
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);

    let box: CardBox | null = null;
    try { box = await detectCardInFrame(canvas, true); } catch { box = null; }

    let imageBase64: string;
    if (box?.corners?.length === 4) {
      imageBase64 = perspectiveWarpToJpeg(canvas, box.corners);
    } else if (box && box.w > 50 && box.h > 50) {
      const padX = Math.max(CROP_PADDING, Math.round(box.w * 0.05));
      const padY = Math.max(CROP_PADDING, Math.round(box.h * 0.08));
      const cx = Math.max(0, Math.round(box.x - padX));
      const cy = Math.max(0, Math.round(box.y - padY));
      const cw = Math.min(canvas.width  - cx, Math.round(box.w + padX * 2));
      const ch = Math.min(canvas.height - cy, Math.round(box.h + padY * 2));
      imageBase64 = encodeCropToJpeg(canvas, cx, cy, cw, ch);
    } else {
      imageBase64 = encodeCenterCardCrop(canvas);
    }

    let meta: CaptureMeta | undefined;
    let qResult: QualityResult | null = null;
    try {
      const s = sampleRef.current;
      if (s) {
        // Metriken (Reflexion/Schärfe/Belichtung/Kontrast) auf einem NATIV
        // aufgelösten 190×266-Fenster messen — 1:1, GENAU wie der Auto-Tick
        // (`drawImage(video, sx,sy,sw,sh, 0,0,sw,sh)`). Zentriert auf die Karte
        // (Box-Mitte), sonst Bildmitte. Vorher wurde das GANZE 1920×1080-
        // Standbild auf 190×266 heruntergerechnet → eine Reflexion (kleiner
        // Fleck) und Unschärfe gingen im herunterskalierten Hintergrund unter,
        // die Ampel blieb fälschlich grün. Nativer Ausschnitt = gleiche Metrik-
        // Skala wie Auto → dieselben Schwellen greifen (`sharpMin`, `glareMax`…).
        const sw = Math.min(SAMPLE_W, canvas.width);
        const sh = Math.min(SAMPLE_H, canvas.height);
        let rx = Math.max(0, Math.round((canvas.width - sw) / 2));
        let ry = Math.max(0, Math.round((canvas.height - sh) / 2));
        if (box && box.w > 0 && box.h > 0) {
          rx = Math.max(0, Math.min(canvas.width  - sw, Math.round(box.x + box.w / 2 - sw / 2)));
          ry = Math.max(0, Math.min(canvas.height - sh, Math.round(box.y + box.h / 2 - sh / 2)));
        }
        const sctx = s.getContext('2d')!;
        sctx.clearRect(0, 0, s.width, s.height);
        sctx.drawImage(canvas, rx, ry, sw, sh, 0, 0, sw, sh);
        const id = sctx.getImageData(0, 0, sw, sh);
        const pm = computePixelMetrics(id.data, sw, sh);
        // Reflexion in den Lesezonen (Name/Set-Code) auf der ENTZERRTEN Karte
        // messen — genau wie der Auto-Modus. Auf dem ganzen Standbild lägen die
        // Zonen falsch (Karte off-center/rotiert) → fälschlich rot/gelb.
        let cg = { nameGlare: 0, codeGlare: 0 };
        if (box?.corners?.length === 4) {
          if (!critCanvasRef.current) critCanvasRef.current = document.createElement('canvas');
          const cardData = deskewCornersToImageData(canvas, box.corners, critCanvasRef.current);
          cg = cardData ? computeCriticalGlare(cardData.data, cardData.width, cardData.height) : cg;
        } else {
          cg = computeCriticalGlare(id.data, sw, sh);
        }
        const cn = box?.corners?.length ?? 0;
        // Ampel-Bewertung am Standbild (fill=1 → nur Belichtung/Reflexion/Schärfe
        // zählen; Lage-Gates sind im Manuell-Modus irrelevant).
        const qr = assessQuality(
          { ...pm, fill: 1, nameGlare: cg.nameGlare, codeGlare: cg.codeGlare },
          { boxSettled: true, boxFullyInside: true },
        );
        qResult = qr;
        meta = {
          trigger: 'manual', level: qr.level, reason: qr.reason ?? undefined, boxDelta: 0,
          sharpness: pm.sharpness, contrast: pm.contrast, glare: pm.glare, softGlare: pm.softGlare,
          nameGlare: cg.nameGlare, codeGlare: cg.codeGlare, meanLum: pm.meanLum,
          fill: box ? (box.w * box.h) / (canvas.width * canvas.height) : 0,
          cornersN: cn,
          angleDeg: (cn === 4 && box?.corners)
            ? Math.round(Math.atan2(box.corners[1][1] - box.corners[0][1], box.corners[1][0] - box.corners[0][0]) * 180 / Math.PI)
            : 0,
        };
      }
    } catch { meta = undefined; }

    // ── Standbild einfrieren + Ampel-Rahmen darüber zeichnen ──────────────────
    // Dieselben Prüfungen wie im Auto-Modus (Reflexion/Schärfe/Kanten) sind oben
    // schon am Foto gelaufen. Jetzt das Foto einfrieren und die farbige Kontur
    // (grün/gelb/rot, drawOverlay liest onnxBoxRef + qualityRef) direkt um die
    // Karte legen — BEVOR sie an Gemini geht. Erst nach kurzer Haltezeit wird
    // ausgelöst; die Seite pausiert dann den Stream und zeigt die erkannte Karte.
    const fr = freezeRef.current;
    if (fr) {
      fr.width = canvas.width; fr.height = canvas.height;
      fr.getContext('2d')!.drawImage(canvas, 0, 0);
    }
    lerpBoxRef.current = null;      // Kontur ohne Einflug-Animation direkt setzen
    lerpCornersRef.current = null;
    qualityRef.current = qResult ?? { level: 'neutral', reason: null };
    onnxBoxRef.current = box;       // → drawOverlay zeichnet die Ampel-Kontur
    manualHoldRef.current = true;   // Tick darf onnxBoxRef jetzt nicht leeren
    setFrozenStill(true);

    setFlashing(true); setTimeout(() => setFlashing(false), 180);

    // Ampel-Ergebnis: nur bei grün (oder wenn keine Bewertung möglich war) wird
    // erkannt. Bei gelb/rot NICHT — Foto + Rahmen + Hinweis bleiben stehen, der
    // Nutzer kann direkt erneut auslösen (Stream läuft weiter, FAB = Foto).
    const level = qResult?.level;
    const blocked = level === 'yellow' || level === 'red';

    // Haptik (nur Android): grün = kurzer Einzelpuls, gelb/rot = Doppelpuls
    // „nochmal versuchen".
    try { navigator.vibrate?.(blocked ? [0, 40, 70, 40] : 35); } catch { /* nicht unterstützt */ }

    if (blocked) {
      setManualRetry(true); // zeigt „nochmal auslösen"-Hinweis, KEINE Erkennung
      return;
    }

    // Grün: kurz halten (Nutzer nimmt den grünen Rahmen wahr), DANN erkennen.
    await new Promise(r => setTimeout(r, 700));
    onCaptureRef.current(imageBase64, 'image/jpeg', meta);
  }, [paused]);

  // Freeze aufheben, sobald (a) die erkannte Karte erscheint → dahinter wird
  // die abgedunkelte (pausierte) Kamera sichtbar, genau wie im Auto-Modus; oder
  // (b) der Stream wieder läuft (Nutzer tippt für die nächste Karte). Während
  // der Verarbeitung (paused, noch nicht erkannt) bleibt das eingefrorene Foto
  // mit Ampel-Rahmen stehen — die Effekt-Deps [paused, recognized] ändern sich
  // dabei nicht, der Effekt läuft also nicht vorzeitig.
  useEffect(() => {
    if ((recognized || !paused) && frozenStill) {
      manualHoldRef.current = false;
      onnxBoxRef.current = null;
      setFrozenStill(false);
      setManualRetry(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, recognized]);

  // Footer-Scan-Button erhöht `shutterSignal` → hier auslösen (Mount überspringen).
  const shutterSeenRef = useRef(shutterSignal);
  useEffect(() => {
    if (shutterSignal === shutterSeenRef.current) return;
    shutterSeenRef.current = shutterSignal;
    // Steht gerade ein eingefrorenes Foto (gelb/rot-Retry)? Dann bringt der erste
    // Tap ERST die Live-Ansicht zurück (Freeze weg) — NICHT sofort ein neues Foto.
    // Erst der nächste Tap löst wieder aus. (Beim grünen Ergebnis ist der Stream
    // pausiert → der FAB sendet dann ohnehin Pause/Resume statt Shutter.)
    if (manualHoldRef.current) {
      manualHoldRef.current = false;
      onnxBoxRef.current = null;
      setFrozenStill(false);
      setManualRetry(false);
      return;
    }
    doManualCapture();
  }, [shutterSignal, doManualCapture]);

  // Moduswechsel (Auto⇄Manuell): Live-Box/Progress zurücksetzen UND einen evtl.
  // offenen Manuell-Freeze/Retry aufheben → Overlay zeigt sauber nur den
  // Ziel-Rahmen bzw. die Live-Erkennung.
  useEffect(() => {
    manualHoldRef.current = false;
    setFrozenStill(false);
    setManualRetry(false);
    if (!autoDetect) { onnxBoxRef.current = null; setDetected(false); setProgress(0); stableRef.current = 0; }
  }, [autoDetect]);

  // ── Detection-Loop ────────────────────────────────────────────────────────
  useEffect(() => {
    const delay = setTimeout(() => {
      timerRef.current = setInterval(() => {
        if (paused || scanDebugStoppedRef.current) return; // Scannen-Debug: nach Trigger-Messung gestoppt
        // Manuell-Modus: KEINE Live-Erkennung/Ampel/Auto-Trigger. Box leeren →
        // das rAF-Overlay zeigt nur den gestrichelten Ziel-Rahmen. Das Standbild
        // wird erst beim Auslösen (doManualCapture) analysiert.
        if (!autoDetectRef.current) { if (!manualHoldRef.current) onnxBoxRef.current = null; return; }
        const tickStart = performance.now();
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

        // 2. ONNX: fire-and-forget. Ecken IMMER anfordern → Rahmen dreht/skaliert
        //    mit der Karte (gedrehter Polygon-Pfad in drawOverlay) + entzerrter
        //    Zuschnitt in doCapture. (Konsistente Ecken in der Median-Historie;
        //    „nur wenn präsent" verwarf sie sonst in den ersten Frames.)
        if (!inferringRef.current && vw > 0) {
          inferringRef.current = true;
          detectCardInFrame(video, true).then(box => {
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
              // ── Ecken-/Box-Glättung: Median über die letzten 3 Roh-Detektionen ─
              // Reduziert Jitter durch Maske-Rauschen und Hand-Zittern.
              const hist = cornerHistoryRef.current;
              hist.push(box);
              if (hist.length > 3) hist.shift();
              onnxBoxRef.current    = hist.length === 3 ? medianCardBox(hist) : box;
              onnxStickyRef.current = ONNX_STICKY;
              consecutiveDetectRef.current += 1; // Zähler für Fallback-Trigger
            } else {
              onnxStickyRef.current = Math.max(0, onnxStickyRef.current - 1);
              if (onnxStickyRef.current === 0) {
                // Karte aus dem Bild — Overlay + Zähler zurücksetzen
                onnxBoxRef.current           = null;
                prevBoxRef.current           = null;
                cornerHistoryRef.current     = [];
                boxDeltaRef.current          = Infinity;
                consecutiveDetectRef.current = 0; // frische Erkennung für nächste Karte
                // Cooldown läuft per Timer — hier kein Eingriff nötig
              }
            }
          }).catch(() => {
            onnxBoxRef.current           = null;
            onnxStickyRef.current        = 0;
            prevBoxRef.current           = null;
            cornerHistoryRef.current     = [];
            boxDeltaRef.current          = Infinity;
            consecutiveDetectRef.current = 0;
          }).finally(() => {
            inferringRef.current = false;
          });
        }
        const cardDetected = onnxBoxRef.current !== null;

        // Scannen-Debug: Zeitstempel beim ERSTEN Erkennen (für „Erkennung→Trigger").
        if (cardDetected) {
          if (firstDetectAtRef.current == null) { firstDetectAtRef.current = performance.now(); scanBlockCountsRef.current = {}; }
        } else {
          firstDetectAtRef.current = null;
        }

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
        // Karte muss komplett im Bild sein. Bei gedrehter Karte ist die AABB
        // größer als die Karte (ihre Ecken ragen über die Kartenkanten hinaus) —
        // deshalb gegen die ECHTEN 4 Kartenecken prüfen, wenn vorhanden. So blockt
        // eine große, gedrehte, aber vollständig sichtbare Karte nicht fälschlich.
        const box = onnxBoxRef.current;
        const EDGE_MARGIN_PX = 8; // erlaubte Toleranz zum Frame-Rand (Video-Pixel)
        const boxFullyInside = !!box && vw > 0 && vh > 0 && (
          box.corners?.length === 4
            ? box.corners.every(([x, y]) =>
                x >= EDGE_MARGIN_PX && y >= EDGE_MARGIN_PX
                && x <= vw - EDGE_MARGIN_PX && y <= vh - EDGE_MARGIN_PX)
            : box.x >= EDGE_MARGIN_PX && box.y >= EDGE_MARGIN_PX
              && box.x + box.w <= vw - EDGE_MARGIN_PX && box.y + box.h <= vh - EDGE_MARGIN_PX
        );

        // ── Live-Scanqualität (Ampel) — aus dem vorhandenen Sample-Puffer ──
        // Kein zusätzlicher Readback: `sData` (Center-Sample) ist die Kartenmitte,
        // wenn die Karte gut im Rahmen liegt. `fill` = Boxfläche / Bildfläche.
        let qMetrics: { sharpness: number; glare: number; softGlare: number; meanLum: number; contrast: number; fill: number; nameGlare?: number; codeGlare?: number } | null = null;
        if (cardDetected && box && vw && vh) {
          const pm = computePixelMetrics(sData, sw, sh);
          const fill = (box.w * box.h) / (vw * vh);
          // Reflexion gezielt in den Lesezonen (Name oben, Set-Code unten links)
          // der aufrecht entzerrten Karte messen. Fehlen die Ecken (z.B. durch
          // starke Reflexion verworfen), Fallback auf die AABB-Box → bei aufrechten
          // Karten exakt, sonst grobe Näherung — Hauptsache die Prüfung LÄUFT.
          let nameGlare: number | undefined, codeGlare: number | undefined;
          if (video) {
            const quad: [number, number][] = box.corners?.length === 4
              ? box.corners
              : [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]];
            if (!critCanvasRef.current) critCanvasRef.current = document.createElement('canvas');
            const idata = deskewCornersToImageData(video, quad, critCanvasRef.current);
            if (idata) {
              const cg = computeCriticalGlare(idata.data, idata.width, idata.height);
              nameGlare = cg.nameGlare; codeGlare = cg.codeGlare;
            }
          }
          qMetrics = { ...pm, fill, nameGlare, codeGlare };
          qualityRef.current = assessQuality(qMetrics, { boxSettled, boxFullyInside });
        } else {
          qualityRef.current = { level: 'neutral', reason: null };
        }

        // changeDetectedThisTick: Snap erst im nächsten Tick möglich (Race-Condition-Schutz)
        // Auto-Auslöser NUR bei grüner Ampel (scharf, gut belichtet, keine
        // Reflexion in den Lesezonen, Box ruhig & ganz im Bild). Manueller Tap
        // (doCapture(true)) übersteuert das weiterhin.
        const snapCondition   = !cooldownRef.current && !changeDetectedThisTick && cardDetected
          && boxFullyInside && mse < MOTION_SNAP_THRESHOLD && qualityRef.current.level === 'green';
        const triggerReason   = boxSettled ? 'delta' : consecutiveOk ? 'consecutive' : '–';

        // Scannen-Debug: je Tick den blockierenden Grund zählen (Engpass-Analyse).
        if (scanDebugRef.current && cardDetected) {
          let blockReason: string;
          if (qualityRef.current.level !== 'green') blockReason = qualityRef.current.reason ?? qualityRef.current.level;
          else if (cooldownRef.current)             blockReason = 'Cooldown';
          else if (changeDetectedThisTick)          blockReason = 'Szenenwechsel';
          else if (mse >= MOTION_SNAP_THRESHOLD)    blockReason = 'Bewegung (mse)';
          else if (!boxFullyInside)                 blockReason = 'nicht ganz im Rahmen';
          else                                      blockReason = 'bereit';
          scanBlockCountsRef.current[blockReason] = (scanBlockCountsRef.current[blockReason] ?? 0) + 1;
        }

        // 7. Debug-State aktualisieren
        const dbgSnapshot: DebugInfo = {
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
          level:             qualityRef.current.level,
          reason:            qualityRef.current.reason ?? '',
          sharpness:         qMetrics ? Math.round(qMetrics.sharpness) : 0,
          glare:             qMetrics ? +(qMetrics.glare * 100).toFixed(1) : 0,
          softGlare:         qMetrics ? +(qMetrics.softGlare * 100).toFixed(1) : 0,
          nameGlare:         qMetrics?.nameGlare != null ? Math.round(qMetrics.nameGlare * 100) : 0,
          codeGlare:         qMetrics?.codeGlare != null ? Math.round(qMetrics.codeGlare * 100) : 0,
          meanLum:           qMetrics ? Math.round(qMetrics.meanLum) : 0,
          contrast:          qMetrics ? Math.round(qMetrics.contrast) : 0,
          fill:              qMetrics ? Math.round(qMetrics.fill * 100) : 0,
          tickMs:            +(performance.now() - tickStart).toFixed(1),
          cornersN:          onnxBoxRef.current?.corners?.length ?? 0,
          angleDeg:          (() => {
            const cs = onnxBoxRef.current?.corners;
            if (!cs || cs.length !== 4) return 0;
            return Math.round(Math.atan2(cs[1][1] - cs[0][1], cs[1][0] - cs[0][0]) * 180 / Math.PI);
          })(),
        };
        setDebug(dbgSnapshot);
        lastDebugRef.current = dbgSnapshot;

        if (snapCondition && (boxSettled || consecutiveOk)) {
          stableRef.current += 1;
          setProgress(1);
          if (stableRef.current >= SNAP_STABLE_FRAMES) {
            if (scanDebugRef.current) {
              // Scannen-Debug: NICHT auslösen — nur Zeit messen + stoppen.
              const elapsed = firstDetectAtRef.current != null
                ? Math.round(performance.now() - firstDetectAtRef.current) : 0;
              const d = dbgSnapshot;
              const n = ++scanLogCounterRef.current;
              const blockers = Object.entries(scanBlockCountsRef.current)
                .sort((a, b) => b[1] - a[1])
                .map(([r, c]) => `${r} ${c}×`)
                .join(' · ');
              const entry = `#${n}  Erkennung→Trigger ${elapsed}ms · ${d.level} · Schärfe ${d.sharpness} · `
                + `Kontrast ${d.contrast} · Δbox ${d.boxDelta} · Füllung ${d.fill}% · Ecken ${d.cornersN} · `
                + `Winkel ${d.angleDeg}° · Name ${d.nameGlare}% · Code ${d.codeGlare}% · conf ${d.conf.toFixed(2)}`
                + (blockers ? `\n     Blocker: ${blockers}` : '');
              setScanDebugLog(l => [...l, entry]);
              scanBlockCountsRef.current = {};
              scanDebugStoppedRef.current = true;
              setScanDebugStopped(true);
              stableRef.current = 0;
            } else {
              doCapture();
            }
          }
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
  // KEINE getCapabilities-Vorabprüfung mehr: WebKit meldet `torch` dort evtl.
  // nicht, unterstützt es aber via applyConstraints. Wir VERSUCHEN es direkt
  // (advanced-Form, dann Top-Level-Fallback) und zeigen das Ergebnis als Diagnose.
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    let applied = false;
    // 1) Standard-Form (advanced) — funktioniert auf iOS/WebKit + Android.
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      applied = true;
    } catch { /* nächster Versuch */ }
    // 2) Fallback: Top-Level-Constraint (falls eine Implementierung das braucht).
    if (!applied) {
      try {
        await track.applyConstraints({ torch: next } as unknown as MediaTrackConstraints);
        applied = true;
      } catch { /* nicht unterstützt */ }
    }
    // Verifizieren: hat die Kamera den Zustand wirklich übernommen? (undefined =
    // nicht meldbar → annehmen, dass es griff.)
    const settings = track.getSettings?.() as { torch?: boolean } | undefined;
    const reflected = settings && typeof settings.torch === 'boolean' ? settings.torch === next : true;
    if (applied && reflected) {
      setTorch(next);
    } else {
      setTorchHint(true);
      setTimeout(() => setTorchHint(false), 2400);
    }
  };

  return (
    <div
      className="relative w-full h-full bg-black overflow-hidden"
      onClick={!paused && active && autoDetect ? () => doCapture(true) : undefined}
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
                style={{ background: 'var(--pokedex-blue)' }}
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
                style={{ background: 'var(--pokedex-blue)' }}
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
                style={{ background: 'var(--pokedex-blue)' }}
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

          {/* Eingefrorenes Standbild (Manuell-Modus, direkt nach dem Auslöser) —
              deckt das Live-Video, object-cover deckungsgleich mit ihm, sodass die
              Ampel-Kontur im Overlay (gleiche object-cover-Mathematik) exakt auf
              der Karte im Foto sitzt. Liegt UNTER dem Overlay (zIndex 1 < 2). */}
          <canvas
            ref={freezeRef}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            style={{ zIndex: 1, opacity: frozenStill ? 1 : 0, transition: 'opacity 80ms ease-out' }}
          />

          {/* Erkennungs-Overlay — ausgeblendet wenn hideFrame (Einzeln nach Snap) */}
          <canvas
            ref={overlayRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: 2, opacity: hideFrame ? 0 : 1, transition: 'opacity 150ms ease-out' }}
          />

          {/* Debug „Scannen": Live-Metriken (nur beobachten, kein Foto/Gemini) */}
          {debugFlags.scan && (
            <div
              className="absolute left-3 pointer-events-none"
              style={{ top: 'calc(env(safe-area-inset-top, 0px) + 66px)', zIndex: 6 }}
            >
              <div className="glass-overlay rounded-xl px-3 py-2 text-[11px] leading-tight font-mono text-white/90" style={{ minWidth: 158 }}>
                <div
                  className="font-bold mb-1"
                  style={{ color: debug.level === 'green' ? '#48bb78' : debug.level === 'yellow' ? '#ecc94b' : debug.level === 'red' ? '#ef4444' : '#fff' }}
                >
                  DEBUG · {debug.level}{debug.reason ? ` · ${debug.reason}` : ''}
                </div>
                <div>Schärfe {debug.sharpness} · Glare {debug.glare}% · Soft {debug.softGlare}%</div>
                <div>Name {debug.nameGlare}% · Code {debug.codeGlare}%</div>
                <div>Licht {debug.meanLum} · Kontrast {debug.contrast}</div>
                <div>Füllung {debug.fill}% · Δbox {debug.boxDelta}</div>
                <div>MSE {debug.mse} · Tick {debug.tickMs}ms</div>
                <div>Ecken {debug.cornersN} · Winkel {debug.angleDeg}°</div>
                <div>conf {debug.conf.toFixed(2)} · {debug.detected ? 'erkannt' : '—'}</div>
              </div>
            </div>
          )}

          {/* Scannen-Debug: Stopp nach Trigger-Messung — Zeit-Log + Kopieren + Weiter */}
          {debugFlags.scan && scanDebugStopped && (
            <div
              className="absolute inset-x-3 bottom-24 rounded-xl p-3 font-mono text-[11px] text-white"
              style={{ zIndex: 8, background: 'rgba(0,0,0,0.82)' }}
            >
              <div className="font-bold text-green-400 mb-1">
                Trigger erreicht (nicht ausgelöst) · {scanDebugLog.length} Messung(en)
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1 mb-2">
                {scanDebugLog.map((l, i) => (
                  <div key={i} className="text-white/85 break-words">{l}</div>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const text = scanDebugLog.join('\n');
                    try {
                      await navigator.clipboard.writeText(text);
                      setScanLogCopied(true);
                      setTimeout(() => setScanLogCopied(false), 1600);
                    } catch {
                      window.prompt('Scan-Log (kopieren):', text);
                    }
                  }}
                  className="h-9 px-4 rounded-full bg-white/15 text-white text-xs font-semibold"
                >
                  {scanLogCopied ? 'Kopiert ✓' : 'Kopieren'}
                </button>
                <button
                  onClick={() => {
                    // Weiter scannen: Stopp aufheben + Erkennung frisch starten
                    scanDebugStoppedRef.current = false;
                    setScanDebugStopped(false);
                    firstDetectAtRef.current      = null;
                    stableRef.current             = 0;
                    onnxBoxRef.current            = null;
                    prevBoxRef.current            = null;
                    cornerHistoryRef.current      = [];
                    onnxStickyRef.current         = 0;
                    consecutiveDetectRef.current  = 0;
                    boxDeltaRef.current           = Infinity;
                  }}
                  className="h-9 px-4 rounded-full text-white text-xs font-semibold"
                  style={{ background: '#3182ce' }}
                >
                  Weiter scannen
                </button>
                <button
                  onClick={() => { setScanDebugLog([]); scanLogCounterRef.current = 0; }}
                  className="h-9 px-4 rounded-full bg-white/15 text-white/80 text-xs font-semibold"
                >
                  Leeren
                </button>
              </div>
            </div>
          )}

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

          {/* Manuell-Modus: gelb/rot → keine Erkennung. Hinweis unten, dass man
              direkt erneut auslösen kann (der Ampel-Grund steht bereits am
              Rahmen selbst, gezeichnet von drawOverlay). */}
          {manualRetry && (
            <div
              className="absolute inset-x-0 flex justify-center pointer-events-none"
              style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 104px)', zIndex: 6 }}
            >
              <div
                className="flex items-center gap-2 px-4 py-2 rounded-full"
                style={{ background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
              >
                <RefreshCw size={15} color="#facc15" />
                <span className="text-white text-xs font-medium">Nicht optimal — tippe für Live-Ansicht, dann neu auslösen</span>
              </div>
            </div>
          )}

          {/* Pause-Overlay — NICHT während eines manuellen Freeze (Seite pausiert
              den Stream zur Erkennung, aber das eingefrorene Foto mit Ampel-
              Rahmen soll sichtbar bleiben, nicht abgedunkelt werden). */}
          {paused && !frozenStill && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center pointer-events-none" style={{ zIndex: 3 }}>
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                <div className="w-4 h-10 flex gap-1.5">
                  <div className="flex-1 bg-white rounded-sm" />
                  <div className="flex-1 bg-white rounded-sm" />
                </div>
              </div>
            </div>
          )}

          {/* Taschenlampen-Switch oben links — Glas-Kreis (Handoff design_handoff_scanner_glass). */}
          <div
            className="absolute left-4 flex flex-col items-start gap-2 pointer-events-auto"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)', zIndex: 4 }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={toggleTorch}
              className="w-[46px] h-[46px] rounded-full flex items-center justify-center glass-overlay"
              aria-label={torch ? 'Taschenlampe aus' : 'Taschenlampe an'}
            >
              {torch ? <Flashlight size={20} color="#facc15" /> : <FlashlightOff size={20} color="#fff" />}
            </button>
            {torchHint && (
              <div className="px-3 py-1.5 rounded-full text-[11px] font-medium text-white whitespace-nowrap" style={{ background: 'rgba(0,0,0,0.72)' }}>
                Auf diesem Gerät nicht verfügbar
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
