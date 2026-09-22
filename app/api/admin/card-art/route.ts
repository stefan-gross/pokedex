import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';
import { isAdminRequest } from '@/lib/admin-auth';

// Bildgenerierung (bei 3×3 mehrere Aufrufe + Rate-Limit-Pausen) dauert länger.
export const maxDuration = 300;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Gemini-Bildmodelle („Nano Banana"), in Präferenz-Reihenfolge — der erste, der
// ein Bild liefert, gewinnt. 3.x-Bildgenerierung ist regional gesperrt (400).
const IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.0-flash-exp-image-generation',
];

// Creative Fabrica GenAI API (async): gibt uns u.a. Gemini 3.x (regional bei
// Google direkt gesperrt), SeeDream, GPT Image 2 — bis 4K, ein Request-Schema,
// Modell per String tauschbar. Key NUR aus Env (Secret, nicht im Repo).
const CF_BASE = 'https://api.creativefabrica.com/genai/v1';
const CF_KEY = process.env.CREATIVEFABRICA_API_KEY;

// Schritt 1 (Karte → randlose Illustration). WICHTIG für den späteren Outpaint:
// bis in alle Ecken DETAILLIERT füllen (kein Bokeh-Rand) und VORDERGRUND SCHARF —
// sonst hat FLUX am Rand keinen klaren Kontext und driftet stilistisch ab.
const PROMPT_CF_CARD = [
  'Nutze ausschließlich die Illustration dieser Pokémon-Karte und entferne Rahmen, Text, Name, KP,',
  'Attacken, Set-Symbole, Logos und Copyright vollständig. Erweitere die Szene so, dass sie das',
  'GESAMTE Hochformat randlos bis in ALLE Ecken füllt — mit ECHTEN, DETAILLIERTEN Bildinhalten',
  '(z. B. Waldboden, Pflanzen, Blätter, Felsen, Zweige), NICHT mit einer gleichmäßigen',
  'Unschärfe-/Bokeh-Fläche. Das Motiv und der gesamte VORDERGRUND bleiben SCHARF und im Fokus; nur',
  'der FERNE Hintergrund darf leicht weich sein (wie im Original). Motiv unverändert (Anatomie',
  'korrekt), gleicher Stil/Farben. Kein Rahmen, kein Text.',
].join(' ');

// CF-Schritt 2: freigestellte Illustration → EINE zusammenhängende, weit
// herausgezoomte Szene (Motiv mittig, Umgebung nahtlos rundum). Eingabe ist die
// öffentliche CDN-URL aus Schritt 1 (oder direkt eine Illustrations-URL).
const PROMPT_CF_GRID3X3 = [
  'Erweitere diese Illustration zu EINEM EINZIGEN, zusammenhängenden, weit herausgezoomten Bild:',
  'Das Motiv bleibt zentral und unverändert (Anatomie korrekt — Flügel/Schwanz/Glieder), und ringsum',
  'wird DIESELBE Umgebung/Szene (z. B. Wald, Obstwiese, Stadt/Dächer, Abendhimmel, Wasser, Berge)',
  'nahtlos in ALLE Richtungen fortgesetzt — als wäre es schon immer ein großes Bild gewesen. Halte',
  'Stil, Farbpalette, Beleuchtung und Tageszeit exakt ein; wechsle die Umgebung NICHT. Kein Raster,',
  'keine Kacheln, keine Panels, keine Wiederholung, keine gespiegelte Symmetrie, keine',
  'senkrechten/waagerechten Streifen oder Bänder, keine Gitterlinien, kein Rahmen, kein Text. Alles',
  'scharf und im Fokus. Du darfst dasselbe Pokémon zusätzlich in anderen Posen einbauen. Hochformat.',
  'Fülle das GESAMTE rechteckige Bild randlos bis in alle vier ECKEN — keine leeren/hellen Flächen,',
  'keine kreisförmige Vignette, kein weicher Auslauf am Rand.',
].join(' ');

// ── Replicate (FLUX Fill = dediziertes Outpainting) ───────────────────────
// Füllt NUR den maskierten Rand, lässt die Mitte pixelgenau → kein Kacheln,
// keine Motiv-Dopplung. Token NUR aus Env (Secret).
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_FILL_MODEL = 'black-forest-labs/flux-fill-pro';
// FLUX begrenzt die Auflösung (~2 MP). Wir skalieren die 3×-Leinwand so, dass die
// lange Kante ≤ diesem Wert bleibt; fürs Drucken später separat upscalen.
const FLUX_MAX_LONG = 1408;

