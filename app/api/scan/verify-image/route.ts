import { NextRequest, NextResponse } from 'next/server';
import { computeImageHash, hammingDistance, classifyPHashDistance } from '@/lib/scan/image-hash';

// Bild-Fetch (Katalog-CDN) + Hash-Vergleich — läuft server-seitig, weil
// images.pokemontcg.io keine CORS-Header sendet und ein Browser-Canvas
// die Pixel eines fremden Origins ohne CORS nicht auslesen darf.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, catalogImageUrl } = await req.json();
    if (!imageBase64 || !catalogImageUrl) {
      return NextResponse.json({ error: 'imageBase64 and catalogImageUrl required' }, { status: 400 });
    }

    const scannedBuffer = Buffer.from(imageBase64, 'base64');

    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 10_000);
    let catalogBuffer: Buffer;
    try {
      const res = await fetch(catalogImageUrl, { signal: ac.signal });
      if (!res.ok) throw new Error(`Catalog-Bild HTTP ${res.status}`);
      catalogBuffer = Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(to);
    }

    const [scannedHash, catalogHash] = await Promise.all([
      computeImageHash(scannedBuffer),
      computeImageHash(catalogBuffer),
    ]);

    const distance = hammingDistance(scannedHash, catalogHash);
    const classification = classifyPHashDistance(distance);

    return NextResponse.json({ distance, classification });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[verify-image] failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
