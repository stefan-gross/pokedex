import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType, Part } from '@google/generative-ai';
import { getReferenceSheets, getValidSymbolSetCodes } from '@/lib/scan/reference-sheets';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';

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

printedTotal — the digits AFTER the slash in the SAME "NNN/TTT" group (the set's
  total card count as printed on the card, e.g. "053/172" → printedTotal = 172).
  Read it as a plain integer, drop leading zeros. This is a SEPARATE, independent
  reading from "number" — do not derive one from the other, read both digit
  groups directly from the stamp. null if no slash-number exists.

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
   → { setCode: "ASC", number: "005", printedTotal: 217, language: "de", confidence: "high" }
   (Scarlet & Violet DE — full letter code present)

B) Bottom-LEFT stamp "J SSP 142/191"
   → { setCode: "SSP", number: "142", printedTotal: 191, language: "en", confidence: "high" }
   (Scarlet & Violet EN — full letter code present)

C) Card shows "BASIS 107/203" in the bottom-LEFT with a small icon
   (sun-with-E-letter); no 2–4 letter code visible
   → { setCode: null, number: "107", printedTotal: 203, language: "de", confidence: "high" }
   (Sword & Shield era — symbol only, no letter code)

D) Card shows "078/202" in the bottom-LEFT with a circular set symbol
   → { setCode: null, number: "078", printedTotal: 202, language: "en", confidence: "high" }
   (SWSH/SM/XY EN — symbol only)

E) Trainer card "Doppelball" (HGSS-era, "TRAINER" printed sideways on
   the left edge). Stamp "72/95" + symbol + rarity dot is in the
   BOTTOM-RIGHT corner of the card (in reading orientation)
   → { setCode: null, number: "072", printedTotal: 95, language: "de", confidence: "high" }
   (pre-2020 — stamp at bottom-right, no letter code)

F) Base Set Pikachu — small set icon in bottom-right, no slash-number
   → { setCode: null, number: null, printedTotal: null, language: "en", confidence: "medium" }

G) Lombrero card with banner "Nr. 0271 Frohmut-Pokémon Größe 1,2 m Gewicht 12,5 kg",
   bottom-LEFT stamp "006/094" + set symbol (sun-with-E), no letter code
   → { setCode: null, number: "006", printedTotal: 94, language: "de", confidence: "high",
       nationalDexNumber: 271, name: "Lombrero" }
   (CRITICAL: read Dex from the banner text, parse "0271" as integer 271)