// Mehrstufiges Outpainting: pro Schritt nur ein MODERATER Ring (Faktor ~1.7),
// damit FLUX genug Kontext am Rand hat (keine dunkle Vignette). 2 Schritte ≈ 2.9×.
// Echtes 3×3: 2 Pässe à √3 ≈ 1.732 = exakt 3× (Mitte = 1/3 je Achse → in 9
// gleiche Kacheln schneidbar). Moderater Ring pro Pass + positiver Prompt =
// keine Vignette / kein Kartenrahmen. Mitte bleibt über beide Pässe pixelgenau.
const FLUX_PASS_FACTOR = Math.sqrt(3); // 2 Ringe = exakt 3× (sauber für fotografische Full-Arts)
const FLUX_PASSES = 2;

/** Legt `buf` mittig auf eine `factor`× größere Leinwand und baut die Maske
 *  (Rand weiß = füllen, Mitte schwarz = behalten). Kein Re-Scale des Inhalts. */
async function outpaintCanvas(buf: Buffer, factor: number): Promise<{ image: string; mask: string }> {
  const md = await sharp(buf).metadata();
  const w = md.width ?? 512, h = md.height ?? 700;
  const CW = Math.round(w * factor), CH = Math.round(h * factor);
  const left = Math.round((CW - w) / 2), top = Math.round((CH - h) / 2);

  const image = await sharp({ create: { width: CW, height: CH, channels: 3, background: { r: 127, g: 127, b: 127 } } })
    .composite([{ input: buf, left, top }])
    .png().toBuffer();
  const blackRect = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
  const mask = await sharp({ create: { width: CW, height: CH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: blackRect, left, top }])
    .png().toBuffer();

  return {
    image: `data:image/png;base64,${image.toString('base64')}`,
    mask: `data:image/png;base64,${mask.toString('base64')}`,
  };
}

/** Generischer Replicate-Lauf: POST an ein Modell → pollen → Ergebnis-URL.
 *  Mit 429-Handling (bei <$5 Guthaben Burst 1/min). */
async function replicateRun(modelPath: string, input: Record<string, unknown>): Promise<{ url: string }> {
  if (!REPLICATE_TOKEN) throw new Error('REPLICATE_API_TOKEN fehlt');
  const headers = { Authorization: `Bearer ${REPLICATE_TOKEN}`, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ input });
  let startRes: Response, startText = '';
  for (let attempt = 0; ; attempt++) {
    startRes = await fetch(`https://api.replicate.com/v1/models/${modelPath}/predictions`, { method: 'POST', headers, body });
    startText = await startRes.text();
    if (startRes.status !== 429 || attempt >= 5) break;
    let wait = 12_000;
    try { const j = JSON.parse(startText); if (j.retry_after) wait = Math.max(2000, j.retry_after * 1000 + 500); } catch { /* default */ }
    await new Promise(r => setTimeout(r, wait));
  }
  if (!startRes.ok) throw new Error(`Replicate start ${startRes.status}: ${startText.slice(0, 250)}`);
  let job = JSON.parse(startText);
  const getUrl = job.urls?.get || `https://api.replicate.com/v1/predictions/${job.id}`;
  const deadline = Date.now() + 180_000;
  while (!['succeeded', 'failed', 'canceled'].includes(job.status)) {
    if (Date.now() > deadline) throw new Error('Replicate Timeout');
    await new Promise(r => setTimeout(r, 2500));
    job = await (await fetch(getUrl, { headers })).json();
  }
  if (job.status !== 'succeeded') throw new Error(`Replicate ${job.status}: ${JSON.stringify(job.error ?? '').slice(0, 200)}`);
  const url = Array.isArray(job.output) ? job.output[0] : job.output;
  if (!url) throw new Error('Replicate: keine Ausgabe');
  return { url };
}

/** FLUX Fill (Outpaint mit Maske). */
function genImageReplicate(prompt: string, image: string, mask: string) {
  return replicateRun(REPLICATE_FILL_MODEL, { prompt, image, mask, output_format: 'png', safety_tolerance: 6 });
}

/** Nano Banana (Gemini via Replicate): Image-to-Image, EIN Schritt (kein FLUX,
 *  kein Rahmen-Problem). `image` als Data-URI oder URL. */
