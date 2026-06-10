import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Auth-freie Variante von /api/scan für den POC der Native-App.
 * Schutz über statisches Bearer-Token (env: SCAN_PUBLIC_TOKEN).
 * Identische Gemini-Pipeline wie /api/scan.
 */

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const PROMPT = `You are a Pokémon TCG card reader. Extract the printed information from this card image.

WHAT TO READ:
- Set code: the short letter abbreviation in the small stamp at the card bottom
  - Modern format: regulation mark letter + stamp, e.g. "J ASC DE 005/217"
    → setCode = "ASC"  (ignore regulation mark "J" and language marker "DE")
  - English modern: "J SSP 142/191" → setCode = "SSP"
  - Older cards without a printed code (Base Set, Jungle, Fossil etc.): setCode = null
- Card number: the NNN part of NNN/TTT, return ONLY digits (e.g. "142", NOT "142/191")
- Language: German cards say "KP" (not HP) and "Fähigkeit" (Ability)
- National Pokédex number: "Nr. XXXX" on German, "#XXX" on English cards. null if not a Pokémon.

CARD CONDITION — examine corners, edges, and surface at close range (~12–15 cm):
  "nm": near mint — no visible wear, sharp corners, clean surface
  "lp": lightly played — minor corner/edge whitening, tiny surface marks, still looks good
  "mp": moderately played — noticeable edge wear, corner whitening, visible scratches
  "hp": heavily played — heavy corner/edge damage, deep scratches, significant marks
  "d":  damaged — visible creases, bends, tears, or major surface damage
  Default to "nm" if nothing is clearly visible.

FAKE DETECTION — examine print quality carefully:
  "low": fonts sharp and correct, colors accurate, set symbol matches known design → genuine
  "medium": minor issues (slightly off colors, fonts look close but not exact)
  "high": obvious problems (blurry text, wrong fonts, incorrect energy symbols, wrong layout)

Return ONLY this JSON — no markdown, no explanation:
{
  "setCode": "printed set abbreviation as-is, or null",
  "number": "card number digits only, no slash",
  "language": "de | en | ja | fr | es | it | pt | ko | zh-hant",
  "confidence": "high | medium | low",
  "nationalDexNumber": null,
  "condition": "nm | lp | mp | hp | d",
  "fakeRisk": "low | medium | high",
  "fakeReasons": []
}

fakeReasons: list specific issues, e.g. ["blurry text", "wrong font"]. Empty array [] if genuine.

If no Pokémon card is visible: { "error": "No card detected" }`;

const MODEL_FALLBACKS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest'];

export async function POST(req: NextRequest) {
  try {
    // Bearer-Token-Check: verhindert dass jeder im Internet unsere Gemini-Quote
    // leerlutscht. Wenn SCAN_PUBLIC_TOKEN nicht gesetzt ist, Route deaktiviert.
    const expectedToken = process.env.SCAN_PUBLIC_TOKEN;
    if (!expectedToken) {
      return NextResponse.json({ error: 'Public scan disabled' }, { status: 503 });
    }
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { imageBase64, mimeType = 'image/jpeg' } = await req.json();
    if (!imageBase64) return NextResponse.json({ error: 'No image provided' }, { status: 400 });

    let lastError: string = 'Scan failed';
    for (const modelName of MODEL_FALLBACKS) {
      const t0 = Date.now();
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([
          { inlineData: { data: imageBase64, mimeType } },
          PROMPT,
        ]);
        const ms = Date.now() - t0;

        const rawText = result.response.text().trim();
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          const match = rawText.match(/\{[\s\S]*\}/);
          parsed = match ? JSON.parse(match[0]) : { error: 'Could not parse response' };
        }

        if (typeof parsed.number === 'string' && parsed.number.includes('/')) {
          parsed.number = parsed.number.split('/')[0];
        }

        console.log(`[scan-public] ${modelName} OK in ${ms}ms`);
        parsed._debug = { model: modelName, ms, rawText };
        return NextResponse.json(parsed);
      } catch (err) {
        const ms = Date.now() - t0;
        console.warn(`[scan-public] ${modelName} failed after ${ms}ms:`, err);
        lastError = err instanceof Error ? err.message : String(err);
        const is503 = lastError.includes('503') || lastError.includes('high demand') || lastError.includes('overloaded');
        if (!is503) break;
      }
    }

    return NextResponse.json({ error: `Scan failed: ${lastError}` }, { status: 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Scan failed: ${msg}` }, { status: 500 });
  }
}
