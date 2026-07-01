import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const PROMPT = `You are a Pokémon TCG card reader. Extract the printed information from this card image.

Read the printed text on the card precisely. The stamp area (set symbol + slash-number + rarity dot) can be at different positions depending on the card's era — scan the whole card border. Focus closely: small stamps are often partially obscured by glare and easy to mis-read.

WHAT TO READ:

setCode — the printed set abbreviation (2–4 contiguous uppercase letters):
  - Scarlet & Violet (2023+) cards have a letter code at BOTTOM-LEFT in the format
      "<RegMark> <CODE> <LANG> <NNN>/<TTT>",  e.g. "J ASC DE 005/217" → setCode = "ASC".
    The CODE sits between the regulation-mark (single letter D/E/F/G/H/I/J)
    and the language marker (DE/EN/FR/ES/IT/PT).
  - ALL pre-Scarlet&Violet cards (Sword&Shield, Sun&Moon, XY, B&W, HGSS, DPP,
    EX-era, Neo, Base/Jungle/Fossil) have only a GRAPHICAL set symbol at the
    stamp position — no letter code. → setCode = null.
  - Set-codes are IDENTICAL across DE/EN/FR/ES/IT/PT — only the language marker
    differs. (Japanese uses a different system, not covered here.)
  - NEVER return a single isolated letter, a language-marker (DE/EN), or a
    description of a symbol (e.g. "flame", "★"). If you see a symbol → null.

number — 1–3 digits before the slash in the "NNN/TTT" group. Stamp position
  varies by era: bottom-LEFT (S&V, SWSH) or bottom-RIGHT (all older). Always
  return only the digits before "/". If no slash-number exists (very old promo
  cards) → number = null.

language — German cards have "KP" (HP) and "Fähigkeit" (Ability).
  English cards have "HP" and "Ability". French has "PV" and "Talent" etc.

nationalDexNumber — VERY IMPORTANT: this is the fallback identifier when there
  is no letter set code. Always check carefully and parse as integer (drop leading
  zeros: "0271" → 271).
  - DE format: "Nr." or "Nr" followed by 3–4 digits, e.g. "Nr. 0271" (Lombrero).
    Typically printed in SMALL italic text in the BANNER between the Pokémon name
    and the artwork frame, often together with the genus, height, weight (e.g.
    "Nr. 0271 Frohmut-Pokémon Größe 1,2 m Gewicht 12,5 kg"). Sometimes also in
    the description area at the bottom of the card.
  - EN format: "NO." or "#" followed by 3–4 digits, e.g. "NO. 271" or "#271".
  - The digit length varies: 1–4 digits ("25", "025", "0271", "1025").
  - Position varies by era: name-banner area on modern cards (most common!),
    sometimes top-right (HGSS), sometimes inside the description block. SEARCH
    the WHOLE card text — do NOT only check the top corner.
  - null ONLY for Trainer cards, Energy cards, or if no "Nr."/"NO."/"#" prefix
    is visible anywhere. Do NOT invent a number from the collector-number stamp.

confidence — your own confidence in the result: "high" if everything is
  clearly readable, "medium" if some uncertainty, "low" if guessed.

EXAMPLES:

A) Bottom-LEFT stamp "J ASC DE 005/217"
   → { setCode: "ASC", number: "005", language: "de", confidence: "high" }
   (Scarlet & Violet DE — full letter code present)

B) Bottom-LEFT stamp "J SSP 142/191"
   → { setCode: "SSP", number: "142", language: "en", confidence: "high" }
   (Scarlet & Violet EN — full letter code present)

C) Card shows "BASIS 107/203" in the bottom-LEFT with a small icon
   (sun-with-E-letter); no 2–4 letter code visible
   → { setCode: null, number: "107", language: "de", confidence: "high" }
   (Sword & Shield era — symbol only, no letter code)

D) Card shows "078/202" in the bottom-LEFT with a circular set symbol
   → { setCode: null, number: "078", language: "en", confidence: "high" }
   (SWSH/SM/XY EN — symbol only)

E) Trainer card "Doppelball" (HGSS-era, "TRAINER" printed sideways on
   the left edge). Stamp "72/95" + symbol + rarity dot is in the
   BOTTOM-RIGHT corner of the card (in reading orientation)
   → { setCode: null, number: "072", language: "de", confidence: "high" }
   (pre-2020 — stamp at bottom-right, no letter code)

F) Base Set Pikachu — small set icon in bottom-right, no slash-number
   → { setCode: null, number: null, language: "en", confidence: "medium" }

G) Lombrero card with banner "Nr. 0271 Frohmut-Pokémon Größe 1,2 m Gewicht 12,5 kg",
   bottom-LEFT stamp "006/094" + set symbol (sun-with-E), no letter code
   → { setCode: null, number: "006", language: "de", confidence: "high",
       nationalDexNumber: 271, name: "Lombrero" }
   (CRITICAL: read Dex from the banner text, parse "0271" as integer 271)

H) HGSS Trainer "Doppelball" — top of card shows "TRAINER" sideways on the
   left edge, large name "Doppelball" centered, no Pokédex number (Trainer
   cards have no Pokémon dex), stamp "72/95" + set symbol bottom-RIGHT
   → { setCode: null, number: "072", language: "de", confidence: "high",
       nationalDexNumber: null, name: "Doppelball" }

ALSO read the printed card name (large text at the top — Pokémon name, Trainer
card name, or Energy card name). Return it verbatim including hyphens and
language-specific spelling: "Galar-Flunschlik", "Doppelball", "Charizard ex",
"Glurak ex", "Boss's Orders". This name is critical as a fallback identifier
when the set code is hidden by a symbol.

If no Pokémon card is visible at all: set "error" to "No card detected" and
leave the other fields null.`;

const SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    error: {
      type: SchemaType.STRING,
      nullable: true,
      description: 'Set this when no Pokémon card is visible',
    },
    setCode: {
      type: SchemaType.STRING,
      nullable: true,
      description: '2-4 uppercase letters or null when only a graphical set symbol is shown',
    },
    number: {
      type: SchemaType.STRING,
      nullable: true,
      description: 'Card number digits only, no slash',
    },
    name: {
      type: SchemaType.STRING,
      nullable: true,
      description: 'Printed card name (Pokémon/Trainer/Energy) verbatim, including hyphens — e.g. "Galar-Flunschlik", "Doppelball"',
    },
    language: {
      type: SchemaType.STRING,
      enum: ['de', 'en', 'ja', 'fr', 'es', 'it', 'pt', 'ko', 'zh-hant'],
    },
    confidence: {
      type: SchemaType.STRING,
      enum: ['high', 'medium', 'low'],
    },
    nationalDexNumber: {
      type: SchemaType.INTEGER,
      nullable: true,
    },
  },
  required: ['language', 'confidence'],
};

// Fallback-Kette: schnellstes Modell zuerst, bei 503 weiterprobieren.
const MODEL_FALLBACKS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest'];

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = await req.json();
    if (!imageBase64) return NextResponse.json({ error: 'No image provided' }, { status: 400 });

    let lastError: string = 'Scan failed';
    for (const modelName of MODEL_FALLBACKS) {
      const t0 = Date.now();
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: 'application/json',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            responseSchema: SCHEMA as any,
          },
        });
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
          // Safety-Net: falls Schema-Output doch fehlerhaft ist
          const match = rawText.match(/\{[\s\S]*\}/);
          parsed = match ? JSON.parse(match[0]) : { error: 'Could not parse response' };
        }

        // Nummer-Normalisierung: "049/198" → "049"
        if (typeof parsed.number === 'string' && parsed.number.includes('/')) {
          parsed.number = parsed.number.split('/')[0];
        }

        console.log(`[scan] ${modelName} OK in ${ms}ms`);

        parsed._debug = { model: modelName, ms, rawText };
        return NextResponse.json(parsed);
      } catch (err) {
        const ms = Date.now() - t0;
        console.warn(`[scan] ${modelName} failed after ${ms}ms:`, err);
        lastError = err instanceof Error ? err.message : String(err);
        const is503 = lastError.includes('503') || lastError.includes('high demand') || lastError.includes('overloaded');
        if (!is503) break;
        console.warn(`${modelName} unavailable (503), trying fallback...`);
      }
    }

    console.error('All Gemini models failed:', lastError);
    return NextResponse.json({ error: `Scan failed: ${lastError}` }, { status: 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Scan error:', msg);
    return NextResponse.json({ error: `Scan failed: ${msg}` }, { status: 500 });
  }
}
