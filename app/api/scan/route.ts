import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

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

Common setId reference:
- Scarlet & Violet base → sv1
- Paldea Evolved → sv2
- Obsidian Flames → sv3
- 151 → sv3pt5
- Paradox Rift → sv4
- Temporal Forces → sv5
- Twilight Masquerade → sv6
- Stellar Crown → sv7
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

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('Scan error:', err);
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 });
  }
}
