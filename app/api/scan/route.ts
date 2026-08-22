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

The identifiers used to look the card up are the SET CODE + COLLECTOR NUMBER (the corner stamp) and the POKÉDEX NUMBER. The card NAME alone is NOT enough (many cards share a name). Even when the name is perfectly legible, you MUST still attempt to read the corner stamp (setCode + number) and the "Nr."/"NO."/"#" Pokédex number. Only return null for a field if it is genuinely unreadable in this image — never skip a field just because the name was easy.

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

number — the COLLECTOR number: 1–3 digits IMMEDIATELY before the slash in the
  "NNN/TTT" group (e.g. "121/182" → number = "121"). Stamp position varies by
  era: bottom-LEFT (S&V, SWSH) or bottom-RIGHT (all older).
  CRITICAL — do NOT confuse it with the Pokédex number:
  - The collector number is ALWAYS the part before a "/". If you cannot find a
    "NNN/TTT" slash pair, number is null — do NOT substitute another number.
  - A standalone 3–4 digit value after "Nr."/"NO."/"#" (e.g. "Nr. 0877") is the
    POKÉDEX number → it goes in nationalDexNumber, NEVER in number.
  - A 4-digit value (e.g. "0877", "1025") is virtually never a collector number
    (those are ≤3 digits and paired with "/TTT") — it is the Pokédex number.
  - Trainer Gallery / Galarian Gallery cards use a LETTER-PREFIXED number, e.g.
    "TG04/TG30" or "GG04/GG70". KEEP the prefix in the number field → "TG04" / "GG04".

printedTotal — the digits AFTER the slash in the SAME "NNN/TTT" group (the set's
  total card count as printed on the card, e.g. "053/172" → printedTotal = 172).
  Read it as a plain integer, drop leading zeros. This is a SEPARATE, independent
  reading from "number" — do not derive one from the other, read both digit
  groups directly from the stamp. null if no slash-number exists.
  - Trainer/Galarian Gallery "TG04/TG30" or "GG04/GG70": printedTotal is the
    DIGITS after the slash WITHOUT the letter prefix → 30 (for TG30) / 70 (GG70).

language — German cards have "KP" (HP) and "Fähigkeit" (Ability).
  English cards have "HP" and "Ability". French has "PV" and "Talent" etc.

hp — the KP/HP value printed next to the Pokémon name at the top of the card
  (e.g. "350"). Read it as a plain integer. null for Trainer and Energy cards
  (they have no HP).

nationalDexNumber — VERY IMPORTANT: this is the fallback identifier when there
  is no letter set code. Always check carefully and parse as integer (drop leading
  zeros: "0271" → 271).
  - DE format: "Nr." or "Nr" followed by 3–4 digits, e.g. "Nr. 0271" (Lombrero).
    Typically printed in SMALL italic text in the BANNER between the Pokémon name
    and the artwork frame, often together with the genus, height, weight (e.g.
    "Nr. 0271 Frohmut-Pokémon Größe 1,2 m Gewicht 12,5 kg"). Sometimes also in
    the description area at the bottom of the card.
  - EN format: "NO." or "#" followed by 3–4 digits, e.g. "NO. 271" or "#271".
  - The digit length varies: 1–4 digits ("25", "025", "0271", "1025"). A 4-digit
    value after "Nr."/"NO."/"#" is ALWAYS the Pokédex number — put it here, and
    do NOT let it leak into the number (collector) field.
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

I) Morpeko — banner "Nr. 0877 Alter-Ego-Pokémon Größe 0,3 m Gewicht 3,0 kg",
   bottom-LEFT stamp "121/182" + set symbol, no letter code
   → { setCode: null, number: "121", printedTotal: 182, language: "de", confidence: "high",
       nationalDexNumber: 877, name: "Morpeko" }
   (CRITICAL: "121" (before the "/") is the collector number; "0877" (after
   "Nr.") is the Pokédex number → nationalDexNumber: 877. NEVER put 0877 into
   the number field.)

J) Trainer-Gallery card (Jynx/Rossana), bottom-LEFT stamp "TG04/TG30" + symbol
   → { setCode: null, number: "TG04", printedTotal: 30, language: "de", confidence: "high" }
   (KEEP the "TG" prefix in number; printedTotal is the digits after the slash
   without the prefix → 30. Same for Galarian Gallery "GG04/GG70" → "GG04" / 70.)

name — the LARGE card title in the TOP row (Pokémon name, Trainer card name, or
  Energy card name), printed next to the KP/HP value. Return it verbatim
  including hyphens and language-specific spelling: "Galar-Flunschlik",
  "Doppelball", "Charizard ex", "Glurak ex", "Boss's Orders". This name is a
  fallback identifier when the set code is hidden by a symbol.
  CRITICAL — do NOT confuse the name with an ATTACK/move name. Attack names are
  in the LOWER half of the card, inside the text box below the artwork, each with
  an energy-cost symbol row on the LEFT and a damage number on the RIGHT
  (e.g. "Elektroschlag  60", "Spukschuss  40", "Doppelte Kopfnuss  10×"). The
  Ability name (after "Fähigkeit"/"Ability") and the flavor text are also NOT the
  card name. The card name is ONLY the bold title in the top row.

