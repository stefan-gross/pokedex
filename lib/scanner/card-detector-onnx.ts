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
const CONF_THRESHOLD   = 0.45;

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
  canvas: HTMLCanvasElement
): Promise<CardBox | null> {
  if (!session) return null;

  // 1. Frame auf 640×640 skalieren, RGB Float32 channel-first [1, 3, 640, 640]
  const off = new OffscreenCanvas(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const ctx = off.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
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

  // 3. Output0 parsen: [1, 38, 8400]
  //    Zeile 0–3: cx, cy, w, h (in 640×640 Koordinaten)
  //    Zeile 4:   Card-score (sigmoid, 0–1)
  //    Zeile 5:   Name-score (ignoriert)
  //    Zeile 6–37: Masken-Koeffizienten (ignoriert)
  const out         = outputs['output0'].data as Float32Array;
  const numAnchors  = 8400;
  const scaleX      = canvas.width  / MODEL_INPUT_SIZE;
  const scaleY      = canvas.height / MODEL_INPUT_SIZE;

  let best: CardBox | null = null;

  for (let i = 0; i < numAnchors; i++) {
    const cardConf = out[(4 + CLASS_CARD) * numAnchors + i];
    if (cardConf < CONF_THRESHOLD) continue;

    const cx = out[0 * numAnchors + i];
    const cy = out[1 * numAnchors + i];
    const w  = out[2 * numAnchors + i];
    const h  = out[3 * numAnchors + i];

    if (!best || cardConf > best.conf) {
      best = {
        x: (cx - w / 2) * scaleX,
        y: (cy - h / 2) * scaleY,
        w: w * scaleX,
        h: h * scaleY,
        conf: cardConf,
      };
    }
  }

  return best;
}
