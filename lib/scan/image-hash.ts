import sharp from 'sharp';

const SIZE = 32;      // 32×32 Graustufen-Raster
const BLOCKS = 8;      // 8×8 Blöcke à 4×4 Pixel → 64-Bit Hash
const BLOCK_PX = SIZE / BLOCKS;

export type PHashClass = 'match' | 'unsure' | 'mismatch';

/** Block-Mean-Value-Hash: robuster gegen Rauschen/Kompressionsartefakte als
 *  ein direktes 8×8-Resize, weil erst auf 32×32 skaliert und dann pro
 *  4×4-Block gemittelt wird, bevor der 64-Bit-Hash gebildet wird. */
export async function computeImageHash(buffer: Buffer): Promise<bigint> {
  const { data } = await sharp(buffer)
    .resize(SIZE, SIZE, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const blockMeans: number[] = [];
  for (let by = 0; by < BLOCKS; by++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      let sum = 0;
      for (let y = 0; y < BLOCK_PX; y++) {
        for (let x = 0; x < BLOCK_PX; x++) {
          const px = (by * BLOCK_PX + y) * SIZE + (bx * BLOCK_PX + x);
          sum += data[px];
        }
      }
      blockMeans.push(sum / (BLOCK_PX * BLOCK_PX));
    }
  }

  const overallMean = blockMeans.reduce((a, b) => a + b, 0) / blockMeans.length;

  const ZERO = BigInt(0);
  const ONE = BigInt(1);
  let hash = ZERO;
  for (const m of blockMeans) {
    hash = (hash << ONE) | (m >= overallMean ? ONE : ZERO);
  }
  return hash;
}

export function hammingDistance(a: bigint, b: bigint): number {
  const ZERO = BigInt(0);
  const ONE = BigInt(1);
  let x = a ^ b;
  let count = 0;
  while (x > ZERO) {
    count += Number(x & ONE);
    x >>= ONE;
  }
  return count;
}

/**
 * Datenbasiert kalibriert an den realen `scan_history`-Fotos (2026-08-23,
 * n=7 korrekte Treffer mit Katalogbild): Distanzen [4,14,15,17,18,18,34] →
 * 6/7 liegen ≤18, ein Ausreißer bei 34 (schlechtes Foto). Der bekannte
 * Fehltreffer (Bidiza fälschlich als Sharfax/BRS) lag bei 28.
 *
 * Konsequenz: die frühere Mismatch-Linie bei 28 färbte korrekte (aber schlecht
 * fotografierte) Scans rot. Neue Bänder:
 *  - match ≤ 20: grün nur bei echter Sicherheit (deckt das beobachtete Cluster
 *    ≤18 mit etwas Luft),
 *  - unsure 21–31: gelb „bitte prüfen" — fängt auch den Fehltreffer@28 als
 *    Warnung, ohne korrekte Grenzfälle hart abzulehnen,
 *  - mismatch ≥ 32: rot nur „schlechter als Zufall" (32 = Erwartungswert der
 *    Hamming-Distanz zweier zufälliger 64-Bit-Hashes).
 * Der Rahmen ist nur ein Hinweis (kein Auto-Löschen). Weiter nachjustieren bei
 * mehr realen Scans.
 */
export function classifyPHashDistance(distance: number): PHashClass {
  if (distance <= 20) return 'match';
  if (distance <= 31) return 'unsure';
  return 'mismatch';
}