If no Pokémon card is visible at all: set "error" to "No card detected" and
leave the other fields null.`;

// Kompakte Prompt-Variante (~40 % kürzer) — für den A/B-Test im Testmodus.
// Behält die kritischen Regeln (number vs. dex, setCode=null bei Symbol-Sets,
// ganze Karte scannen) + drei Kernbeispiele, lässt den Rest weg.
const PROMPT_KURZ = `You are a Pokémon TCG card reader. Extract the printed info as JSON.

Read the corner stamp "NNN/TTT" and the Pokédex number carefully — scan the whole border; small stamps hide in glare. The card NAME alone is NOT enough (many cards share names) — always still read the stamp + dex number.

Fields:
- setCode: 2–4 uppercase letters between the regulation-mark and the language marker on Scarlet&Violet (2023+) cards, e.g. "J ASC DE 005/217" → "ASC". ALL older eras (SWSH, SM, XY, …) have only a graphical symbol → null. Never return a single letter, a language marker (DE/EN), or a symbol description.
- number: the 1–3 digits BEFORE the "/" in "NNN/TTT" (e.g. "121/182" → "121"). No slash pair → null. A value after "Nr."/"NO."/"#" is the Pokédex number, NOT the collector number. Trainer/Galarian Gallery "TG04/TG30" or "GG04/GG70": keep the prefix → "TG04"/"GG04".
- printedTotal: the digits AFTER the "/" (e.g. "053/172" → 172), read directly, drop leading zeros; null if no slash. For "TG04/TG30"/"GG04/GG70": digits after slash without the prefix → 30 / 70.
- nationalDexNumber: digits after "Nr."/"NO."/"#" (DE: small italic banner between name and artwork, or description block; EN "NO."/"#"), parse as int (drop leading zeros: "0271"→271). Search the WHOLE card. A 4-digit value after that prefix is ALWAYS the dex number. null for Trainer/Energy or if absent.
- language: DE "KP"/"Fähigkeit", EN "HP"/"Ability", FR "PV"/"Talent".
- hp: the KP/HP integer next to the name; null for Trainer/Energy.
- name: the LARGE title in the top row (verbatim, incl. hyphens and "ex"). NOT an attack name (lower text box, energy-cost row + damage number), NOT the ability/flavor text.
- confidence: high/medium/low.

Examples:
- "J ASC DE 005/217" → {setCode:"ASC", number:"005", printedTotal:217, language:"de"}
- "078/202" + circular symbol, no letter code → {setCode:null, number:"078", printedTotal:202, language:"en"}
- Banner "Nr. 0877 …", stamp "121/182" + symbol → {setCode:null, number:"121", printedTotal:182, nationalDexNumber:877, name:"Morpeko"} (121 before "/" = collector; 0877 after "Nr." = dex — never swap)

