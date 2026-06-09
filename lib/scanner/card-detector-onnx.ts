'use client';

/**
 * ONNX-basierte Pokémon-Kartenerkennung via YOLOv11n-seg Modell.
 *
 * Modell: ferrari-yolo/pokemon-card-detection-3 (Roboflow, lokal trainiert)
 * Klassen: Card (0), Name (1)
 * Output0-Shape: [1, 38, 8400] = 4 bbox + 2 class-scores + 32 mask-koeffizienten
 *
 * Wir lesen nur bbox + Card-class-score; Masken werden ignoriert.
 */

import * as ort from 'onnxruntime-web';

const MODEL_PATH       = '/models/card-detector.onnx';
const MODEL_INPUT_SIZE = 640;
const CONF_THRESHOLD   = 0.60; // 0.45 produziert zu viele Falsch-Positive

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
    session = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['wasm'],
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
}

/**
 * Erkennt die beste Pokémon-Karte im Canvas-Frame.
 * Gibt null zurück wenn keine Karte mit conf >= CONF_THRESHOLD gefunden.
 */
export async function detectCardInFrame(
  source: HTMLCanvasElement | HTMLVideoElement
): Promise<CardBox | null> {
  if (!session) return null;

  // Quell-Dimensionen ermitteln (Video vs Canvas)
  const srcW = source instanceof HTMLVideoElement ? source.videoWidth  : source.width;
  const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!srcW || !srcH) return null;

  // 1. Vollbild mit Letterboxing auf 640×640 skalieren (kein Ausschnitt!)
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
    t[i]         = px[i * 4]     / 255; // R
    t[N + i]     = px[i * 4 + 1] / 255; // G
    t[2 * N + i] = px[i * 4 + 2] / 255; // B
  }

  // 2. Inferenz
  const inputTensor = new ort.Tensor('float32', t, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
  const outputs = await session.run({ images: inputTensor });

  // DEBUG: Output-Struktur einmalig loggen
  if (!(detectCardInFrame as { _debugged?: boolean })._debugged) {
    (detectCardInFrame as { _debugged?: boolean })._debugged = true;
    for (const [key, tensor] of Object.entries(outputs)) {
      console.log(`[ONNX] output key="${key}" shape=${JSON.stringify(tensor.dims)} type=${tensor.type}`);
    }
  }

  // 3. Output0 parsen: erwartetes Format [1, 38, 8400]
  //    Layout features-first: Zeile k = out[k * numAnchors + i]
  //    Zeile 0–3: cx, cy, w, h | Zeile 4: Card-score | Zeile 5: Name-score
  const outTensor   = outputs['output0'] ?? outputs[Object.keys(outputs)[0]];
  const out         = outTensor.data as Float32Array;
  const dims        = outTensor.dims; // z.B. [1, 38, 8400]
  // Unterstützt beide Layouts: [1, F, N] und [1, N, F]
  const isFeatureFirst = dims[1] < dims[2]; // F < N → features-first
  const numFeatures = isFeatureFirst ? dims[1] : dims[2];
  const numAnchors  = isFeatureFirst ? dims[2] : dims[1];
  // Letterboxing rückgängig: Modell-Koordinaten → Original-Quell-Koordinaten
  const toSrcX = (mx: number) => (mx - padX) / scale;
  const toSrcY = (my: number) => (my - padY) / scale;

  const getVal = (feat: number, anchor: number) =>
    isFeatureFirst ? out[feat * numAnchors + anchor] : out[anchor * numFeatures + feat];

  let best: CardBox | null = null;
  let maxConf = 0;

  for (let i = 0; i < numAnchors; i++) {
    const cardConf = getVal(4 + CLASS_CARD, i);
    if (cardConf < CONF_THRESHOLD) continue;
    if (cardConf > maxConf) maxConf = cardConf;

    const cx = getVal(0, i);
    const cy = getVal(1, i);
    const w  = getVal(2, i);
    const h  = getVal(3, i);

    if (!best || cardConf > best.conf) {
      // Letterboxing rückgängig → Koordinaten in Quell-Dimensionen (Video oder Canvas)
      best = {
        x: toSrcX(cx - w / 2),
        y: toSrcY(cy - h / 2),
        w: w / scale,
        h: h / scale,
        conf: cardConf,
      };
    }
  }

  if (best) console.log(`[ONNX] Card detected conf=${best.conf.toFixed(2)}`);
  else console.log(`[ONNX] No card (maxConf=${maxConf.toFixed(3)}, threshold=${CONF_THRESHOLD})`);

  return best;
}
