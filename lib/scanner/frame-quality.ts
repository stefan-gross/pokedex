/**
 * Live-Scanqualität: billige Bildmetriken aus dem ohnehin je Tick vorhandenen
 * Kamera-Sample-Puffer (kein zusätzlicher Readback, kein API-Call). Aus den
 * Metriken wird eine Ampel-Bewertung mit kurzem Hinweistext abgeleitet.
 *
 * Reine Funktionen (kein DOM/State) → in Isolation testbar. Die Schwellen
 * (QUALITY_THRESHOLDS) sind Startwerte und brauchen Feinjustierung am echten
 * Gerät (dafür der Debug-Modus „Scannen").
 */

export type QualityLevel = 'neutral' | 'red' | 'yellow' | 'green';

export interface PixelMetrics {
  /** Laplace-Varianz — niedrig = unscharf/verwackelt. */
  sharpness: number;
  /** Anteil (0..1) nahezu ausgebrannter Pixel (Luminanz ≥ 248) = harte Reflexion. */
  glare: number;
  /** Anteil (0..1) weich-heller Pixel (Luminanz ≥ 210) — fängt milchig-
   *  schleierhafte Reflexion, die nicht ausbrennt, aber Text überlagert. */
  softGlare: number;
  /** Mittlere Luminanz 0..255. */
  meanLum: number;
  /** Kontrast (p98 − p2) 0..255. */
  contrast: number;
}

export interface QualityInput extends PixelMetrics {
  /** Flächenanteil der erkannten Karte am Kamerabild (0..1). */
  fill: number;
}

export interface QualityResult {
  level: QualityLevel;
  reason: string | null;
}

export const QUALITY_THRESHOLDS = {
  sharpMin: 55,       // < → unscharf
  glareMax: 0.06,     // > 6 % hart ausgebrannt → Reflexion
  lumMin: 55,         // < → zu dunkel
  lumMax: 218,        // > → überbelichtet
  contrastMin: 42,    // < → zu wenig Kontrast
  fillMin: 0.14,      // < → Karte zu klein / zu weit weg
  // Schleier-Reflexion: milchiger Wasch-Glanz brennt nicht aus, hebt aber
  // Helligkeit + Weich-Hell-Anteil. Nur wenn BEIDE zutreffen → verhindert
  // Fehlalarm bei normal hellen Karten mit weißem Rand (hoher Soft-Anteil,
  // aber normale mittlere Helligkeit). Startwerte, am Gerät justieren.
  veilLumMin: 118,    // mittlere Luminanz darüber = auffällig hell
  veilSoftMin: 0.16,  // Anteil weich-heller Pixel darüber = großflächiger Glanz
};

/** Bildmetriken über einen RGBA-Puffer (`ImageData.data`). */
export function computePixelMetrics(data: Uint8ClampedArray, w: number, h: number): PixelMetrics {
  const N = w * h;
  if (N === 0) return { sharpness: 0, glare: 0, softGlare: 0, meanLum: 0, contrast: 0 };

  const gray = new Float32Array(N);
  const hist = new Uint32Array(32);
  let sum = 0, glareCount = 0, softGlareCount = 0;
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    // Integer-Rec.601 (wie im ONNX-Detektor)
    const l = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8;
    gray[i] = l;
    sum += l;
    if (l >= 248) glareCount++;
    if (l >= 210) softGlareCount++;
    hist[l >> 3]++;
  }
  const meanLum = sum / N;

  // Kontrast über kumulatives Histogramm (2./98. Perzentil-Bucket → Luminanz).
  const p2t = N * 0.02, p98t = N * 0.98;
  let cum = 0, p2b = 0, p98b = 31, got2 = false;
  for (let b = 0; b < 32; b++) {
    cum += hist[b];
    if (!got2 && cum >= p2t) { p2b = b; got2 = true; }
    if (cum >= p98t) { p98b = b; break; }
  }
  const contrast = Math.max(0, (p98b - p2b) * 8);

  // Laplace-Varianz über die Innenpixel (Schärfe-Maß).
  let lsum = 0, lsq = 0, ln = 0;
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = row + x;
      const lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - w] - gray[idx + w];
      lsum += lap; lsq += lap * lap; ln++;
    }
  }
  const lmean = ln ? lsum / ln : 0;
  const sharpness = ln ? Math.max(0, lsq / ln - lmean * lmean) : 0;

  return { sharpness, glare: glareCount / N, softGlare: softGlareCount / N, meanLum, contrast };
}

/** Ampel-Bewertung + Grund. Priorität: Lage → Beleuchtung → Reflexion →
 *  Schärfe → Kontrast → Stabilität. Grün nur, wenn alles passt und die Box ruht. */
export function assessQuality(
  m: QualityInput,
  geom: { boxSettled: boolean; boxFullyInside: boolean },
): QualityResult {
  const T = QUALITY_THRESHOLDS;
  if (!geom.boxFullyInside)        return { level: 'yellow', reason: 'Ganz in den Rahmen' };
  if (m.fill < T.fillMin)          return { level: 'yellow', reason: 'Näher heran' };
  if (m.meanLum < T.lumMin)        return { level: 'red', reason: 'Zu dunkel' };
  if (m.meanLum > T.lumMax)        return { level: 'red', reason: 'Überbelichtet' };
  if (m.glare > T.glareMax)        return { level: 'red', reason: 'Reflexion' };
  if (m.meanLum > T.veilLumMin && m.softGlare > T.veilSoftMin)
                                   return { level: 'red', reason: 'Reflexion' };
  if (m.sharpness < T.sharpMin)    return { level: 'red', reason: 'Unscharf' };
  if (m.contrast < T.contrastMin)  return { level: 'yellow', reason: 'Mehr Kontrast' };
  if (!geom.boxSettled)            return { level: 'yellow', reason: 'Ruhig halten' };
  return { level: 'green', reason: null };
}
