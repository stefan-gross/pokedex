import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = await req.json();
    if (!imageBase64) return NextResponse.json({ error: 'No image provided' }, { status: 400 });

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const result = await model.generateContent([
      {
        inlineData: { data: imageBase64, mimeType },
      },
      `You are a Pokémon trading card expert. Analyze this image and identify the Pokémon card.
Return ONLY a JSON object with these fields:
{
  "name": "exact card name as printed on the card",
  "setName": "set name (e.g. Scarlet & Violet, Paldea Evolved)",
  "number": "card number as printed (e.g. 049/198)",
  "confidence": "high|medium|low",
  "isHolo": true/false,
  "isReverse": true/false
}
If you cannot identify a Pokémon card in the image, return { "error": "No card detected" }.
Return only the JSON, no markdown, no explanation.`,
    ]);

    const text = result.response.text().trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { error: 'Could not parse response' };
    }

    // Photo is not stored — used only for recognition
    return NextResponse.json(parsed);
  } catch (err) {
    console.error('Scan error:', err);
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 });
  }
}
