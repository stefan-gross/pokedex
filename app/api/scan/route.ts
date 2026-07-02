import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType, Part } from '@google/generative-ai';
import { getReferenceSheets } from '@/lib/scan/reference-sheets';

// Zwei sequenzielle Gemini-Calls (Text-OCR + ggf. Symbol-Abgleich) + Sheet-Aufbau
// beim Kaltstart brauchen mehr als das Vercel-Default-Timeout.
export const maxDuration = 60;

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

// Schritt 2 (nur bei setCode=null + erkannter Karte): Symbol-Abgleich gegen
// beschriftete Referenzblätter mit den echten Set-Symbolen (siehe lib/scan/reference-sheets.ts).
const PROMPT_SYMBOL_MATCH = `You already read some info from a Pokémon TCG card photo (image 1), but its
set stamp is only a small GRAPHICAL symbol with no text code, so the set could not be
identified from OCR alone.

The following image(s) are labeled reference sheets: each shows a grid of official
Pokémon TCG set symbols, every icon labeled underneath with its set code (e.g. "BRS")
and set name.

Look closely at the small stamp symbol next to the collector number on the ORIGINAL
card (image 1) — it is usually near the bottom of the card, next to the number and a
rarity dot. Compare it visually against the symbols on the reference sheets and find
the one that matches.

Return the set code label of the best-matching symbol. If two or more symbols look
nearly identical (e.g. similar abstract shapes from the same era) and you cannot
confidently pick one, set matchAmbiguous to true and still return your best guess —
or matchedSetCode: null if truly indistinguishable.`;

const SYMBOL_MATCH_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    matchedSetCode: {
      type: SchemaType.STRING,
      nullable: true,
      description: 'ptcgoCode of the set whose symbol on the reference sheet(s) best matches the stamp icon on the card, or null if no confident match',
    },
    matchConfidence: {
      type: SchemaType.STRING,
      enum: ['high', 'medium', 'low'],
    },
    matchAmbiguous: {
      type: SchemaType.BOOLEAN,
      description: 'true if multiple symbols on the sheets look very similar and the match is uncertain',
    },
  },
  required: ['matchConfidence'],
};

// Fallback-Kette: schnellstes Modell zuerst, bei 503 weiterprobieren.
const MODEL_FALLBACKS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest'];

interface GenerateResult {
  parsed: Record<string, unknown>;
  modelName: string;
  modelIndex: number;
  ms: number;
  rawText: string;
}

