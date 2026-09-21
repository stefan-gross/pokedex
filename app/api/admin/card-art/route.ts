import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';
import { isAdminRequest } from '@/lib/admin-auth';

// Bildgenerierung (bei 3×3 zwei Aufrufe) dauert länger.
export const maxDuration = 180;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Gemini-Bildmodelle („Nano Banana"), in Präferenz-Reihenfolge — der erste, der
// ein Bild liefert, gewinnt. 3.x-Bildgenerierung ist regional gesperrt (400).
const IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.0-flash-exp-image-generation',
];

// Schritt 1: Karte → randlose Illustration (Text/Rahmen weg, aufs Kartenformat erweitert).
const PROMPT_CARD = [
  'You are given the artwork window of a Pokémon trading card.',
  'Produce a single image that shows ONLY the illustration — no card frame, no border,',
  'no name, no HP, no attack text, no set symbols, no logos, no copyright line.',
  'Keep the original subject and the existing artwork EXACTLY as it is; do not redraw,',
  'restyle or move it. Only EXTEND (outpaint) the scenery outward so the artwork fills',
  'the entire canvas edge-to-edge in a full-bleed portrait card format (aspect ratio 5:7),',
  'seamlessly continuing the same style, lighting, colors, depth of field and background.',
].join(' ');

// Kaskade Pass 1 (horizontal): Mitte = echte Szene, links/rechts = Kanten-
// Platzhalter, den das Modell in nahtlose Umgebung umwandelt. Bewusst SCHLANK
// gehalten (die frühere Direktiven-Häufung ließ Gemini den Rand unvollständig
// übermalen → Streifen/Symmetrie). Stil/Farbe nur als EIN kurzer Satz.
const PROMPT_H = [
  'This image has real scenery in the CENTER third and a stretched placeholder on the LEFT and',
  'RIGHT thirds. Repaint the left and right thirds into natural, continuous scenery that seamlessly',
  'extends the center outward to both sides. Fully replace the placeholder — leave no stripes,',
  'bands or seams. Match the SAME art style and color palette as the center (keep the clay/plasticine',
  'look if present; no photorealism).',
  'IMPORTANT — UNIFORM FOCUS: the FINAL image must be SHARP and in focus across the ENTIRE frame.',
  'If ANY area is blurred or out of focus (including the middle / the background BEHIND the central',
  'figure), re-render it as sharp, detailed environment (leaves, plants, rocks, ground) — no bokeh,',
  'no empty green haze, no soft focus band anywhere. Keep the central FIGURE exactly where it is,',
  'sharp and unchanged; only the surrounding environment becomes sharp and detailed.',
  'ASYMMETRY: make the LEFT and RIGHT sides look CLEARLY DIFFERENT from each other — different plants,',
  'trees, rocks, shapes and spacing; no mirror symmetry, no matching pair of framing trees, and no',
  'repeated/duplicated elements between the two sides.',
  'Do NOT add any character or a copy of the central subject. Output one image, same wide aspect',
  'ratio, edge to edge.',
].join(' ');

// Kaskade Pass 2 (vertikal): breite Szene, oben/unten = Platzhalter → nahtlos ergänzen.
const PROMPT_V = [
  'This is a wide scene with real content in the vertical CENTER and a stretched placeholder along',
  'the TOP and BOTTOM. Repaint the top into a natural continuation upward (canopy, branches, sky) and',
  'the bottom downward (forest floor, ground, foreground plants), seamlessly connected. Fully replace',
  'the placeholder — leave no stripes, bands or seams. Match the SAME art style and color palette as',
  'the center (keep the clay/plasticine look if present; no photorealism).',
  'IMPORTANT — UNIFORM FOCUS: the FINAL image must be SHARP and in focus across the ENTIRE frame.',
  'If ANY area is blurred or out of focus (including the middle / the background BEHIND the central',
  'figure), re-render it as sharp, detailed environment — no bokeh, no empty green haze, no soft',
  'focus band anywhere. Keep the central FIGURE exactly where it is, sharp and unchanged; only the',
  'surrounding environment becomes sharp and detailed.',
  'ASYMMETRY: make the TOP and BOTTOM (and the top-left vs top-right corners) look CLEARLY DIFFERENT',
  'from each other — vary plants, trees, rocks and shapes; no mirror symmetry and no matching/',
  'duplicated framing elements between corners or sides.',
  'Do NOT add any character or copy of any subject. Output one image, same tall aspect ratio, edge to edge.',
].join(' ');

