'use client';

/**
 * ONNX-basierte Pokémon-Kartenerkennung via YOLOv11n-seg Modell.
 *
 * Modell: ferrari-yolo/pokemon-card-detection-3 (Roboflow, lokal trainiert)
 * Klassen: Card (0), Name (1)
 * Output0-Shape: [1, 38, 8400] = 4 bbox + 2 class-scores + 32 mask-koeffizienten
 * Output1-Shape: [1, 32, 160, 160] = Masken-Prototypen
 *
 * Aus den Masken-Daten berechnen wir 4 genaue Eckpunkte der Karte (auch bei Rotation).
 */

import * as ort from 'onnxruntime-web';

const MODEL_PATH       = '/models/card-detector.onnx';
const MODEL_INPUT_SIZE = 640;
const CONF_THRESHOLD   = 0.80; // „Vertrauens-Schwelle": direkt akzeptiert
// Darunter (0.58–0.80) wird eine Detektion nur akzeptiert, wenn ihr Masken-
// Rechteck plausibel kartenförmig ist (siehe Ende) — fängt schwach erkannte
// Full-Art-/Glanzkarten, ohne leere Kartons durchzulassen (Textur-Filter greift
// zusätzlich). Reines Absenken auf 0.72 hatte früher leere Kartons erkannt.
const DETECT_FLOOR     = 0.58;
const MASK_SIZE        = 160;  // Output1-Auflösung (640 / 4)

// Klassen-Index laut Roboflow-Training
const CLASS_CARD = 0;

let session: ort.InferenceSession | null = null;
let loadPromise: Promise<void> | null = null;

/** Session einmalig laden (idempotent, thread-safe via Promise-Cache). */
export async function loadCardDetectorSession(): Promise<void> {
  if (session) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    ort.env.wasm.wasmPaths = '/';
    // WebGPU zuerst (iOS 18+ / macOS Safari 18+ — 2-3× schneller), WASM-Fallback
    // wenn nicht verfügbar. ORT-Web evaluiert die Liste sequentiell.
    session = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['webgpu', 'wasm'],
    });
    console.log('[CardDetector] ONNX session ready');
  })();
  return loadPromise;
}

export interface CardBox {
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
  /** 4 Eckpunkte [tl, tr, br, bl] in Quell-Koordinaten — aus Segmentierungsmaske.
   *  Vorhanden wenn output1 verfügbar; null wenn Maske nicht dekodierbar. */
  corners?: [number, number][] | null;
}

type Pt = [number, number];

/** Konvexe Hülle (Andrew's Monotone Chain), Ergebnis gegen den Uhrzeigersinn. */
function convexHull(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts.slice();
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** Flächenkleinstes umschließendes Rechteck einer konvexen Hülle via Rotating
 *  Calipers. Eine Kante des Optimums liegt immer auf einer Hüllenkante — daher
 *  wird über jede Kante rotiert und die minimale Fläche gemerkt. Gibt die 4
 *  Ecken zurück (Reihenfolge unspezifiziert) oder null. */
function minAreaRect(hull: Pt[]): Pt[] | null {
  if (hull.length < 3) return null;
  let best: { area: number; corners: Pt[] } | null = null;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    let ux = b[0] - a[0], uy = b[1] - a[1];
    const len = Math.hypot(ux, uy);
    if (len < 1e-6) continue;
    ux /= len; uy /= len;      // Kantenrichtung
    const vx = -uy, vy = ux;   // Normale
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const h of hull) {
      const pu = h[0] * ux + h[1] * uy;
      const pv = h[0] * vx + h[1] * vy;
      if (pu < minU) minU = pu; if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv; if (pv > maxV) maxV = pv;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      const c = (pu: number, pv: number): Pt => [pu * ux + pv * vx, pu * uy + pv * vy];
      best = { area, corners: [c(minU, minV), c(maxU, minV), c(maxU, maxV), c(minU, maxV)] };
    }
  }
  return best ? best.corners : null;
}

