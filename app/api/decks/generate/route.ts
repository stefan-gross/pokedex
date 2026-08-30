import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { PoolLine } from '@/lib/decks/pool';

// Gemini-Deckbau braucht etwas Reasoning + kann beim Kaltstart dauern.
export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'];

const SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    picks: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          index: { type: SchemaType.INTEGER },
          count: { type: SchemaType.INTEGER },
        },
        required: ['index', 'count'],
      },
    },
  },
  required: ['picks'],
} as const;

interface Body {
  poolLines: PoolLine[];
  format: string;
  strategy?: string;
  freeText?: string;
  ownership: 'owned' | 'prefer' | 'best';
  existingCount?: number;
  energyTarget?: number;
}

function buildPrompt(b: Body): string {
  const fmt = b.format === 'standard' ? 'Standard' : b.format === 'expanded' ? 'Expanded' : 'Unlimited';
  const ownershipHint = b.ownership === 'prefer'
    ? 'PREFER cards marked owned=true when they are competitively reasonable; only use owned=false cards where clearly needed.'
    : b.ownership === 'owned'
      ? 'You may ONLY use cards from the list (all are usable). Build the most consistent deck possible from them.'
      : 'Build the strongest deck; ignore the owned flag.';
  const lines = b.poolLines.map(l =>
    `${l.index}: ${l.name} [${l.supertype}${l.subtype ? '/' + l.subtype : ''}${l.type ? ', ' + l.type : ''}]${l.owned ? ' (owned)' : ''}`
  ).join('\n');

  return `You are an expert Pokémon TCG deck builder. Build a competitive ${fmt} deck of EXACTLY 60 cards.

Select ONLY from this numbered candidate pool (choose by index):
${lines}

Hard rules you MUST follow:
- The picks must total EXACTLY 60 cards (sum of all counts).
- At most 4 copies of cards that share the same NAME — EXCEPT basic Energy (unlimited).
- The deck MUST contain at least one Basic Pokémon.
- Only use indices that appear in the list above.

Guidance:
- ${ownershipHint}
- Deck-building best practices to follow:
  · Evolution line ratios — the LOWER stage must be >= the higher stage (you start on the Basic and evolve up). For a Stage-2 line WITH Rare Candy in the pool use ~4 Basic / 1-2 middle / 2-3 final + 3-4 Rare Candy; WITHOUT Rare Candy ~4 Basic / 3 middle / 2-3 final. For a Stage-1 line ~4 Basic / 2-3 middle. For a Basic attacker (V/ex/GX) run 2-4 copies.
  · A rough overall shape: ~12-18 Pokémon, ~28-34 Trainer (never more than 34), ~10-15 Energy.
  · Use MORE THAN ONE attacker line when the pool offers several Pokémon lines of the deck's type — a one-line deck is too fragile. Build a main line plus at least one secondary attacker rather than maxing every Trainer to 4.
  · A consistency engine most decks want: 4 draw Supporter (e.g. Professor's Research) + 3 Iono, 3-4 Ball search, 2 Boss's Orders (gust), 2-3 Switch, plus 3-4 Rare Candy for any Stage-2 line.
  · Energy count scales with attack costs — this deck's attackers suggest about ${b.energyTarget ?? 12} basic Energy (more for expensive attacks, fewer for cheap ones). Aim near that, then fill the rest with the Trainer engine.
${b.strategy ? `- Strategy: ${b.strategy}.` : ''}
${b.freeText ? `- Extra request from the user: ${b.freeText}` : ''}
${b.existingCount ? `- The deck already has ${b.existingCount} cards; your picks are ADDED on top — pick roughly ${60 - b.existingCount} more.` : ''}

Return {"picks": [{"index": <pool index>, "count": <copies>}, ...]}.`;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  if (!Array.isArray(body.poolLines) || body.poolLines.length === 0) {
    return NextResponse.json({ error: 'empty pool' }, { status: 400 });
  }

  const prompt = buildPrompt(body);
  let lastError = 'generation failed';
  for (const modelName of MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4, responseSchema: SCHEMA as any },
      });
      const result = await model.generateContent(prompt);
      const raw = result.response.text().trim();
      let parsed: { picks?: unknown };
      try { parsed = JSON.parse(raw); }
      catch { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {}; }
      const picks = Array.isArray(parsed.picks) ? parsed.picks : [];
      console.log(`[decks/generate] ${modelName} OK, ${picks.length} picks`);
      return NextResponse.json({ picks, model: modelName });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const is503 = lastError.includes('503') || lastError.includes('overloaded') || lastError.includes('high demand');
      console.warn(`[decks/generate] ${modelName} failed:`, lastError);
      if (!is503) break;
    }
  }
  // Kein Erfolg → Client fällt auf den regelbasierten Generator zurück.
  return NextResponse.json({ picks: [], error: lastError }, { status: 200 });
}