/** Ruft Gemini mit Fallback-Kette auf (ab startIndex), bricht bei nicht-503-Fehlern sofort ab. */
async function generateWithFallback(
  parts: (string | Part)[],
  schema: Record<string, unknown>,
  startIndex: number,
): Promise<GenerateResult> {
  let lastError = 'Scan failed';
  for (let i = startIndex; i < MODEL_FALLBACKS.length; i++) {
    const modelName = MODEL_FALLBACKS[i];
    const t0 = Date.now();
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          responseSchema: schema as any,
        },
      });
      const result = await model.generateContent(parts);
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

      console.log(`[scan] ${modelName} OK in ${ms}ms`);
      return { parsed, modelName, modelIndex: i, ms, rawText };
    } catch (err) {
      const ms = Date.now() - t0;
      console.warn(`[scan] ${modelName} failed after ${ms}ms:`, err);
      lastError = err instanceof Error ? err.message : String(err);
      const is503 = lastError.includes('503') || lastError.includes('high demand') || lastError.includes('overloaded');
      if (!is503) throw new Error(lastError);
      console.warn(`${modelName} unavailable (503), trying fallback...`);
    }
  }
  throw new Error(lastError);
}

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = await req.json();
    if (!imageBase64) return NextResponse.json({ error: 'No image provided' }, { status: 400 });

    let step1: GenerateResult;
    try {
      step1 = await generateWithFallback(
        [{ inlineData: { data: imageBase64, mimeType } }, PROMPT],
        SCHEMA,
        0,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('All Gemini models failed:', msg);
      return NextResponse.json({ error: `Scan failed: ${msg}` }, { status: 500 });
    }

    const parsed = step1.parsed;

    // Nummer-Normalisierung: "049/198" → "049"
    if (typeof parsed.number === 'string' && parsed.number.includes('/')) {
      parsed.number = parsed.number.split('/')[0];
    }

    // Schritt 2: Symbol-Abgleich per Referenzblatt, nur wenn Schritt 1 eine echte
    // Karte mit reinem Grafik-Stempel (setCode=null) gemeldet hat. Läuft komplett
    // isoliert — jeder Fehler hier degradiert stillschweigend auf das heutige
    // Verhalten (Name+Nummer-Fallback im Client), niemals ein Hard-Fail der Route.
    //
    // WICHTIG (Debugging-Hinweis): Dieser Trigger greift NUR, wenn Gemini in Schritt 1
    // ehrlich setCode=null meldet. Halluziniert Gemini stattdessen direkt einen falschen
    // Text-Code (das war der ursprüngliche Bug), wird Schritt 2 gar nicht erst ausgelöst —
    // `_symbolMatch.triggered` unten macht genau das im Debug-Modal sichtbar.
    const looksSymbolOnly = parsed.setCode == null && !parsed.error
      && (parsed.number != null || parsed.name != null || parsed.nationalDexNumber != null);

    if (!looksSymbolOnly) {
      parsed._symbolMatch = {
        triggered: false,
        reason: parsed.error
          ? 'Schritt 1 meldete einen Fehler'
          : parsed.setCode != null
            ? `Schritt 1 lieferte bereits setCode="${parsed.setCode}" (Text-OCR, ungeprüft)`
            : 'Schritt 1 hatte keine verwertbaren Identifier (number/name/dex)',
      };
    } else {
      const t1 = Date.now();
      try {
        const sheets = await getReferenceSheets();
        const sheetBuildMs = Date.now() - t1;
        if (sheets.length > 0) {
          const contextLine = `Original card (from a first read): number=${parsed.number ?? 'unknown'}, name=${parsed.name ?? 'unknown'}.`;
          const step2Parts: (string | Part)[] = [
            { inlineData: { data: imageBase64, mimeType } },
            ...sheets.map(s => ({ inlineData: { data: s.buffer.toString('base64'), mimeType: s.mimeType } })),
            `${PROMPT_SYMBOL_MATCH}\n\n${contextLine}`,
          ];
          const step2 = await generateWithFallback(step2Parts, SYMBOL_MATCH_SCHEMA, step1.modelIndex);
          const matched = step2.parsed.matchedSetCode;
          if (typeof matched === 'string' && matched) {
            parsed.setCode = matched;
          }
          parsed._symbolMatch = {
            triggered: true,
            matchedSetCode: matched ?? null,
            matchConfidence: step2.parsed.matchConfidence ?? null,
            matchAmbiguous: step2.parsed.matchAmbiguous ?? false,
            sheetsUsed: sheets.map(s => s.label),
            sheetBuildMs,
            model: step2.modelName,
            ms: step2.ms,
            rawText: step2.rawText,
          };
          console.log(`[scan] symbol-match ${step2.modelName} OK in ${step2.ms}ms (sheets built in ${sheetBuildMs}ms) → ${matched ?? 'no match'}`);
        } else {
          parsed._symbolMatch = { triggered: false, reason: 'Keine Referenzblätter verfügbar (0 Sets geladen)', sheetBuildMs };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[scan] symbol-match step failed, degrading to name+number fallback:', err);
        parsed._symbolMatch = { triggered: true, error: msg, sheetBuildMs: Date.now() - t1 };
      }
    }

    parsed._debug = { model: step1.modelName, ms: step1.ms, rawText: step1.rawText };
    return NextResponse.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Scan error:', msg);
    return NextResponse.json({ error: `Scan failed: ${msg}` }, { status: 500 });
  }
}
