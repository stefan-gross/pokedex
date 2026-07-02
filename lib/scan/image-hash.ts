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

/** Schwellwerte lt. Plan: 0-11 match, 12-19 unsure, 20+ mismatch (von 64 möglichen Bits). */
export function classifyPHashDistance(distance: number): PHashClass {
  if (distance <= 11) return 'match';
  if (distance <= 19) return 'unsure';
  return 'mismatch';
}