function genImageNanoBanana(model: string, prompt: string, image: string, resolution: string) {
  return replicateRun(model, {
    prompt,
    image_input: [image],
    resolution,               // "1K" | "2K" | "4K"
    aspect_ratio: 'match_input_image',
    output_format: 'png',
  });
}

// FLUX (Diffusion) mag POSITIVE Beschreibungen, kaum Verneinungen. Daher ein
// eigener, knapper Prompt, der die gewünschte Szene beschreibt (statt „kein …").
const PROMPT_FLUX = [
  'We see only a CROPPED PART of a much larger, continuous world. Extend the central scene outward in',
  'every direction so it bleeds off all four edges of the frame, as if the camera simply shows a',
  'section of an endless landscape. Keep the SAME kind of place and environment as the center — if',
  'the center is a forest, continue the forest; if a city, continue the city — do not switch settings.',
  'Same art style, color palette, lighting and time of day as the center. Richly detailed, sharp and',
  'in focus, one single coherent scene that fills the whole canvas completely to the very edges.',
].join(' ');

// Nano Banana (Gemini) — Rand füllen bei fest vorkomponierter Mitte (exakte
// 3×3-Geometrie). Gemini verträgt Verneinungen.
const PROMPT_NB_FILL = [
  'Das mittlere Drittel dieses Bildes ist eine fertige Illustration; die GRAUE Fläche ringsum muss',
  'vollständig ERSETZT werden. Fülle den gesamten grauen Rand mit einer NAHTLOSEN Fortsetzung',
  'DERSELBEN Szene/Umgebung wie in der Mitte — gleicher Kunststil, gleiche Farben, Beleuchtung und',
  'Tageszeit, scharf und detailliert bis in alle Ecken, als Ausschnitt einer größeren durchgehenden',
  'Welt. Das mittlere Drittel bleibt unverändert. KEIN Rahmen, kein Bilderrahmen, kein Passepartout,',
  'kein Rand, kein Text, kein Copyright, keine Kacheln/Wiederholung, kein Grau mehr übrig.',
].join(' ');

// Kartenformat (63:88) — für exakt in 9 gleiche Kartenkacheln schneidbares 3×3.
const CARD_W = 63, CARD_H = 88;

// Nano-Banana Schritt 1: NUR Rahmen/Text entfernen, Illustration ERHALTEN,
// entfernte Flächen (v. a. Textbox unten) als Fortsetzung füllen.
const PROMPT_NB_CARD = [
  'Dies ist eine Pokémon-Karte. Entferne NUR den Kartenrahmen, den Namensbalken oben, die Textbox',
  'unten, alle Symbole, Logos, Werte und die Copyright-Zeile. Das gemalte ILLUSTRATIONSFENSTER bleibt',
  'völlig UNVERÄNDERT an genau seiner Position (bei dieser Karte im oberen Bereich) — verschiebe,',
  'skaliere oder verändere das Motiv NICHT und ändere den vorhandenen Hintergrund NICHT.',
  'Fülle NUR die durch das Entfernen frei gewordenen Flächen (vor allem die Textbox-Fläche darunter',
  'und die schmalen Rahmenränder), indem du die BEREITS VORHANDENE Szene/den Hintergrund des',
  'Illustrationsfensters natürlich, scharf und detailliert fortsetzt. Ergebnis: exakt dieselbe',
  'Illustration, nur ohne Rahmen/Text, randlos im gleichen Hochformat. Kein Rahmen, kein Text.',
].join(' ');

// Nano Banana (Gemini) — Ein-Schritt-3×3 (ohne feste Geometrie). Gemini folgt
// Anweisungen (inkl. Verneinungen) gut.
const PROMPT_NB_GRID = [
  'Zoome bei dieser Illustration weit heraus und erzeuge EIN EINZIGES, zusammenhängendes Bild, in dem',
  'das komplette Originalbild unverändert das MITTLERE DRITTEL (Bildmitte, ~1/3 der Breite und Höhe)',
  'einnimmt und ringsum in ALLE Richtungen nahtlos DIESELBE Szene/Umgebung fortgesetzt wird — als',
  'Ausschnitt einer viel größeren, durchgehenden Welt. Gleicher Kunststil, gleiche Farben, Beleuchtung',
  'und Tageszeit; wechsle die Umgebung NICHT. Alles scharf und detailliert bis in die Ecken. KEIN',
  'Kartenrahmen, kein Bilderrahmen, kein Passepartout, kein Rand, kein Text, kein Copyright, keine',
  'Kacheln/Wiederholung. Gleiches Hochformat-Seitenverhältnis wie die Eingabe.',
].join(' ');