H) HGSS Trainer "Doppelball" — top of card shows "TRAINER" sideways on the
   left edge, large name "Doppelball" centered, no Pokédex number (Trainer
   cards have no Pokémon dex), stamp "72/95" + set symbol bottom-RIGHT
   → { setCode: null, number: "072", printedTotal: 95, language: "de", confidence: "high",
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
    printedTotal: {
      type: SchemaType.INTEGER,
      nullable: true,
      description: 'Digits AFTER the slash in the same "NNN/TTT" stamp group — the set total as printed on the card. Independent reading from `number`, not derived from it.',
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
rarity dot. Compare it visually against the symbols on the reference sheets.

Return your top candidates as "candidateSetCodes", ORDERED from most to least likely
(best guess first). Include every symbol that looks plausibly similar, not just one —
a downstream check will pick the correct one using the card's printed number, so it's
fine (and preferred) to list 2-5 candidates when symbols from the same era look alike,
instead of forcing a single guess. Return just one entry if you are fully confident.
Set matchAmbiguous to true if you are not confident about the top candidate.`;

const SYMBOL_MATCH_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    candidateSetCodes: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'ptcgoCodes of sets whose symbol plausibly matches the stamp icon on the card, ordered from most to least likely. Empty array if no confident match at all.',
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
// Stand 2026-07-03: Benchmark mit 3 Testkarten x 5 Modellen zeigte, dass
// "-latest"-Aliase inzwischen deutlich langsamer/inkonstanter sind (8-16s,
// da sie mittlerweile auf Gemini 3.1 zeigen — "-latest" wird von Google bei
// jedem neuen Release automatisch umgehängt, ohne dass wir es merken). Das
// explizit gepinnte gemini-2.5-flash-lite war im selben Test durchgehend am
// schnellsten UND konstantesten (~2.3s Ø, alle 3 Karten 1.8-2.7s). Bewusst
// gepinnt statt Alias, damit sich das Verhalten nicht wieder unbemerkt
// ändert. gemini-2.5-flash und die Aliase bleiben als Fallback, falls
// gemini-2.5-flash-lite mal ausfällt oder abgekündigt wird.
const MODEL_FALLBACKS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
];

interface FallbackAttempt {
  model: string;
  ms: number;
  ok: boolean;
  error?: string;
}

interface GenerateResult {
  parsed: Record<string, unknown>;
  modelName: string;
  modelIndex: number;
  ms: number;
  rawText: string;
  /** ALLE Versuche (auch fehlgeschlagene 503-Retries) — sonst verschwindet
   *  die Zeit für fehlgeschlagene Versuche unsichtbar im Client-seitig
   *  berechneten "Netzwerk/Server-Overhead" (siehe scanner/page.tsx). */
  attempts: FallbackAttempt[];
}

/** Ruft Gemini mit Fallback-Kette auf (ab startIndex), bricht bei nicht-503-Fehlern sofort ab. */
async function generateWithFallback(
  parts: (string | Part)[],
  schema: Record<string, unknown>,
  startIndex: number,
): Promise<GenerateResult> {
  let lastError = 'Scan failed';
  const attempts: FallbackAttempt[] = [];
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
      attempts.push({ model: modelName, ms, ok: true });

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
      return { parsed, modelName, modelIndex: i, ms, rawText, attempts };
    } catch (err) {
      const ms = Date.now() - t0;
      console.warn(`[scan] ${modelName} failed after ${ms}ms:`, err);
      lastError = err instanceof Error ? err.message : String(err);
      const is503 = lastError.includes('503') || lastError.includes('high demand') || lastError.includes('overloaded');
      attempts.push({ model: modelName, ms, ok: false, error: lastError });
      if (!is503) throw new Error(lastError);
      console.warn(`${modelName} unavailable (503), trying fallback...`);
    }
  }
  throw new Error(lastError);
}

interface PreLookupResult {
  attempted: boolean;
  matched: boolean;
  via?: 'number+dex' | 'number+dex+printedTotal';
  cardId?: string;
  candidateCount?: number;
}

/** Versucht die Karte direkt per (number, nationalDexNumber) im Katalog zu finden,
 *  bevor der teure Symbolabgleich (Schritt 2) überhaupt in Betracht gezogen wird.
 *  Setzt bei eindeutigem Treffer `parsed.setCode`, wodurch Schritt 2 unten entfällt. */
async function tryDirectCatalogLookup(parsed: Record<string, unknown>): Promise<PreLookupResult> {
  if (parsed.setCode != null || parsed.error) return { attempted: false, matched: false };
  const number = typeof parsed.number === 'string' ? parsed.number : null;
  const dexNumber = typeof parsed.nationalDexNumber === 'number' ? parsed.nationalDexNumber : null;
  if (!number || dexNumber == null) return { attempted: false, matched: false };

  try {
    const db: Firestore = getAdminDb();
    const numberVariants = new Set([number]);
    numberVariants.add(/^\d+$/.test(number) ? String(parseInt(number, 10)) : number.padStart(3, '0'));

    let candidates: QueryDocumentSnapshot[] = [];
    for (const num of numberVariants) {
      const snap = await db.collection('tcg_catalog')
        .where('nationalDexNumber', '==', dexNumber)
        .where('number', '==', num)
        .limit(10)
        .get();
      if (!snap.empty) { candidates = snap.docs; break; }
    }

    if (candidates.length === 1) {
      const setCode = candidates[0].data().setCode;
      if (typeof setCode === 'string') {
        parsed.setCode = setCode;
        return { attempted: true, matched: true, via: 'number+dex', cardId: candidates[0].id };
      }
      return { attempted: true, matched: false, via: 'number+dex', candidateCount: 1 };
    }

    if (candidates.length > 1 && typeof parsed.printedTotal === 'number') {
      for (const c of candidates) {
        const setId = c.data().setId;
        if (typeof setId !== 'string') continue;
        const setDoc = await db.collection('tcg_sets').doc(setId).get();
        if (setDoc.data()?.printedTotal === parsed.printedTotal) {
          const setCode = c.data().setCode;
          if (typeof setCode === 'string') {
            parsed.setCode = setCode;
            return { attempted: true, matched: true, via: 'number+dex+printedTotal', cardId: c.id, candidateCount: candidates.length };
          }
        }
      }
    }
    return { attempted: true, matched: false, candidateCount: candidates.length };
  } catch (err) {
    console.warn('[scan] Direkter Katalog-Lookup (number+dex) fehlgeschlagen:', err);
    return { attempted: true, matched: false };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = await req.json();
    if (!imageBase64) return NextResponse.json({ error: 'No image provided' }, { status: 400 });

    // Referenzblätter für den Symbolabgleich (Schritt 2) schon JETZT anstoßen,
    // parallel zu Schritt 1 — nicht erst danach. Schritt 1 dauert ohnehin
    // mehrere Sekunden, in der Zeit läuft der Kaltstart-Aufbau (Icon-Fetch +
    // Sharp-Komposition, ~1.5s) unsichtbar mit statt zusätzlich in Reihe zu
    // kosten. Wird Schritt 2 am Ende gar nicht gebraucht (setCode bereits
    // vorhanden), verpufft die Arbeit einfach — kostet nichts extra.
    const sheetsPromise = getReferenceSheets();
    sheetsPromise.catch(() => {}); // verhindert "unhandled rejection", falls Schritt 2 gar nicht greift

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

    // Direkter Katalog-Lookup per Nummer+Dex-Nummer, BEVOR über Schritt 2 (teurer
    // Symbolabgleich, +1 Gemini-Call +Referenzblätter) entschieden wird — beide
    // Felder liest Gemini in Schritt 1 bereits unabhängig voneinander. Die Nummer
    // allein wiederholt sich in jedem Set (z.B. "053"), aber Nummer+Dex-Nummer
    // zusammen trifft über den ganzen Katalog praktisch immer nur die eine Karte.
    // Findet das einen — bei Mehrdeutigkeit per Gesamtzahl verifizierten —
    // eindeutigen Treffer, wird `setCode` direkt gesetzt: das macht `looksSymbolOnly`
    // unten false und Schritt 2 entfällt komplett. Rein additiv: schlägt der
    // Lookup fehl, läuft alles wie bisher weiter (Schritt 2 → Client-Fallback-Kette).
    const preLookup = await tryDirectCatalogLookup(parsed);
    parsed._preLookup = preLookup;

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
          : preLookup.matched
            ? `Direkter Katalog-Lookup (${preLookup.via}) fand eindeutigen Treffer → setCode="${parsed.setCode}"`
            : parsed.setCode != null
              ? `Schritt 1 lieferte bereits setCode="${parsed.setCode}" (Text-OCR, ungeprüft)`
              : 'Schritt 1 hatte keine verwertbaren Identifier (number/name/dex)',
      };
    } else {
      const t1 = Date.now();
      try {
        // sheetsPromise läuft bereits seit Request-Start (parallel zu Schritt 1)
        // — sheetBuildMs ist hier normalerweise ~0, weil der Aufbau längst
        // während Schritt 1 durchgelaufen ist (siehe Kommentar oben am POST-Start).
        const sheets = await sheetsPromise;
        const sheetBuildMs = Date.now() - t1;
        if (sheets.length > 0) {
          const contextLine = `Original card (from a first read): number=${parsed.number ?? 'unknown'}, name=${parsed.name ?? 'unknown'}.`;
          const step2Parts: (string | Part)[] = [
            { inlineData: { data: imageBase64, mimeType } },
            ...sheets.map(s => ({ inlineData: { data: s.buffer.toString('base64'), mimeType: s.mimeType } })),
            `${PROMPT_SYMBOL_MATCH}\n\n${contextLine}`,
          ];
          const step2 = await generateWithFallback(step2Parts, SYMBOL_MATCH_SCHEMA, step1.modelIndex);
          const rawCandidates = Array.isArray(step2.parsed.candidateSetCodes) ? step2.parsed.candidateSetCodes as unknown[] : [];
          // Validierung: Gemini verwechselt gelegentlich das Energie-Typ-Icon neben der
          // Kartennummer (z.B. "F" für Fighting) mit dem Set-Symbol und gibt dessen Buchstaben
          // zurück — ein Code, der auf keinem Referenzblatt existiert. Nur echte, auf den
          // Blättern abgebildete ptcgoCodes werden akzeptiert. Statt uns auf EINEN Treffer
          // zu verlassen (der bei visuell ähnlichen Symbolen derselben Ära leicht daneben
          // liegt), reichen wir ALLE plausiblen Kandidaten an den Client durch — der probiert
          // sie der Reihe nach durch und verifiziert per Dex-Nr./Gesamtzahl-Gegenprobe gegen
          // den Katalog (siehe scanner/page.tsx), statt Gemini's Top-1-Rang blind zu vertrauen.
          const validCodes = await getValidSymbolSetCodes();
          const rejected = rawCandidates.filter(c => typeof c !== 'string' || !validCodes.has(c));
          const candidates = rawCandidates.filter((c): c is string => typeof c === 'string' && validCodes.has(c));
          if (candidates.length > 0) {
            parsed.candidateSetCodes = candidates;
          }
          parsed._symbolMatch = {
            triggered: true,
            candidateSetCodes: candidates,
            matchConfidence: step2.parsed.matchConfidence ?? null,
            matchAmbiguous: step2.parsed.matchAmbiguous ?? false,
            sheetsUsed: sheets.map(s => s.label),
            sheetBuildMs,
            model: step2.modelName,
            ms: step2.ms,
            attempts: step2.attempts,
            rawText: step2.rawText,
            ...(rejected.length > 0 ? { rejectedMatches: rejected } : {}),
          };
          console.log(`[scan] symbol-match ${step2.modelName} OK in ${step2.ms}ms (sheets built in ${sheetBuildMs}ms) → Kandidaten: [${candidates.join(', ')}]${rejected.length ? `, verworfen: [${rejected.join(', ')}]` : ''}`);
        } else {
          parsed._symbolMatch = { triggered: false, reason: 'Keine Referenzblätter verfügbar (0 Sets geladen)', sheetBuildMs };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[scan] symbol-match step failed, degrading to name+number fallback:', err);
        parsed._symbolMatch = { triggered: true, error: msg, sheetBuildMs: Date.now() - t1 };
      }
    }

    parsed._debug = { model: step1.modelName, ms: step1.ms, attempts: step1.attempts, rawText: step1.rawText };
    return NextResponse.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Scan error:', msg);
    return NextResponse.json({ error: `Scan failed: ${msg}` }, { status: 500 });
  }
}
