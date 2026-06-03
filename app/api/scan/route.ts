import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = await req.json();
    if (!imageBase64) return NextResponse.json({ error: 'No image provided' }, { status: 400 });

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent([
      { inlineData: { data: imageBase64, mimeType } },
      `You are a Pokémon TCG expert. Identify the card in this image.

CARD LAYOUT — where to look:
- BOTTOM-RIGHT corner: card number printed as "NNN/TTT" — return ONLY the NNN part (e.g. "049", NOT "049/198"). Promo cards: "SVPXXX" → return "SVPXXX".
- BOTTOM-LEFT corner: small set symbol icon + a short printed code (e.g. "TEF", "OBF", "SV01"). Use this to identify the setId.
- Language: German cards say "KP" (not HP), "Fähigkeit" (Ability), "Angriff" (Attack). Japanese cards use Japanese text.

Return ONLY this JSON — no markdown, no explanation:
{
  "setId": "pokemontcg.io set ID",
  "number": "card number only — digits and letters, NO slash, NO total (e.g. 049 not 049/198)",
  "language": "de | en | ja | fr | es | it | pt | ko | zh-hant",
  "confidence": "high | medium | low",
  "nationalDexNumber": null
}

If the card shows a Pokémon (not Trainer/Energy), also set "nationalDexNumber" to the Pokédex number if visible on the card, otherwise null.

If no Pokémon card is visible, return: { "error": "No card detected" }

SET REFERENCE — printed code → pokemontcg.io setId:
Scarlet & Violet era:
  SVP / SVP-EN → svp
  SV01 / SVI / SVE → sv1  (Scarlet & Violet base, 2023)
  SV02 / PAL → sv2  (Paldea Evolved)
  SV03 / OBF → sv3  (Obsidian Flames)
  SV03.5 / MEW / 151 → sv3pt5  (Pokémon 151)
  SV04 / PAR → sv4  (Paradox Rift)
  SV05 / TEF → sv5  (Temporal Forces)
  SV06 / TWM → sv6  (Twilight Masquerade)
  SV07 / SCR → sv7  (Stellar Crown)
  SV08 / SSP → sv8  (Surging Sparks)
  SV08.5 / PRE → sv8pt5  (Prismatic Evolutions, 2025)
  SV09 / JTG → sv9  (Journey Together, 2025)
  SV09.5 / SFA → sv9pt5  (Scarlet & Violet Black Star Promos)
Sword & Shield era:
  SWSH01 / SSH → swsh1
  SWSH02 / RCL → swsh2
  SWSH03 / DAA → swsh3
  SWSH04 / VIV → swsh4
  SWSH04.5 / SHF → swsh4pt5
  SWSH05 / BST → swsh5
  SWSH06 / CRE → swsh6
  SWSH07 / EVS → swsh7
  SWSH08 / FUS → swsh8
  SWSH09 / BRS → swsh9
  SWSH10 / ASR → swsh10
  SWSH11 / LOR → swsh11
  SWSH12 / SIT → swsh12
  SWSH12.5 / CRZ → swsh12pt5
Sun & Moon era: sm1–sm12, sm12pt5
XY era: xy1–xy12
Black & White era: bw1–bw11
Classic sets (only symbol, no printed code — identify visually):
  No symbol / no mark → base1  (Base Set, 1999)
  Jungle leaf icon → jungle
  Fossil ammonite/spiral → fossil
  Same as Base Set but with "2" text → base2
  "R" rocket logo → team-rocket
  Gym badge shapes → gym1 (Gym Heroes) or gym2 (Gym Challenge)
  Silver circle/ring → neo1 (Neo Genesis)
  Spiral/diamond crystal → neo2 (Neo Discovery)
  Dark spiral → neo3 (Neo Revelation)
  Large spiral/destiny → neo4 (Neo Destiny)
  Legend triangle/sun → ex series (exand, ex1–ex16)`,
    ]);

    const text = result.response.text().trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { error: 'Could not parse response' };
    }

    // Nummer-Normalisierung: "049/198" → "049", führende Nullen bleiben erhalten
    if (typeof parsed.number === 'string' && parsed.number.includes('/')) {
      parsed.number = parsed.number.split('/')[0];
    }

    return NextResponse.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Scan error:', msg);
    return NextResponse.json({ error: `Scan failed: ${msg}` }, { status: 500 });
  }
}