interface CFOptions { imageSize?: string; aspectRatio?: string }

/** Ein Creative-Fabrica-Generationslauf: POST → pollen bis fertig → Bild-URL.
 *  `imageUrl` MUSS eine öffentliche URL sein (CF lädt sie selbst). */
async function genImageCF(
  model: string,
  prompt: string,
  imageUrl: string,
  opts: CFOptions = {},
): Promise<{ url: string }> {
  if (!CF_KEY) throw new Error('CREATIVEFABRICA_API_KEY fehlt');
  const headers = { Authorization: `Bearer ${CF_KEY}`, 'Content-Type': 'application/json' };
  const startRes = await fetch(`${CF_BASE}/generations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      modality: 'imageToImage',
      prompt,
      files: [{ url: imageUrl }],
      options: {
        // aspectRatio variiert je Modell — nur senden, wenn explizit gewünscht;
        // sonst behält imageToImage das Hochformat der Eingabe.
        ...(opts.aspectRatio ? { aspectRatio: opts.aspectRatio } : {}),
        imageSize: opts.imageSize ?? '2k',
      },
    }),
  });
  const startText = await startRes.text();
  if (!startRes.ok) throw new Error(`CF start ${startRes.status}: ${startText.slice(0, 200)}`);
  let job = JSON.parse(startText);

  // Pollen (async): bis completed/failed/cancelled, max ~150 s.
  const deadline = Date.now() + 150_000;
  while (!['completed', 'failed', 'cancelled'].includes(job.status)) {
    if (Date.now() > deadline) throw new Error('CF Timeout');
    await new Promise(r => setTimeout(r, 2500));
    const pollRes = await fetch(`${CF_BASE}/generations/${job.id}`, { headers });
    job = await pollRes.json();
  }
  if (job.status !== 'completed') throw new Error(`CF ${job.status}: ${JSON.stringify(job.error ?? job).slice(0, 200)}`);
  const url = job.output?.[0]?.url;
  if (!url) throw new Error('CF: keine Ausgabe-URL');
  return { url };
}

// Schritt 1: Karte → randlose Illustration (Text/Rahmen weg, aufs Kartenformat erweitert).
const PROMPT_CARD = [
  'You are given a Pokémon trading card. Remove the card frame, border, name, HP, attack text, set',
  'symbols, logos and copyright line completely, and show ONLY the illustration.',
  'Keep the subject and the existing foreground EXACTLY as they are; do not redraw, restyle or move',
  'them. EXTEND the scenery outward so it fills the ENTIRE portrait canvas edge-to-edge, all the way',
  'into every corner, with REAL, DETAILED content (e.g. forest floor, plants, leaves, rocks,',
  'branches) — NOT a uniform out-of-focus / bokeh blur.',
  'Keep the subject and the whole FOREGROUND SHARP and in focus; only the FAR background may be',
  'gently soft, like in the original. Same art style, colors and lighting.',
].join(' ');

// Kaskade Pass 1 (horizontal): Mitte = echte Szene, links/rechts = Kanten-
// Platzhalter, den das Modell in nahtlose Umgebung umwandelt. Bewusst SCHLANK
// gehalten (die frühere Direktiven-Häufung ließ Gemini den Rand unvollständig
// übermalen → Streifen/Symmetrie). Stil/Farbe nur als EIN kurzer Satz.
const PROMPT_H = [
  'This image has real scenery in the CENTER third and a stretched placeholder on the LEFT and',
  'RIGHT thirds. FIRST look at what the center actually depicts — it may be a forest, an orchard,',
  'a CITY or ROOFTOPS, a SKY at sunset with clouds, water, mountains, a desert, snow, an interior,',
  'etc. Repaint the left and right thirds into a natural, continuous extension of THAT SAME setting',
  '(same kind of place, same time of day, same weather), seamlessly extending the center outward.',
  'Do NOT switch to a different environment (e.g. do NOT turn a city or sky into a forest).',
  'Fully replace the placeholder — leave no stripes, bands or seams. Match the SAME art style, color',
  'palette and lighting as the center (keep the clay/plasticine look ONLY if the center shows it; no',
  'photorealism if the center is illustrated).',
  'UNIFORM FOCUS: the final image must be SHARP and in focus across the ENTIRE frame; if any area',
  '(including the background behind the central subject) is blurred, re-render it sharp and detailed —',
  'no bokeh, no empty haze, no soft focus band. Keep the central SUBJECT exactly where it is, sharp',
  'and unchanged; only the surroundings are rebuilt.',
  'ASYMMETRY: the LEFT and RIGHT sides must look CLEARLY DIFFERENT from each other — no mirror',
  'symmetry, no matching pair of framing elements, no duplicated shapes between the two sides.',
  'QUALITY: no vertical or horizontal streaks/bands/smears on walls, buildings or sky; skies and',
  'clouds must look natural (no swirled or warped patterns); keep the central creature\'s anatomy',
  'intact and correct (wings, tail, limbs) — do not cut, duplicate or distort the tail or wings.',
  'Do NOT add any character or a copy of the central subject. Output one image, same wide aspect',
  'ratio, edge to edge.',
].join(' ');

// Kaskade Pass 2 (vertikal): breite Szene, oben/unten = Platzhalter → nahtlos ergänzen.
const PROMPT_V = [
  'This is a wide scene with real content in the vertical CENTER and a stretched placeholder along',
  'the TOP and BOTTOM. FIRST look at what the scene actually depicts (forest, city/rooftops, sky at',
  'sunset, water, mountains, desert, etc.) and extend the TOP upward and the BOTTOM downward as a',
  'natural continuation of THAT SAME setting (e.g. more sky/clouds above and more ground/street/water',
  'below, matching the scene), seamlessly connected. Do NOT switch to a different environment.',
  'Fully replace the placeholder — leave no stripes, bands or seams. Match the SAME art style, color',
  'palette and lighting as the center (keep the clay/plasticine look ONLY if the center shows it; no',
  'photorealism if illustrated).',
  'UNIFORM FOCUS: the final image must be SHARP and in focus across the ENTIRE frame; re-render any',
  'blurred area sharp and detailed — no bokeh, no empty haze, no soft focus band. Keep the central',
  'SUBJECT exactly where it is, sharp and unchanged; only the surroundings are rebuilt.',
  'ASYMMETRY: TOP and BOTTOM (and the top-left vs top-right corners) must look CLEARLY DIFFERENT — no',
  'mirror symmetry, no matching/duplicated framing elements between corners or sides.',
  'QUALITY: no vertical or horizontal streaks/bands/smears on walls, buildings or sky; skies and',
  'clouds must look natural (no swirled or warped patterns); keep the central creature\'s anatomy',
  'intact and correct (wings, tail, limbs) — do not cut, duplicate or distort the tail or wings.',
  'Do NOT add any character or copy of any subject. Output one image, same tall aspect ratio, edge to edge.',
].join(' ');

// Test-Variante 'gem': das AI-Studio-Gem so exakt wie möglich nachbauen — lange
// kaskadierende Anweisung als systemInstruction (eigener Kanal → bessere
// Befolgung), Bild OHNE Seed, EIN Aufruf. Kein Vor-Seeding, kein 2-Pass.
const GEM_SYSTEM = [
  'Erzeuge EINE EINZIGE, zusammenhängende, weit herausgezoomte Szene (KEIN Raster, KEINE Kacheln,',
  'KEINE Panels, KEINE Wiederholung, keine Gitterlinien).',
  'Analysiere zuerst das Quellbild gründlich: Inhalt, Stil (z. B. gemalt/Illustration, Knetmodell,',
  'Foto), Farbpalette, Textur, Beleuchtung, Tageszeit, Wetter und Umgebung (z. B. Wald, Stadt/Dächer,',
  'Himmel, Wasser, Berge). Halte diesen Look strikt ein; wechsle NICHT die Umgebung.',
  'Stell dir vor, die Kamera zoomt weit heraus: Das komplette Originalbild bleibt UNVERÄNDERT in der',
  'BILDMITTE (nicht skaliert, nicht beschnitten, Motiv-Anatomie korrekt: Flügel/Schwanz/Glieder), und',
  'ringsherum in ALLE Richtungen wird DIESELBE Szene nahtlos fortgeführt — als wäre es schon immer ein',
  'großes zusammenhängendes Bild gewesen. Das Motiv der Mitte soll ca. das mittlere Drittel einnehmen.',
  'Das Ausgabebild ist dreimal so hoch und dreimal so breit wie das Quellbild (gleiches Seitenverhältnis),',
  'randlos gefüllt.',
  'Alles scharf und im Fokus (kein Bokeh-Band). KEINE senkrechten/waagerechten Streifen, Bänder,',
  'Barcode-Muster, Smears, verwirbelten Wolken oder gespiegelte Symmetrie; linke/rechte Seite und die',
  'Ecken sollen sich klar unterscheiden. Keine Ränder, Rahmen, Texte oder UI-Elemente.',
  'Du DARFST dasselbe Pokémon zusätzlich in anderen Posen/Perspektiven in die Szene einbauen',
  '(z. B. weitere Exemplare im Flug) — das ist erwünscht und keine Spiegelung.',
  'Gib NUR EIN fertiges, zusammenhängendes Bild zurück.',
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
  systemInstruction?: string,
): Promise<{ mimeType: string; data: string }> {
  const model = genAI.getGenerativeModel({
    model: modelName,
    ...(systemInstruction ? { systemInstruction } : {}),
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

/** Leinwand um die Ränder als Outpaint-Seed erweitern: Kanten strecken (`copy`),
 *  das Ganze WEICHZEICHNEN und dann die SCHARFE Mitte wieder einsetzen. So gibt
 *  es am Rand keine harten senkrechten Streifen mehr (die Gemini bei
 *  unvollständigem Übermalen als Barcode stehen ließ), sondern nur weiche
 *  Farbverläufe; die Mitte (Motiv) bleibt scharf und korrekt. */
async function extendEdges(b64: string, side: number, vert: number): Promise<string> {
  const buf = Buffer.from(b64, 'base64');
  const blurredBorder = await sharp(buf)
    .extend({ left: side, right: side, top: vert, bottom: vert, extendWith: 'copy' })
    .blur(28)
    .toBuffer();
  const out = await sharp(blurredBorder)
    .composite([{ input: buf, left: side, top: vert }]) // scharfe Original-Mitte zurück
    .png().toBuffer();
  return out.toString('base64');
}

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { imageUrl, model: modelOverride, mode, variant, provider, cfModel, imageSize, aspectRatio } = await req.json();
    if (!imageUrl || typeof imageUrl !== 'string') {
      return NextResponse.json({ error: 'imageUrl fehlt' }, { status: 400 });
    }

    // ── Creative-Fabrica-Provider (async REST): EIN Schritt aus der öffentlichen
    // Karten-URL (Text entfernen + zur 3×3-Szene erweitern). Bild-URL muss public
    // sein (data:-URLs gehen NICHT — CF lädt selbst).
    if (provider === 'cf') {
      if (imageUrl.startsWith('data:')) {
        return NextResponse.json({ error: 'CF braucht eine öffentliche URL (keine data:-URL)' }, { status: 400 });
      }
      const model = typeof cfModel === 'string' && cfModel ? cfModel : 'gemini_pro_3';
      const prompt = mode === 'grid3x3' ? PROMPT_CF_GRID3X3 : PROMPT_CF_CARD;
      const t0 = Date.now();
      try {
        const { url } = await genImageCF(model, prompt, imageUrl, { imageSize, aspectRatio });
        return NextResponse.json({ provider: 'cf', model, mode: mode ?? 'card', latencyMs: Date.now() - t0, image: url });
      } catch (e) {
        return NextResponse.json({ provider: 'cf', model, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
      }
    }

    // ── Nano Banana (Gemini via Replicate): Ein-Schritt-3×3, kein FLUX-Rahmen.
    if (provider === 'nb') {
      const model = typeof cfModel === 'string' && cfModel ? cfModel : 'google/nano-banana-2';
      const res = typeof imageSize === 'string' && imageSize ? imageSize.toUpperCase() : '2K';
      const t0 = Date.now();
      try {
        // Schritt 1 über Nano Banana: Rahmen/Text weg, Illustration erhalten.
        if (mode === 'card') {
          const { url } = await genImageNanoBanana(model, PROMPT_NB_CARD, imageUrl, res);
          return NextResponse.json({ provider: 'nb', model, mode: 'card', latencyMs: Date.now() - t0, image: url });
        }

        // Feste 3×3-Geometrie: Mitte = exakt eine Kartenkachel (63:88), grauer
        // Rand → Nano Banana füllt nur den Rand → danach Mitte pixelgenau zurück.
        const tileH = res === '4K' ? 1200 : res === '1K' ? 512 : 800;
        const tileW = Math.round((tileH * CARD_W) / CARD_H);
        const s = await fetchImageBase64(imageUrl);
        const center = await sharp(Buffer.from(s.data, 'base64')).resize(tileW, tileH, { fit: 'cover' }).png().toBuffer();
        const CW = tileW * 3, CH = tileH * 3;
        const canvas = await sharp({ create: { width: CW, height: CH, channels: 3, background: { r: 127, g: 127, b: 127 } } })
          .composite([{ input: center, left: tileW, top: tileH }]).png().toBuffer();

        const { url } = await genImageNanoBanana(model, PROMPT_NB_FILL, `data:image/png;base64,${canvas.toString('base64')}`, res);

        // Nur auf die exakte 3×-Leinwand ziehen — KEIN Wieder-Einsetzen der Mitte
        // (das erzeugte eine harte Naht). Nano Banana behält die Mitte selbst und
        // führt sie nahtlos in den Rand über.
        const outBuf = Buffer.from(await (await fetch(url)).arrayBuffer());
        const final = await sharp(outBuf).resize(CW, CH, { fit: 'fill' }).png().toBuffer();
        return NextResponse.json({
          provider: 'nb', model, latencyMs: Date.now() - t0,
          image: `data:image/png;base64,${final.toString('base64')}`,
        });
      } catch (e) {
        return NextResponse.json({ provider: 'nb', model, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
      }
    }

    // ── Replicate FLUX Fill (Outpaint): Illustration → 3×-Szene, Mitte exakt.
    if (provider === 'replicate') {
      const t0 = Date.now();
      try {
        const s = await fetchImageBase64(imageUrl); // data:- ODER http-URL
        let buf: Buffer = Buffer.from(s.data, 'base64');
        // Vorskalieren, damit die finale Leinwand (nach allen Pässen) ≤ FLUX-Limit bleibt.
        const total = Math.pow(FLUX_PASS_FACTOR, FLUX_PASSES);
        const md0 = await sharp(buf).metadata();
        const long0 = Math.max(md0.width ?? 512, md0.height ?? 700);
        const targetCenter = Math.floor(FLUX_MAX_LONG / total);
        if (long0 > targetCenter) {
          const sc = targetCenter / long0;
          buf = await sharp(buf).resize(Math.round((md0.width ?? 512) * sc), Math.round((md0.height ?? 700) * sc)).png().toBuffer();
        }
        let url = '';
        for (let i = 0; i < FLUX_PASSES; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 11_000)); // Rate-Limit (<$5: ~1/10s)
          const { image, mask } = await outpaintCanvas(buf, FLUX_PASS_FACTOR);
          url = (await genImageReplicate(PROMPT_FLUX, image, mask)).url;
          if (i < FLUX_PASSES - 1) buf = Buffer.from(await (await fetch(url)).arrayBuffer());
        }
        return NextResponse.json({ provider: 'replicate', model: REPLICATE_FILL_MODEL, passes: FLUX_PASSES, latencyMs: Date.now() - t0, image: url });
      } catch (e) {
        return NextResponse.json({ provider: 'replicate', error: e instanceof Error ? e.message : String(e) }, { status: 502 });
      }
    }

    const src = await fetchImageBase64(imageUrl);
    const models = typeof modelOverride === 'string' && modelOverride ? [modelOverride] : IMAGE_MODELS;
    const errors: Record<string, string> = {};

    for (const modelName of models) {
      try {
        const t0 = Date.now();

        if (mode === 'grid3x3' && variant !== 'cascade') {
          // STANDARD: Gem-Nachbau — lange Anweisung als systemInstruction, Bild ohne Seed, ein Aufruf.
          const out = await genImage(
            modelName,
            'Erweitere dieses Bild gemäß deinen System-Anweisungen zu einem nahtlosen 3×3-Gesamtbild.',
            src,
            GEM_SYSTEM,
          );
          return NextResponse.json({
            model: modelName, latencyMs: Date.now() - t0, passes: 1, variant: 'gem',
            mimeType: out.mimeType, image: `data:${out.mimeType};base64,${out.data}`,
          });
        }

        if (mode === 'grid3x3' && variant === 'cascade') {
          // FALLBACK (variant:'cascade'): erst links/rechts, dann oben/unten erweitern. So sieht das
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
