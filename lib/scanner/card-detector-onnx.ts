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
const CONF_THRESHOLD   = 0.80; // 0.72 erkannte leere Kartonkiste als Karte
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
  const t  = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) {
    t[i]         = px[i * 4]     / 255;
    t[N + i]     = px[i * 4 + 1] / 255;
    t[2 * N + i] = px[i * 4 + 2] / 255;
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
    if (cardConf < CONF_THRESHOLD) continue;

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
  //    Eckpunkte via extremale Diagonalrichtungen:
  //      tl → min(x+y)   tr → max(x−y)   br → max(x+y)   bl → min(x−y)
  const proto = outputs['output1']?.data as Float32Array | undefined;

  if (includeCorners && best && bestIdx >= 0 && proto) {
    const coeffs     = new Float32Array(32);
    for (let k = 0; k < 32; k++) coeffs[k] = getVal(6 + k, bestIdx);

    const PROTO_AREA = MASK_SIZE * MASK_SIZE;
    const maskScale  = MODEL_INPUT_SIZE / MASK_SIZE; // 4.0

    let tlX = 0, tlY = 0, tlV =  Infinity;
    let trX = 0, trY = 0, trV = -Infinity;
    let brX = 0, brY = 0, brV = -Infinity;
    let blX = 0, blY = 0, blV =  Infinity;
    let found = false;

    for (let my = 0; my < MASK_SIZE; my++) {
      for (let mx = 0; mx < MASK_SIZE; mx++) {
        // Skalarprodukt: Koeffizienten × Prototypen
        let raw = 0;
        for (let k = 0; k < 32; k++)
          raw += coeffs[k] * proto[k * PROTO_AREA + my * MASK_SIZE + mx];
        if (raw <= 0) continue; // außerhalb der Karte

        // Masken-Pixel → Modell-Koordinate → Quell-Koordinate
        const sx = toSrcX((mx + 0.5) * maskScale);
        const sy = toSrcY((my + 0.5) * maskScale);
        if (sx < 0 || sx >= srcW || sy < 0 || sy >= srcH) continue;

        found = true;
        if (sx + sy < tlV) { tlV = sx + sy; tlX = sx; tlY = sy; }
        if (sx - sy > trV) { trV = sx - sy; trX = sx; trY = sy; }
        if (sx + sy > brV) { brV = sx + sy; brX = sx; brY = sy; }
        if (sx - sy < blV) { blV = sx - sy; blX = sx; blY = sy; }
      }
    }

    if (!found) {
      best.corners = null;
    } else {
      // ── Winkel aus den Masken-Eckpunkten ────────────────────────────────────
      // Auch eine spärliche Maske (nur Artwork-Bereich) liefert einen brauchbaren
      // Winkel über die Richtung tl→tr.
      const angle = Math.atan2(trY - tlY, trX - tlX);
      const cosA  = Math.cos(angle);
      const sinA  = Math.sin(angle);
      const aca   = Math.abs(cosA);
      const asa   = Math.abs(sinA);

      // ── Tatsächliche Karten-Dimensionen aus ONNX-AABB + Winkel ──────────────
      // Für ein W×H-Rechteck mit Neigung a gilt:
      //   AABB_W = W·|cos a| + H·|sin a|
      //   AABB_H = W·|sin a| + H·|cos a|
      // Lösung des 2×2-Systems (Determinante = cos(2a)):
      const cos2a = aca * aca - asa * asa;
      let estW: number, estH: number;
      if (Math.abs(cos2a) > 0.15) {
        estW = (aca * best.w - asa * best.h) / cos2a;
        estH = (aca * best.h - asa * best.w) / cos2a;
      } else {
        estW = NaN; // Marker für Fallback
        estH = NaN;
      }
      // Fallback: nahe 45° oder negative Lösung → Pokémon-Seitenverhältnis + Fläche
      if (!isFinite(estW) || !isFinite(estH) || estW <= 0 || estH <= 0) {
        const CARD_RATIO = 88 / 63; // ≈ 1.397
        estW = Math.sqrt(best.w * best.h / CARD_RATIO);
        estH = estW * CARD_RATIO;
      }
      // Hochformat sicherstellen (Pokémon-Karte ist immer höher als breit)
      if (estW > estH) { const tmp = estW; estW = estH; estH = tmp; }

      // ── Plausibilitätsprüfung ────────────────────────────────────────────────
      const shorter      = estW;
      const ratio        = estH / (estW || 1);
      const frameShorter = Math.min(srcW, srcH);

      if (
        shorter > frameShorter * 0.85 ||  // zu groß (iPhone-Display etc.)
        shorter < frameShorter * 0.06 ||  // zu klein (Regalrand-Querschnitt etc.)
        ratio < 1.05 || ratio > 2.3       // falsches Seitenverhältnis
      ) {
        return null;
      }

      // ── Rotierte Corners aus AABB-Zentrum + Winkel + Dimensionen ────────────
      // Koordinatensystem (y zeigt nach unten):
      //   rightDir = (cos a, sin a)
      //   downDir  = (−sin a, cos a)  [90° CCW auf Screen = "unten" auf Karte]
      const cx = best.x + best.w / 2;
      const cy = best.y + best.h / 2;
      const hw = estW / 2;
      const hh = estH / 2;

      best.corners = [
        [cx - hw * cosA + hh * sinA, cy - hw * sinA - hh * cosA], // tl
        [cx + hw * cosA + hh * sinA, cy + hw * sinA - hh * cosA], // tr
        [cx + hw * cosA - hh * sinA, cy + hw * sinA + hh * cosA], // br
        [cx - hw * cosA - hh * sinA, cy - hw * sinA + hh * cosA], // bl
      ];
    }
  }

  return best;
}