async function fetchImageBase64(url: string): Promise<{ data: string; mimeType: string }> {
  // Data-URL direkt zerlegen (Schritt-1-Ergebnis wird so verkettet), sonst HTTP holen.
  const m = url.match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (m) return { mimeType: m[1], data: m[2] };
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Quelle ${res.status}`);
  const mimeType = res.headers.get('content-type') || 'image/png';
  const buf = Buffer.from(await res.arrayBuffer());
  return { data: buf.toString('base64'), mimeType };
}

/** Ein Gemini-Bild-Aufruf: Bild + Prompt rein, Bild raus (Base64). Wirft bei Fehler
 *  oder wenn keine Bild-Antwort kcommt (z.B. Text-Ablehnung). */
async function genImage(
  modelName: string,
  promptText: string,
  input: { mimeType: string; data: string },
): Promise<{ mimeType: string; data: string }> {
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { responseModalities: ['IMAGE'] } as unknown as Record<string, unknown>,
  });
  const result = await model.generateContent([
    { text: promptText },
    { inlineData: { mimeType: input.mimeType, data: input.data } },
  ]);
  const parts = result.response.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find(p => p.inlineData?.data);
  if (!img?.inlineData) {
    throw new Error(parts.map(p => p.text).filter(Boolean).join(' ').slice(0, 200) || 'kein Bild in Antwort');
  }
  return { mimeType: img.inlineData.mimeType || 'image/png', data: img.inlineData.data };
}

/** Leinwand um die Ränder mit gestreckten Kantenpixeln erweitern (Outpaint-Seed).
 *  `copy` (Kanten-Streckung) statt `mirror`: Spiegelung erzeugte bei
 *  unvollständigem Übermalen auffällige Symmetrie; die Streckung ist unauffälliger
 *  und lieferte mit schlankem Prompt das beste Ergebnis. */
async function extendEdges(b64: string, side: number, vert: number): Promise<string> {
  const buf = Buffer.from(b64, 'base64');
  const out = await sharp(buf)
    .extend({ left: side, right: side, top: vert, bottom: vert, extendWith: 'copy' })
    .png().toBuffer();
  return out.toString('base64');
}

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { imageUrl, model: modelOverride, mode } = await req.json();
    if (!imageUrl || typeof imageUrl !== 'string') {
      return NextResponse.json({ error: 'imageUrl fehlt' }, { status: 400 });
    }

    const src = await fetchImageBase64(imageUrl);
    const models = typeof modelOverride === 'string' && modelOverride ? [modelOverride] : IMAGE_MODELS;
    const errors: Record<string, string> = {};

    for (const modelName of models) {
      try {
        const t0 = Date.now();

        if (mode === 'grid3x3') {
          // Kaskade: erst links/rechts, dann oben/unten erweitern. So sieht das
          // Modell an jedem Rand ECHTEN Bildinhalt (kein leeres 8-Feld-Raster) →
          // keine Spalten-Wiederholung, kein doppeltes Motiv (Ränder sind reine
          // Umgebung ohne Figur).
          const meta = await sharp(Buffer.from(src.data, 'base64')).metadata();
          const w = meta.width ?? 864, h = meta.height ?? 1184;

          // Pass 1 – horizontal (je eine Kartenbreite links/rechts).
          const hSeed = await extendEdges(src.data, w, 0);
          const mid = await genImage(modelName, PROMPT_H, { mimeType: 'image/png', data: hSeed });

          // Pass 2 – vertikal (je eine Reihenhöhe oben/unten, aus der echten Streifenhöhe).
          const midMeta = await sharp(Buffer.from(mid.data, 'base64')).metadata();
          const mh = midMeta.height ?? h;
          const vSeed = await extendEdges(mid.data, 0, mh);
          const finalImg = await genImage(modelName, PROMPT_V, { mimeType: 'image/png', data: vSeed });

          return NextResponse.json({
            model: modelName,
            latencyMs: Date.now() - t0,
            passes: 2,
            mimeType: finalImg.mimeType,
            image: `data:${finalImg.mimeType};base64,${finalImg.data}`,
          });
        }

        // Karten-Modus: ein Aufruf.
        const out = await genImage(modelName, PROMPT_CARD, src);
        return NextResponse.json({
          model: modelName,
          latencyMs: Date.now() - t0,
          passes: 1,
          mimeType: out.mimeType,
          image: `data:${out.mimeType};base64,${out.data}`,
        });
      } catch (e) {
        errors[modelName] = e instanceof Error ? e.message : String(e);
      }
    }
    return NextResponse.json({ error: 'Kein Modell lieferte ein Bild', details: errors }, { status: 502 });
  } catch (e) {
    console.error('[admin/card-art]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