If no Pokémon card is visible: set "error" to "No card detected" and leave other fields null.`;

/** Server-seitige Allowlist der Prompt-Varianten (kein Client-Prompt → keine
 *  Injection). Auswahl per Header `x-prompt-variant` (nur Testmodus). */
const PROMPT_VARIANTS: Record<string, string> = {
  default: PROMPT,
  kurz: PROMPT_KURZ,
};

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
    hp: {
      type: SchemaType.INTEGER,
      nullable: true,
      description: 'KP/HP value next to the Pokémon name (integer); null for Trainer/Energy',
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
        // temperature 0: reine Extraktion (deterministisch, minimal schneller).
        // thinkingConfig.thinkingBudget 0: „Thinking" abschalten — die Aufgabe
        // braucht kein Reasoning; spart v.a. beim Fallback auf gemini-2.5-flash
        // (Thinking dort standardmäßig AN) mehrere hundert ms. Das Feld ist in der
        // (veralteten) SDK nicht typisiert, wird aber unverändert an die REST-API
        // durchgereicht (siehe SDK: generationConfig wird 1:1 in den Body gelegt).
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
          thinkingConfig: { thinkingBudget: 0 },
          responseSchema: schema,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
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
  /** Debug-Herkunft des Treffers (z.B. "printedTotal+number", "…(swap)"). */
  via?: string;
  cardId?: string;
  candidateCount?: number;
  /** Fertig aufgelöstes Katalog-Dokument ({ id, ...data }) — reicht der Client
   *  durch, um `resolveScannedCard` (zweite Firestore-Suche) zu überspringen. */
  card?: Record<string, unknown>;
}

/** Snapshot → JSON-fähiges Karten-Objekt für die Client-Antwort. */
function snapToCard(d: QueryDocumentSnapshot): Record<string, unknown> {
  return { id: d.id, ...d.data() };
}

/** Versucht die Karte direkt per (number, nationalDexNumber) im Katalog zu finden,
 *  bevor der teure Symbolabgleich (Schritt 2) überhaupt in Betracht gezogen wird.
 *  Setzt bei eindeutigem Treffer `parsed.setCode`, wodurch Schritt 2 unten entfällt. */
/** Levenshtein-Distanz (für OCR-tolerante Namensvergleiche). */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

async function tryDirectCatalogLookup(parsed: Record<string, unknown>): Promise<PreLookupResult> {
  if (parsed.setCode != null || parsed.error) return { attempted: false, matched: false };
  const number = typeof parsed.number === 'string' ? parsed.number : null;
  const dexNumber = typeof parsed.nationalDexNumber === 'number' ? parsed.nationalDexNumber : null;
  const printedTotal = typeof parsed.printedTotal === 'number' ? parsed.printedTotal : null;
  const nameLower = typeof parsed.name === 'string' ? parsed.name.trim().toLowerCase() : null;
  // Braucht mindestens number + (dex ODER printedTotal). setCode/Symbolabgleich
  // sind nicht nötig, wenn eine dieser robusten Zahlenkombis eindeutig auflöst.
  if (!number || (dexNumber == null && printedTotal == null)) return { attempted: false, matched: false };

  try {
    const db: Firestore = getAdminDb();

    // Ein Treffer-Dokument → PreLookupResult (nur mit gültigem setCode).
    const asMatch = (d: QueryDocumentSnapshot, via: string, candidateCount?: number): PreLookupResult | null => {
      const setCode = d.data().setCode;
      if (typeof setCode !== 'string') return null;
      parsed.setCode = setCode;
      return { attempted: true, matched: true, via, cardId: d.id, card: snapToCard(d), candidateCount };
    };
    // Kandidaten → Treffer: 1 Kandidat ODER mehrere, die dieselbe Karte sind
    // (gleiche Dex+Nummer+Name — z.B. dieselbe Karte in einem doppelt
    // angelegten/veralteten Set) → eindeutig. Echte verschiedene Karten → null.
    const cardKey = (d: QueryDocumentSnapshot) =>
      `${d.data().nationalDexNumber ?? ''}|${d.data().number ?? ''}|${d.data().nameLower ?? d.data().nameDeLower ?? ''}`;
    const resolveHits = (docs: QueryDocumentSnapshot[], via: string): PreLookupResult | null => {
      if (!docs.length) return null;
      const uniq = new Set(docs.map(cardKey));
      if (docs.length === 1 || uniq.size === 1) return asMatch(docs[0], via, docs.length);
      return null;
    };

    // Ein Lese-Versuch für ein konkretes (number, printedTotal)-Paar. `null` =
    // kein sicherer Treffer (inkl. „Name widerspricht allen Kandidaten").
    const attempt = async (num: string, total: number | null, tag: string): Promise<PreLookupResult | null> => {
      const numberVariants = new Set([num]);
      numberVariants.add(/^\d+$/.test(num) ? String(parseInt(num, 10)) : num.padStart(3, '0'));

      // ── A) number + dex ──
      if (dexNumber != null) {
        let candidates: QueryDocumentSnapshot[] = [];
        for (const n of numberVariants) {
          const snap = await db.collection('tcg_catalog')
            .where('nationalDexNumber', '==', dexNumber).where('number', '==', n).limit(10).get();
          if (!snap.empty) { candidates = snap.docs; break; }
        }
        const r = resolveHits(candidates, `number+dex${tag}`);
        if (r) return r;
        // Mehrere echte Kandidaten → per printedTotal feinauflösen.
        if (candidates.length > 1 && total != null) {
          for (const c of candidates) {
            const setId = c.data().setId;
            if (typeof setId !== 'string') continue;
            const setDoc = await db.collection('tcg_sets').doc(setId).get();
            if (setDoc.data()?.printedTotal === total) {
              const m = asMatch(c, `number+dex+printedTotal${tag}`, candidates.length);
              if (m) return m;
            }
          }
        }
      }

      // ── B) printedTotal + number (greift v.a. wenn dex fehlt) ──
      if (total != null) {
        const setSnap = await db.collection('tcg_sets').where('printedTotal', '==', total).get();
        const setIds = setSnap.docs.map(d => d.id);
        if (setIds.length) {
          const hitsById = new Map<string, QueryDocumentSnapshot>();
          for (const setId of setIds) {
            for (const n of numberVariants) {
              const snap = await db.collection('tcg_catalog')
                .where('setId', '==', setId).where('number', '==', n).limit(2).get();
              for (const d of snap.docs) hitsById.set(d.id, d);
            }
          }
          let hits = [...hitsById.values()];
          // Namensfilter FUZZY (OCR-tolerant). NEU: Wurde ein Name gelesen, der zu
          // KEINEM Kandidaten passt, ist das ein Widerspruch → KEIN Treffer auf
          // dieser Lesart (verhindert Fehltreffer, z.B. jap. Karte → falsche DE-Karte).
          if (nameLower) {
            const tol = nameLower.length >= 6 ? 2 : nameLower.length >= 4 ? 1 : 0;
            const nameClose = (cand: unknown) =>
              typeof cand === 'string' && (cand === nameLower || levenshtein(cand, nameLower) <= tol);
            const byName = hits.filter(h => nameClose(h.data().nameLower) || nameClose(h.data().nameDeLower));
            if (byName.length) hits = byName;
            else if (hits.length) return null; // Name widerspricht → nicht sicher
          }
          if (hits.length > 1 && dexNumber != null) {
            const byDex = hits.filter(h => h.data().nationalDexNumber === dexNumber);
            if (byDex.length) hits = byDex;
          }
          const r = resolveHits(hits, `printedTotal+number${tag}`);
          if (r) return r;
        }
      }
      return null;
    };

    // Primärer Versuch mit der gelesenen Lesart …
    let result = await attempt(number, printedTotal, '');
    // … sonst Swap-Retry: Bei Secret Rares (Nummer > Gesamtzahl, z.B. „175/91")
    // vertauscht Gemini number/printedTotal gern („091/175"). Nur akzeptiert,
    // wenn die vertauschte Lesart einen namens-passenden eindeutigen Treffer
    // liefert (der Name-Guard in `attempt` schützt vor Fehltreffern).
    if (!result && /^\d+$/.test(number) && printedTotal != null) {
      result = await attempt(String(printedTotal), parseInt(number, 10), '(swap)');
    }
    if (result) return result;

    return { attempted: true, matched: false };
  } catch (err) {
    console.warn('[scan] Direkter Katalog-Lookup fehlgeschlagen:', err);
    return { attempted: true, matched: false };
  }
}

// Warmup (#2): der Scanner pingt beim Öffnen GET /api/scan an → Admin-SDK,
// Gemini-Client-Init und Referenzblätter-Bau laufen VOR dem ersten echten Scan
// (Serverless-Coldstart wird so aus dem kritischen Pfad genommen).
export async function GET() {
  try {
    getAdminDb();                    // Admin-SDK (REST) initialisieren
    getReferenceSheets().catch(() => {}); // Referenzblätter im Hintergrund cachen
  } catch { /* Warmup ist best-effort */ }
  return NextResponse.json({ warm: true });
}

export async function POST(req: NextRequest) {
  try {
    // Body binär ODER JSON: der Scanner sendet die rohen JPEG-Bytes (Content-Type
    // image/*) → ~25 % weniger Transfer + kein großer base64-String-Parse. JSON
    // bleibt als Rückfall für Altpfade/Tools erhalten.
    const ctype = req.headers.get('content-type') || '';
    let imageBase64: string;
    let mimeType = 'image/jpeg';
    if (ctype.startsWith('image/')) {
      const buf = Buffer.from(await req.arrayBuffer());
      imageBase64 = buf.toString('base64');
      mimeType = ctype;
    } else {
      const body = await req.json();
      imageBase64 = body.imageBase64;
      mimeType = body.mimeType ?? 'image/jpeg';
    }
    if (!imageBase64) return NextResponse.json({ error: 'No image provided' }, { status: 400 });

    // Referenzblätter für den Symbolabgleich (Schritt 2) schon JETZT anstoßen,
    // parallel zu Schritt 1 — nicht erst danach. Schritt 1 dauert ohnehin
    // mehrere Sekunden, in der Zeit läuft der Kaltstart-Aufbau (Icon-Fetch +
    // Sharp-Komposition, ~1.5s) unsichtbar mit statt zusätzlich in Reihe zu
    // kosten. Wird Schritt 2 am Ende gar nicht gebraucht (setCode bereits
    // vorhanden), verpufft die Arbeit einfach — kostet nichts extra.
    const sheetsPromise = getReferenceSheets();
    sheetsPromise.catch(() => {}); // verhindert "unhandled rejection", falls Schritt 2 gar nicht greift

    // Prompt-Variante (Testmodus-A/B): per Header aus der Allowlist wählen,
    // Default sonst. Kein frei übergebener Prompt → keine Injection.
    const activePrompt = PROMPT_VARIANTS[req.headers.get('x-prompt-variant') ?? 'default'] ?? PROMPT;

    let step1: GenerateResult;
    try {
      step1 = await generateWithFallback(
        [{ inlineData: { data: imageBase64, mimeType } }, activePrompt],
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
