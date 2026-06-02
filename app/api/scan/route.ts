import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getAdminDb } from '@/lib/firebase/admin';
import type { CatalogCard } from '@/lib/firestore/catalog';
import { catalogCardToInfo } from '@/lib/card-info';
import type { CardLanguage } from '@/types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const COL = 'tcg_catalog';

async function lookupCard(setId: string, number: string): Promise<CatalogCard | null> {
  const db = getAdminDb();
  // Primary: exact match setId + number
  const snap = await db.collection(COL)
    .where('setId', '==', setId)
    .where('number', '==', number)
    .limit(1)
    .get();
  if (!snap.empty) return snap.docs[0].data() as CatalogCard;

  // Fallback: only number within set (handles padded vs. unpadded variants)
  const snap2 = await db.collection(COL)
    .where('setId', '==', setId)
    .limit(300)
    .get();
  const match = snap2.docs.find(d => {
    const n = (d.data() as CatalogCard).number;
    return n === number || n.startsWith(number.split('/')[0]);
  });
  return match ? (match.data() as CatalogCard) : null;
}

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = await req.json();
    if (!imageBase64) return NextResponse.json({ error: 'No image provided' }, { status: 400 });

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent([
      { inlineData: { data: imageBase64, mimeType } },
      `You are a Pokémon TCG expert. Identify the card in this image.

Return ONLY a JSON object — no markdown, no explanation:
{
  "setId": "pokemontcg.io set ID, e.g. sv1, sv3pt5, base1, neo1",
  "number": "card number as printed, e.g. 049/198 or 1",
  "language": "ISO code: de | en | ja | fr | es | it | pt | ko | zh-hant",
  "confidence": "high | medium | low"
}

If no Pokémon card is visible, return: { "error": "No card detected" }

SetId reference (common sets):
- Scarlet & Violet base → sv1
- Paldea Evolved → sv2
- Obsidian Flames → sv3
- 151 → sv3pt5
- Paradox Rift → sv4
- Temporal Forces → sv5
- Twilight Masquerade → sv6
- Base Set → base1, Jungle → jungle, Fossil → fossil
- Neo Genesis → neo1, Neo Discovery → neo2`,
    ]);

    const text = result.response.text().trim();

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { error: 'Could not parse response' };
    }

    if (parsed.error) {
      return NextResponse.json({ error: parsed.error });
    }

    const { setId, number, language = 'de', confidence = 'low' } = parsed;

    if (!setId || !number) {
      return NextResponse.json({ error: 'Incomplete card data from vision model' });
    }

    // Firestore lookup (Admin SDK — no auth needed server-side)
    const catalogCard = await lookupCard(setId, number);

    if (!catalogCard) {
      return NextResponse.json({
        error: `Karte ${setId} #${number} nicht im Catalog`,
        setId,
        number,
        language,
        confidence,
      });
    }

    return NextResponse.json({
      card: catalogCardToInfo(catalogCard),
      language: language as CardLanguage,
      confidence,
    });
  } catch (err) {
    console.error('Scan error:', err);
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 });
  }
}