/**
 * Erkennt die beste Pokémon-Karte im Video/Canvas-Frame.
 * Gibt null zurück wenn keine Karte mit conf >= CONF_THRESHOLD gefunden.
 *
 * `includeCorners` steuert ob die teure Mask-Decode-Schleife (25 600
 * Dot-Products mit 32 Koeffizienten) ausgeführt wird. Im Detection-Loop
 * (alle 150 ms) brauchen wir nur die Box — Mask-Decode lohnt nur beim
 * Snap selbst. Default `false` → Detection-Loop bekommt schnelle Path.
 * Bei `true`: Corners werden berechnet (rotierte Eckpunkte).
 */
export async function detectCardInFrame(
  source: HTMLCanvasElement | HTMLVideoElement,
  includeCorners: boolean = false,
): Promise<CardBox | null> {
  if (!session) return null;

  // Quell-Dimensionen ermitteln
  const srcW = source instanceof HTMLVideoElement ? source.videoWidth  : source.width;
  const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!srcW || !srcH) return null;

  // 1. Vollbild mit Letterboxing auf 640×640 skalieren
  const off = new OffscreenCanvas(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const ctx = off.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const scale = Math.min(MODEL_INPUT_SIZE / srcW, MODEL_INPUT_SIZE / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  const padX  = (MODEL_INPUT_SIZE - drawW) / 2;
  const padY  = (MODEL_INPUT_SIZE - drawH) / 2;
  ctx.drawImage(source, padX, padY, drawW, drawH);
  const px = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE).data;
  const N  = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;

  // ─── Contrast-Stretch via Luminanz-Histogramm ─────────────────────────────
  // Verbessert Recall bei dunklen/glänzenden Karten und schlechtem Licht.
  // 64-Bucket-Luminanz-Histogramm (Rec. 601: 0.299R + 0.587G + 0.114B), dann
  // 2./98.-Perzentile bestimmen. Stretch wird auf alle drei RGB-Channels
  // gleichermaßen angewendet, damit kein Color-Cast entsteht.
  const HIST_BUCKETS = 64;
  const hist = new Uint32Array(HIST_BUCKETS);
  for (let i = 0; i < N; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const lum = (r * 77 + g * 150 + b * 29) >> 8;            // ≈ Rec.601, /256
    const bucket = (lum * HIST_BUCKETS) >> 8;                 // 0..255 → 0..63
    hist[bucket < HIST_BUCKETS ? bucket : HIST_BUCKETS - 1]++;
  }
  const lowCount  = N * 0.02;   // 2.-Perzentil
  const highCount = N * 0.98;   // 98.-Perzentil
  let cum = 0, p2bucket = 0, p98bucket = HIST_BUCKETS - 1;
  for (let b = 0; b < HIST_BUCKETS; b++) {
    cum += hist[b];
    if (cum >= lowCount) { p2bucket = b; break; }
  }
  cum = 0;
  for (let b = 0; b < HIST_BUCKETS; b++) {
    cum += hist[b];
    if (cum >= highCount) { p98bucket = b; break; }
  }
  const p2  = (p2bucket  * 255) / HIST_BUCKETS;
  const p98 = (p98bucket * 255) / HIST_BUCKETS + 255 / HIST_BUCKETS;
  // Kein Stretch wenn Dynamikbereich zu klein (Rauschen / Schwarz-Frame)
  const useStretch = (p98 - p2) >= 30;
  const stretchScale = useStretch ? 1 / (p98 - p2) : 1 / 255;
  const stretchOffset = useStretch ? -p2 / (p98 - p2) : 0;

  const t  = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) {
    let r = px[i * 4]     * stretchScale + stretchOffset;
    let g = px[i * 4 + 1] * stretchScale + stretchOffset;
    let b = px[i * 4 + 2] * stretchScale + stretchOffset;
    // Clamp [0, 1]
    if (r < 0) r = 0; else if (r > 1) r = 1;
    if (g < 0) g = 0; else if (g > 1) g = 1;
    if (b < 0) b = 0; else if (b > 1) b = 1;
    t[i]         = r;
    t[N + i]     = g;
    t[2 * N + i] = b;
  }

  // 2. Inferenz
  const inputTensor = new ort.Tensor('float32', t, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
  const outputs = await session.run({ images: inputTensor });

  // 3. Output0 parsen: [1, 38, 8400]
  const outTensor      = outputs['output0'] ?? outputs[Object.keys(outputs)[0]];
  const out            = outTensor.data as Float32Array;
  const dims           = outTensor.dims;
  const isFeatureFirst = dims[1] < dims[2];
  const numFeatures    = isFeatureFirst ? dims[1] : dims[2];
  const numAnchors     = isFeatureFirst ? dims[2] : dims[1];

  // Letterboxing rückgängig: Modell-Koordinaten → Quell-Koordinaten
  const toSrcX = (mx: number) => (mx - padX) / scale;
  const toSrcY = (my: number) => (my - padY) / scale;

  const getVal = (feat: number, anchor: number) =>
    isFeatureFirst ? out[feat * numAnchors + anchor] : out[anchor * numFeatures + feat];

  let best: CardBox | null = null;
  let bestIdx = -1;

  for (let i = 0; i < numAnchors; i++) {
    const cardConf = getVal(4 + CLASS_CARD, i);
    if (cardConf < DETECT_FLOOR) continue;

    const cx = getVal(0, i);
    const cy = getVal(1, i);
    const w  = getVal(2, i);
    const h  = getVal(3, i);

    if (!best || cardConf > best.conf) {
      bestIdx = i;
      best = {
        x: toSrcX(cx - w / 2),
        y: toSrcY(cy - h / 2),
        w: w / scale,
        h: h / scale,
        conf: cardConf,
      };
    }
  }

  // 3b. Texturprüfung — leere Kartonkisten/Tischflächen herausfiltern
  //     Echte Pokémon-Karten haben buntes Artwork → hohe Farbvarianz im Zentrum.
  //     Gleichförmige Hintergründe (Karton, Tisch) haben sehr niedrige Varianz,
  //     werden aber vom Modell trotzdem mit hoher Konfidenz erkannt (conf ≥ 0.9).
  //     Threshold empirisch: Karton < 150, Karte mit Artwork > 400.
  if (best) {
    const MIN_TEXTURE_VARIANCE = 300;

    // Erkannte Box zurück in Model-Koordinaten (640×640) umrechnen
    const bxM = padX + best.x * scale;
    const byM = padY + best.y * scale;
    const bwM = best.w * scale;
    const bhM = best.h * scale;

    // Inneres 50% der Box analysieren (Rand weglassen, nur Artwork-Bereich)
    const ix = Math.max(0, Math.round(bxM + bwM * 0.25));
    const iy = Math.max(0, Math.round(byM + bhM * 0.25));
    const iw = Math.max(4, Math.min(MODEL_INPUT_SIZE - ix, Math.round(bwM * 0.5)));
    const ih = Math.max(4, Math.min(MODEL_INPUT_SIZE - iy, Math.round(bhM * 0.5)));

    // Farbvarianz berechnen (jeden 2. Pixel samplen → Performance)
    let sumR = 0, sumG = 0, sumB = 0, n = 0;
    for (let row = iy; row < iy + ih; row += 2) {
      for (let col = ix; col < ix + iw; col += 2) {
        const j4 = (row * MODEL_INPUT_SIZE + col) * 4;
        sumR += px[j4]; sumG += px[j4 + 1]; sumB += px[j4 + 2]; n++;
      }
    }
    if (n > 0) {
      const ar = sumR / n, ag = sumG / n, ab = sumB / n;
      let variance = 0;
      for (let row = iy; row < iy + ih; row += 2) {
        for (let col = ix; col < ix + iw; col += 2) {
          const j4 = (row * MODEL_INPUT_SIZE + col) * 4;
          const dr = px[j4] - ar, dg = px[j4 + 1] - ag, db = px[j4 + 2] - ab;
          variance += (dr * dr + dg * dg + db * db) / 3;
        }
      }
      variance /= n;
      if (variance < MIN_TEXTURE_VARIANCE) return null; // zu gleichförmig → kein echter Karteninhalt
    }
  }

  // 4. Segmentierungsmaske dekodieren → 4 Eckpunkte berechnen
  //    Nur ausführen wenn explizit angefordert (Snap-Pfad). Im Detection-
  //    Loop (alle 150ms) ist die innere Schleife mit 25 600 Dot-Products
  //    zu teuer — wir brauchen nur die Box für Snap-Trigger/Overlay.
  //    output1: [1, 32, 160, 160] — Masken-Prototypen
  //    output0 Features 6–37: 32 Masken-Koeffizienten der besten Detektion
  //
  //    pixel_in_card = (Σ coeff[k] * proto[k,y,x]) > 0
  //    (entspricht sigmoid > 0.5, ohne Math.exp — spart ~25.600 teure Calls)
  //
  //    Eckpunkte: konvexe Hülle der Maskenränder → Minimum-Area-Rectangle
  //    (Rotating Calipers) → echtes gedrehtes Karten-Viereck bei jedem Winkel.
  const proto = outputs['output1']?.data as Float32Array | undefined;

  // Ob das aus der Maske abgeleitete Rechteck plausibel kartenförmig war —
  // dient unten als Zusatzbeleg, um schwach erkannte Karten (conf < CONF_THRESHOLD)
  // trotzdem zu akzeptieren.
  let cornersPlausible = false;

  if (includeCorners && best && bestIdx >= 0 && proto) {
    const coeffs     = new Float32Array(32);
    for (let k = 0; k < 32; k++) coeffs[k] = getVal(6 + k, bestIdx);

    const PROTO_AREA = MASK_SIZE * MASK_SIZE;
    const maskScale  = MODEL_INPUT_SIZE / MASK_SIZE; // 4.0

    // WICHTIG: nur Maskenpixel INNERHALB der (zuverlässigen) Box-Regression zählen.
    // Die Prototyp-Maske hat oft Streu-Rauschen (positives Skalarprodukt) im
    // Hintergrund; ungefiltert blähen einzelne Fernpixel die Zeilen-Silhouette auf
    // → Rechteck viel zu groß → als unplausibel verworfen (Ecken 0). Die Box
    // begrenzt zuverlässig auf die Karte (AABB der gedrehten Karte).
    const toMaskX = (sx: number) => (padX + sx * scale) / maskScale;
    const toMaskY = (sy: number) => (padY + sy * scale) / maskScale;
    const PAD = 2; // Masken-Pixel Toleranz (Randunschärfe der Maske)
    const bxL = Math.max(0, Math.floor(toMaskX(best.x) - PAD));
    const bxR = Math.min(MASK_SIZE - 1, Math.ceil(toMaskX(best.x + best.w) + PAD));
    const byT = Math.max(0, Math.floor(toMaskY(best.y) - PAD));
    const byB = Math.min(MASK_SIZE - 1, Math.ceil(toMaskY(best.y + best.h) + PAD));

    // Pro Maskenzeile linkeste/rechteste Karten-Spalte. Für eine (nahezu) konvexe
    // Form genügen diese 2 Randpunkte je Zeile, um die konvexe Hülle exakt zu
    // bestimmen — deutlich schlanker als alle Innenpunkte zu sammeln.
    const rowMin = new Int16Array(MASK_SIZE).fill(-1);
    const rowMax = new Int16Array(MASK_SIZE).fill(-1);
    let found = false;

    for (let my = byT; my <= byB; my++) {
      const rowBase = my * MASK_SIZE;
      let lo = -1, hi = -1;
      for (let mx = bxL; mx <= bxR; mx++) {
        // Skalarprodukt: Koeffizienten × Prototypen
        let raw = 0;
        for (let k = 0; k < 32; k++)
          raw += coeffs[k] * proto[k * PROTO_AREA + rowBase + mx];
        if (raw <= 0) continue; // außerhalb der Karte
        if (lo < 0) lo = mx;
        hi = mx;
      }
      if (lo >= 0) { rowMin[my] = lo; rowMax[my] = hi; found = true; }
    }

    if (!found) {
      best.corners = null;
    } else {
      // ── Echtes Karten-Viereck: konvexe Hülle → Minimum-Area-Rectangle für
      // Orientierung/Plausibilität, dann die ECHTEN Eckpunkte als die der Rechteck-
      // Ecke jeweils nächstliegenden Hüllenpunkte. So folgt der Rahmen der echten
      // Perspektive (Trapez bei schräger Aufnahme), nicht nur einem gedrehten Rechteck.
      const boundary: [number, number][] = [];
      for (let my = 0; my < MASK_SIZE; my++) {
        if (rowMin[my] < 0) continue;
        boundary.push([rowMin[my], my]);
        if (rowMax[my] !== rowMin[my]) boundary.push([rowMax[my], my]);
      }
      const hull = convexHull(boundary);
      const rect = minAreaRect(hull);
      if (!rect) {
        best.corners = null;
      } else {
        // Zu jeder Rechteck-Ecke den nächstgelegenen Hüllenpunkt = echte Kartenecke.
        const quad = rect.map(rc => {
          let bestPt = rc, bestD = Infinity;
          for (const hp of hull) {
            const d = (hp[0] - rc[0]) ** 2 + (hp[1] - rc[1]) ** 2;
            if (d < bestD) { bestD = d; bestPt = hp; }
          }
          return bestPt;
        });

        // Masken-Koords → Quell-Koords (affine Rücktransformation)
        const toSrc = (p: [number, number]): [number, number] =>
          [toSrcX((p[0] + 0.5) * maskScale), toSrcY((p[1] + 0.5) * maskScale)];
        const rc = quad.map(toSrc);

        // Ecken nach tl/tr/br/bl ordnen (Drehung < ~40° → Summe/Differenz eindeutig)
        const bySum  = [...rc].sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
        const byDiff = [...rc].sort((a, b) => (a[0] - a[1]) - (b[0] - b[1]));
        const tl = bySum[0], br = bySum[3];
        const tr = byDiff[3], bl = byDiff[0];

        // ── Plausibilität des gedrehten Vierecks ──────────────────────────────
        // Die Maskenränder sind rauschanfälliger als die Box-Regression; ist das
        // Rechteck unplausibel (Streupixel, halbe Maske), NUR den gedrehten Rahmen
        // verwerfen und auf die saubere AABB zurückfallen — die Karte bleibt
        // erkannt. (Früher `return null` → gedrehte Karten wurden gar nicht mehr
        // erkannt.)
        const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
        const wEst = (dist(tl, tr) + dist(bl, br)) / 2;
        const hEst = (dist(tl, bl) + dist(tr, br)) / 2;
        const shorter      = Math.min(wEst, hEst);
        const longer       = Math.max(wEst, hEst);
        const ratio        = longer / (shorter || 1);
        const frameShorter = Math.min(srcW, srcH);

        cornersPlausible = !(
          shorter > frameShorter * 0.98 ||  // fast formatfüllend → eher Fehldetektion
          shorter < frameShorter * 0.05 ||  // zu klein
          ratio < 1.05 || ratio > 2.3       // falsches Seitenverhältnis
        );
        best.corners = cornersPlausible ? [tl, tr, br, bl] : null; // sonst AABB-Rahmen
      }
    }
  }

  // Schwach erkannte Karten (conf zwischen DETECT_FLOOR und CONF_THRESHOLD) nur
  // akzeptieren, wenn die Maske ein plausibles Karten-Rechteck lieferte. Ohne
  // Ecken-Info (includeCorners=false) gilt weiterhin die harte Vertrauens-Schwelle.
  if (best && best.conf < CONF_THRESHOLD && !cornersPlausible) return null;

  return best;
}
