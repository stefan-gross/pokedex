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
 *  (Rand weiß = füllen, Mitte schwarz = behalten). Kein Re-Scale des Inhalts.
 *  `seedEdge`: Rand mit gestreckten+verwischten Mitten-Kanten vorbelegen (Farb-/
 *  Maßstabs-Anker) statt flachem Grau → weniger Streifen-Artefakte beim FLUX-Fill. */
async function outpaintCanvas(buf: Buffer, factor: number, seedEdge = false): Promise<{ image: string; mask: string }> {
  const md = await sharp(buf).metadata();
  const w = md.width ?? 512, h = md.height ?? 700;
  const CW = Math.round(w * factor), CH = Math.round(h * factor);
  const left = Math.round((CW - w) / 2), top = Math.round((CH - h) / 2);

  let image: Buffer;
  if (seedEdge) {
    const seed = await sharp(buf)
      .extend({ left, right: CW - w - left, top, bottom: CH - h - top, extendWith: 'copy' })
      .blur(Math.max(12, Math.round(Math.min(w, h) * 0.06))).toBuffer();
    image = await sharp(seed).composite([{ input: buf, left, top }]).png().toBuffer();
  } else {
    image = await sharp({ create: { width: CW, height: CH, channels: 3, background: { r: 127, g: 127, b: 127 } } })
      .composite([{ input: buf, left, top }])
      .png().toBuffer();
  }
  const blackRect = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
  const mask = await sharp({ create: { width: CW, height: CH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: blackRect, left, top }])
    .png().toBuffer();

  return {
    image: `data:image/png;base64,${image.toString('base64')}`,
    mask: `data:image/png;base64,${mask.toString('base64')}`,
  };
}

/** Overlay-Maske für Inpainting: gleiche Größe wie das Kartenbild. Ein oder mehrere
 *  „behalten"-Rechtecke (Illustrationsfenster, in Bruchteilen 0..1) werden SCHWARZ,
 *  der ganze Rest (Rahmen, Namensbalken, Textboxen, Infozeile) WEISS = auffüllen.
 *  So bleibt das Motiv pixelgenau und nur die Element-Flächen werden ersetzt. */
async function buildOverlayMask(
  w: number, h: number,
  keeps: Array<{ x0: number; y0: number; x1: number; y1: number }>,
): Promise<Buffer> {
  const rects = [];
  for (const k of keeps) {
    const kx = Math.round(k.x0 * w), ky = Math.round(k.y0 * h);
    const kw = Math.max(1, Math.round((k.x1 - k.x0) * w));
    const kh = Math.max(1, Math.round((k.y1 - k.y0) * h));
    const black = await sharp({ create: { width: kw, height: kh, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    rects.push({ input: black, left: kx, top: ky });
  }
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(rects).png().toBuffer();
}

/** FLUX-Maske aus „entfernen"-Rechtecken: schwarz (behalten) überall, WEISS (füllen)
 *  nur auf den angegebenen Zonen → FLUX lässt alles außerhalb pixelgenau, füllt nur
 *  die kleinen Text-/Rahmen-Streifen. Ideal für Full-Bleed-Arts mit Text-Overlay. */
async function buildRemoveMask(
  w: number, h: number,
  removes: Array<{ x0: number; y0: number; x1: number; y1: number }>,
): Promise<Buffer> {
  const rects = [];
  for (const k of removes) {
    const kx = Math.round(k.x0 * w), ky = Math.round(k.y0 * h);
    const kw = Math.max(1, Math.round((k.x1 - k.x0) * w));
    const kh = Math.max(1, Math.round((k.y1 - k.y0) * h));
    const white = await sharp({ create: { width: kw, height: kh, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
    rects.push({ input: white, left: kx, top: ky });
  }
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite(rects).png().toBuffer();
}

/** Nur die angegebenen Rechtecke im Bild GRAU übermalen (Rest bleibt Original) —
 *  für den NB-Inpaint, der dann NUR diese grauen Text-/Rahmen-Streifen ersetzt. */
async function grayOutRects(
  buf: Buffer, w: number, h: number,
  rects: Array<{ x0: number; y0: number; x1: number; y1: number }>,
): Promise<Buffer> {
  const parts = [];
  for (const k of rects) {
    const kx = Math.round(k.x0 * w), ky = Math.round(k.y0 * h);
    const kw = Math.max(1, Math.round((k.x1 - k.x0) * w));
    const kh = Math.max(1, Math.round((k.y1 - k.y0) * h));
    const gray = await sharp({ create: { width: kw, height: kh, channels: 3, background: { r: 127, g: 127, b: 127 } } }).png().toBuffer();
    parts.push({ input: gray, left: kx, top: ky });
  }
  return sharp(buf).composite(parts).png().toBuffer();
}

/** Weiche Alpha-Maske (1-Kanal PNG) für ein Rechteck: innen deckend, Rand ausgefadet. */
async function featherAlpha(kw: number, kh: number, f: number): Promise<Buffer> {
  const inner = await sharp({ create: { width: Math.max(1, kw - 2 * f), height: Math.max(1, kh - 2 * f), channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  return sharp({ create: { width: kw, height: kh, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: inner, left: f, top: f }]).blur(f).extractChannel(0).toColourspace('b-w').png().toBuffer();
}

// Standard-Schablone (moderne Normalkarte): Illustrationsfenster = behalten (schwarz),
// alles andere (Rahmen oben/unten/seitlich, Namensbalken, Textbox, Infozeile) = füllen.
const MASK_KEEP_STANDARD = [{ x0: 0.075, y0: 0.105, x1: 0.925, y1: 0.485 }];

/** Graues Composite fürs NB-Inpainting: die „behalten"-Rechtecke aus dem Original
 *  bleiben sichtbar, alles andere wird neutral GRAU → Nano Banana ersetzt nur das
 *  Grau (kein Text-Halluzinieren wie FLUX, Position bleibt exakt). */
async function buildGrayComposite(
  buf: Buffer, w: number, h: number,
  keeps: Array<{ x0: number; y0: number; x1: number; y1: number }>,
): Promise<Buffer> {
  const parts = [];
  for (const k of keeps) {
    const kx = Math.round(k.x0 * w), ky = Math.round(k.y0 * h);
    const kw = Math.max(1, Math.round((k.x1 - k.x0) * w));
    const kh = Math.max(1, Math.round((k.y1 - k.y0) * h));
    const crop = await sharp(buf).extract({ left: kx, top: ky, width: kw, height: kh }).png().toBuffer();
    parts.push({ input: crop, left: kx, top: ky });
  }
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 127, g: 127, b: 127 } } })
    .composite(parts).png().toBuffer();
}

// Nano-Banana-Inpaint für ABSTRAKTE Full-Arts: kein realistisches Setting erfinden,
// sondern das grafische Muster (Blitze/Strahlen/Sterne/Energie) fortführen.
const PROMPT_NB_INPAINT_ABSTRACT = [
  'Die GRAUEN Flächen in diesem Bild müssen vollständig ERSETZT werden. Führe das ABSTRAKTE',
  'GRAFISCHE MUSTER des sichtbaren Artworks nahtlos fort: dieselben Energie-Blitze, dynamischen',
  'Strahlen, Sterne, Funken, Farbverläufe und Lichteffekte im GLEICHEN Kunststil, mit denselben',
  'Farben und Kontrasten. ERFINDE KEINE realistische Umgebung oder Landschaft (kein Dschungel, keine',
  'Felsen, keine Gebäude, keine Maschinen). Der NICHT-graue Bildteil (die Kreatur) bleibt völlig',
  'unverändert an exakt seiner Position und Größe. Ergebnis: eine randlose, zusammenhängende',
  'Grafik im gleichen Hochformat. Kein Text, kein Titel, kein Namensbalken, kein Rahmen, kein Rand,',
  'keine Textbox, kein Grau mehr übrig.',
].join(' ');

// Nano-Banana-Inpaint: graue Flächen szenengerecht ersetzen, Rest (Artwork) behalten.
const PROMPT_NB_INPAINT = [
  'Die GRAUEN Flächen in diesem Bild müssen vollständig ERSETZT werden durch eine nahtlose',
  'Fortsetzung der bereits vorhandenen, gemalten Illustration (dieselbe Szene/Umgebung, gleicher',
  'Kunststil, gleiche Farben, Beleuchtung und Tageszeit), scharf und detailliert bis in alle Ecken.',
  'Der NICHT-graue Bildteil (das Motiv/Artwork) bleibt völlig UNVERÄNDERT an exakt seiner Position',
  'und Größe — verschiebe oder verändere ihn NICHT. Ergebnis: eine randlose, zusammenhängende',
  'Illustration im gleichen Hochformat. Kein Text, kein Rahmen, keine Textbox, kein Grau mehr übrig.',
].join(' ');

// FLUX-Fill-Inpaint: nur die maskierten (weißen) Element-Flächen szenengerecht
// auffüllen; das sichtbare Artwork in der Mitte bleibt. Positiver Prompt (FLUX mag
// keine Verneinungen).
const PROMPT_INPAINT = [
  'Fill the masked regions with a natural, seamless continuation of the painted illustration that is',
  'visible in the unmasked area — the SAME scene and surroundings, the SAME art style, colour palette,',
  'lighting and time of day. Extend the artwork so the whole picture becomes one single coherent,',
  'borderless illustration, sharp and detailed all the way to every edge. Keep the unmasked artwork',
  'exactly as it is; only paint inside the masked areas, blending them invisibly into the scene.',
].join(' ');

/** Generischer Replicate-Lauf: POST an ein Modell → pollen → Ergebnis-URL.
 *  Mit 429-Handling (bei <$5 Guthaben Burst 1/min). */
async function replicateRun(modelPath: string, input: Record<string, unknown>): Promise<{ url: string }> {
  if (!REPLICATE_TOKEN) throw new Error('REPLICATE_API_TOKEN fehlt');
  const headers = { Authorization: `Bearer ${REPLICATE_TOKEN}`, 'Content-Type': 'application/json' };
  // 64-hex = Versionshash → generischer /v1/predictions-Endpoint (Community-Modelle);
  // sonst offizieller models/{owner}/{name}/predictions-Endpoint.
  const isVersion = /^[0-9a-f]{64}$/.test(modelPath);
  const endpoint = isVersion ? 'https://api.replicate.com/v1/predictions' : `https://api.replicate.com/v1/models/${modelPath}/predictions`;
  const body = JSON.stringify(isVersion ? { version: modelPath, input } : { input });
  let startRes: Response, startText = '';
  for (let attempt = 0; ; attempt++) {
    startRes = await fetch(endpoint, { method: 'POST', headers, body });
    startText = await startRes.text();
    if (startRes.status !== 429 || attempt >= 5) break;
    let wait = 12_000;
    try { const j = JSON.parse(startText); if (j.retry_after) wait = Math.max(2000, j.retry_after * 1000 + 500); } catch { /* default */ }
    await new Promise(r => setTimeout(r, wait));
  }
  if (!startRes.ok) throw new Error(`Replicate start ${startRes.status}: ${startText.slice(0, 250)}`);
  let job = JSON.parse(startText);
  const getUrl = job.urls?.get || `https://api.replicate.com/v1/predictions/${job.id}`;
  const deadline = Date.now() + 280_000;
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
  'The extension must look smooth, natural and organic, with the same texture scale as the center;',
  'skies and open areas are smooth gradients with soft clouds. Avoid any vertical or horizontal',
  'streaks, bands, stripes or repeated smears.',
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

// 3×3-Rand mit KANTEN-VORLAGE: der Rand ist bereits eine unscharfe, aus der Mitte
// herausgezogene Version → NB soll ihn nur SCHARF ausarbeiten, streng im Maßstab der Mitte.
const PROMPT_NB_FILL_EDGE = [
  'Das mittlere Drittel dieses Bildes ist eine fertige, SCHARFE Illustration. Der unscharfe Bereich',
  'ringsum ist eine aus den Rändern der Mitte herausgezogene VORLAGE — arbeite ihn SCHARF und',
  'detailliert aus als NAHTLOSE Fortsetzung DERSELBEN Szene. ENTSCHEIDEND: exakt DERSELBE MASSSTAB',
  'wie in der Mitte — KEINE Maßstabssprünge, keine plötzlich größeren oder kleineren Objekte.',
  'Führe die vorhandenen Strukturen (z. B. Gebäude, Dächer, Äste, Felsen, Flügel, Boden) direkt über',
  'die Kanten der Mitte hinaus WEITER, als würde man aus der Szene herauszoomen und mehr von',
  'derselben Welt sehen. Gleicher Kunststil, gleiche Farben, Beleuchtung und Tageszeit. Die Mitte',
  'bleibt unverändert an ihrer Stelle. Kein Rahmen, kein Rand, kein Text, keine Kacheln.',
].join(' ');


// Nano-Banana Schritt 1: Illustration ERHALTEN (Position/Größe/Stil), aber ALLE
// Nicht-Bild-Elemente VOLLSTÄNDIG entfernen (auch Panels über Full-Art) und die frei
// gewordenen Flächen szenengerecht fortsetzen — NICHT flach füllen, Motiv NIE entfernen.
const PROMPT_NB_CARD = [
  'Dies ist eine Pokémon-Karte. Entferne VOLLSTÄNDIG ALLE Nicht-Bild-Elemente: den äußeren',
  'Kartenrahmen und Rand, den Namensbalken oben, HP, alle Typ-/Energiesymbole, die Attacken- und',
  'Fähigkeits-Textboxen, Schwäche/Resistenz/Rückzug, das Set-Symbol, die Seltenheit, die',
  'Sammlernummer und die Illustrator-/Copyright-Zeile — auch halbtransparente Text- oder Wert-Panels,',
  'die BEI FULL-ART-KARTEN ÜBER dem Bild liegen. Danach darf KEIN Text, KEINE Zahl, KEIN Symbol,',
  'KEIN Rahmen und KEINE Textbox mehr zu sehen sein.',
  'WICHTIG — verändere die Illustration selbst NICHT: das Motiv/Pokémon und die gesamte Szene bleiben',
  'an EXAKT derselben Position, Größe, Pose und im selben Stil, mit demselben Hintergrund; verschiebe,',
  'skaliere, spiegele oder verändere sie NICHT und entferne das Pokémon NIEMALS.',
  'Rekonstruiere NUR die durch das Entfernen frei gewordenen Flächen, indem du die unmittelbar',
  'angrenzende Illustration natürlich, scharf und detailliert fortsetzt — KEINE flache Farbfläche,',
  'kein Farbverlauf, kein Balken. Ergebnis: exakt dieselbe Illustration, randlos im gleichen',
  'Hochformat, ohne Rahmen und ohne jeglichen Text.',
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

// Schritt 1: Karte → randlose Illustration. WICHTIG: EDIT-ONLY / Inpainting-Denke —
// NUR die Overlay-Elemente entfernen und exakt DIESE Stellen auffüllen; die Illustration
// selbst (Motiv, Position, Größe, Hintergrund, Stil) bleibt unangetastet; NICHTS dazu erfinden.
const PROMPT_CARD = [
  'You are given a Pokémon trading card. Treat this as a precise EDIT/INPAINTING task, NOT a redraw.',
  'REMOVE ONLY the overlay graphics that are not part of the painting: the outer card frame and',
  'border, the holo/foil frame edges, the name bar, HP, the type/energy and weakness/resistance/retreat',
  'symbols, the attack and ability TEXT BOXES, the rarity mark, the set symbol, the collector number,',
  'and the illustrator/copyright line. Show ONLY the painted illustration, borderless in the same',
  'portrait aspect ratio.',
  'CRITICAL — do NOT change the illustration itself: keep the creature/subject and ALL scenery at',
  'EXACTLY the same position, size, pose, framing, colors, lighting and art style as in the original.',
  'Do NOT move, rescale, shift, mirror, zoom, re-center, restyle or repaint the subject or the scene.',
  'NEVER remove, hide or replace the creature/subject — it must always stay fully visible exactly where',
  'it is. Do NOT invent or add ANY new objects, characters, buildings, plants or scenery.',
  'Reconstruct ONLY the exact areas that the removed elements used to cover (the text boxes, bars,',
  'borders, and — for full-art cards — the semi-transparent panels lying ON TOP of the artwork) by',
  'naturally continuing the immediately adjacent painting, so those spots blend in seamlessly. Where a',
  'removed panel overlapped the creature or scenery, rebuild only what was plausibly behind it, matching',
  'the surrounding art. Everything that was NOT covered by a removed element must stay pixel-faithful.',
  'Fill all the way into every corner with real, detailed continuation of the SAME scene — no empty',
  'bokeh haze. Keep the foreground sharp; only the far background may be gently soft, as in the original.',
  'Output one image, same portrait aspect ratio, edge to edge, no frame, no text.',
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
    const { imageUrl, model: modelOverride, mode, variant, provider, cfModel, imageSize, aspectRatio, maskKeep, maskRemove, engine, pasteBack, centerScale } = await req.json();
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

    // ── Inpaint-Provider (FLUX Fill mit Schablonen-Maske): Elemente entfernen, Motiv
    // pixelgenau behalten. `maskKeep` = optionale „behalten"-Rechtecke (Bruchteile),
    // sonst Standard-Normalkarte. Antwort enthält auch die Maske (Debug/Overlay).
    if (provider === 'inpaint') {
      const t0 = Date.now();
      try {
        const s = await fetchImageBase64(imageUrl);
        const buf = Buffer.from(s.data, 'base64');
        const md = await sharp(buf).metadata();
        const w = md.width ?? 600, h = md.height ?? 825;
        const keeps = Array.isArray(maskKeep) && maskKeep.length ? maskKeep : MASK_KEEP_STANDARD;
        const eng = engine === 'flux' ? 'flux' : 'nb';
        if (eng === 'flux') {
          // FLUX Fill (echter Inpainter): schwarz = pixelgenau behalten, weiß = füllen.
          // `maskRemove` (Text-/Rahmen-Streifen) bevorzugt → kleine Füllfläche, Rest exakt;
          // sonst aus `keeps` (Fenster behalten, Rest füllen).
          const maskBuf = Array.isArray(maskRemove) && maskRemove.length
            ? await buildRemoveMask(w, h, maskRemove)
            : await buildOverlayMask(w, h, keeps);
          const imgURI = `data:image/png;base64,${buf.toString('base64')}`;
          const maskURI = `data:image/png;base64,${maskBuf.toString('base64')}`;
          const { url } = await genImageReplicate(PROMPT_INPAINT, imgURI, maskURI);
          const outBuf = Buffer.from(await (await fetch(url)).arrayBuffer());
          const outURI = `data:image/png;base64,${(await sharp(outBuf).png().toBuffer()).toString('base64')}`;
          return NextResponse.json({ provider: 'inpaint', engine: 'flux', latencyMs: Date.now() - t0, image: outURI, mask: maskURI });
        }
        // NB-Inpaint. Zwei Modi:
        //  • maskRemove: NUR diese Zonen grauen → NB füllt sie → Rest bleibt Original
        //    pixelgenau (nur die Streifen aus NB, weiche Kante). Ideal als Stufe 2 nach FLUX.
        //  • sonst keeps: alles außer dem Fenster grauen → NB füllt → optional Fenster-Paste-Back.
        const removes = Array.isArray(maskRemove) && maskRemove.length ? maskRemove : null;
        const grayBuf = removes ? await grayOutRects(buf, w, h, removes) : await buildGrayComposite(buf, w, h, keeps);
        const grayURI = `data:image/png;base64,${grayBuf.toString('base64')}`;
        const model = typeof cfModel === 'string' && cfModel ? cfModel : 'google/nano-banana-2';
        const res = typeof imageSize === 'string' ? imageSize : '2K';
        const inpaintPrompt = variant === 'abstract' ? PROMPT_NB_INPAINT_ABSTRACT : PROMPT_NB_INPAINT;
        const { url } = await genImageNanoBanana(model, inpaintPrompt, grayURI, res);
        const nbBuf = await sharp(Buffer.from(await (await fetch(url)).arrayBuffer())).resize(w, h, { fit: 'fill' }).png().toBuffer();
        let composed: Buffer;
        if (removes) {
          // Rest = Original pixelgenau; nur die Remove-Zonen aus NB (weiche Kante).
          composed = await sharp(buf).png().toBuffer();
          for (const k of removes) {
            const kx = Math.round(k.x0 * w), ky = Math.round(k.y0 * h);
            const kw = Math.max(1, Math.round((k.x1 - k.x0) * w));
            const kh = Math.max(1, Math.round((k.y1 - k.y0) * h));
            const f = Math.max(4, Math.round(Math.min(kw, kh) * 0.08));
            const nbCrop = await sharp(nbBuf).extract({ left: kx, top: ky, width: kw, height: kh }).removeAlpha().joinChannel(await featherAlpha(kw, kh, f)).png().toBuffer();
            composed = await sharp(composed).composite([{ input: nbCrop, left: kx, top: ky }]).png().toBuffer();
          }
        } else {
          composed = nbBuf;
          if (pasteBack !== false) {
            for (const k of keeps) {
              const kx = Math.round(k.x0 * w), ky = Math.round(k.y0 * h);
              const kw = Math.max(1, Math.round((k.x1 - k.x0) * w));
              const kh = Math.max(1, Math.round((k.y1 - k.y0) * h));
              const crop = await sharp(buf).extract({ left: kx, top: ky, width: kw, height: kh }).removeAlpha().joinChannel(await featherAlpha(kw, kh, Math.max(4, Math.round(Math.min(kw, kh) * 0.05)))).png().toBuffer();
              composed = await sharp(composed).composite([{ input: crop, left: kx, top: ky }]).png().toBuffer();
            }
          }
        }
        const outURI = `data:image/png;base64,${composed.toString('base64')}`;
        return NextResponse.json({ provider: 'inpaint', engine: 'nb', model, latencyMs: Date.now() - t0, image: outURI, mask: grayURI });
      } catch (e) {
        return NextResponse.json({ provider: 'inpaint', error: e instanceof Error ? e.message : String(e) }, { status: 502 });
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

        // Feste 3×3-Geometrie: Kachel = echte Kartengröße 63×88 mm @ 300 dpi = 744×1039 px
        // → Gesamtbild 2232×3117, 9 exakt gleiche Kacheln (Ratio 63:88). Kein Bleed/Schnittmarken.
        // Mitte verzerrungsfrei (cover) — das Bild soll auch als GANZES Motiv (ohne Karte) taugen.
        // Rand intern in 4K generieren → genug Detail für den Druck.
        const tileW = 744, tileH = 1039;
        const s = await fetchImageBase64(imageUrl);
        const center = await sharp(Buffer.from(s.data, 'base64')).resize(tileW, tileH, { fit: 'cover' }).png().toBuffer();
        const CW = tileW * 3, CH = tileH * 3;
        // Rand-Vorlage: 'edge' = Kanten der Mitte herausziehen (extendWith:'copy') + verwischen
        // → gibt NB einen MASSSTABS-/Farb-Anker (statt grauem Nichts) → gleicher Maßstab beim
        // Fortführen. Sonst flaches Grau (altes Verhalten).
        let canvas: Buffer, fillPrompt: string;
        if (variant === 'edge') {
          const seed = await sharp(center)
            .extend({ left: tileW, right: tileW, top: tileH, bottom: tileH, extendWith: 'copy' })
            .blur(60).png().toBuffer();
          canvas = await sharp(seed).composite([{ input: center, left: tileW, top: tileH }]).png().toBuffer();
          fillPrompt = PROMPT_NB_FILL_EDGE;
        } else {
          // centerScale < 1: Karte kleiner mittig einsetzen (mehr Grau) → Modelle, die das
          // Motiv beim Füllen vergrößern (nano-banana-pro ~1,5×), landen so wieder ~auf 1/3.
          const cs = typeof centerScale === 'number' && centerScale > 0.2 && centerScale <= 1 ? centerScale : 1;
          const cw2 = Math.round(tileW * cs), ch2 = Math.round(tileH * cs);
          const centerS = cs === 1 ? center : await sharp(center).resize(cw2, ch2).png().toBuffer();
          const cx = Math.round((CW - cw2) / 2), cy = Math.round((CH - ch2) / 2);
          canvas = await sharp({ create: { width: CW, height: CH, channels: 3, background: { r: 127, g: 127, b: 127 } } })
            .composite([{ input: centerS, left: cx, top: cy }]).png().toBuffer();
          fillPrompt = PROMPT_NB_FILL;
        }

        const { url } = await genImageNanoBanana(model, fillPrompt, `data:image/png;base64,${canvas.toString('base64')}`, '4K');

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

    // ── SDXL-Outpainting (fermatresearch/sdxl-outpainting-lora): erweitert den Bildinhalt
    // richtungsweise (max 512 px/Seite), SDXL → kein Text-/Rahmen-Hang wie FLUX-Fill.
    // Testweise EIN Pass ~2.4×; `grow` (px je Seite) überschreibbar.
    if (provider === 'sdxlout') {
      const t0 = Date.now();
      try {
        // KARTE-IN-MITTE (3×3): Zentrum = Karte pixelgenau, ringsum SDXL-Outpaint,
        // exakt 3× in EINEM Pass (Center klein genug, dass grow ≤ 512/Seite reicht).
        const s = await fetchImageBase64(imageUrl);
        const buf0 = Buffer.from(s.data, 'base64');
        const TILE_W = 744, TILE_H = 1039;                 // Zielkachel 63:88 @ 300 dpi
        const centerHi = await sharp(buf0).resize(TILE_W, TILE_H, { fit: 'cover' }).png().toBuffer();
        // Kleine Center-Variante für SDXL: grow = Center-Maß (=3×), beide ≤ 512.
        const SC_H = 500, SC_W = Math.round(SC_H * TILE_W / TILE_H); // 358×500
        const small = await sharp(centerHi).resize(SC_W, SC_H, { fit: 'fill' }).png().toBuffer();
        const input = {
          image: `data:image/png;base64,${small.toString('base64')}`,
          prompt: 'Extend ONLY the empty surrounding environment and background outward — just more of the same ground, terrain, sky and scenery. One continuous empty landscape at the exact same scale, same art style, colors and lighting. Absolutely no living things.',
          negative_prompt: 'creature, animal, monster, character, pokemon, mascot, lizard, dragon, reptile, orange creature, dinosaur, figure, mascot in the background, duplicate character, second character, multiple characters, extra creature, another creature, cloned subject, repeated subject, two creatures, many creatures, copy of the subject, text, letters, words, title, caption, signature, watermark, logo, frame, border, picture frame, ornate frame, passepartout, vignette',
          outpaint_left: SC_W, outpaint_right: SC_W, outpaint_up: SC_H, outpaint_down: SC_H,
          guidance_scale: 8, condition_scale: 1, apply_watermark: false,
        };
        const { url } = await replicateRun('a542ccf352995f3c41f0bcfaef641daa3058bf2b00e08e04feb0295334ab9804', input);
        const outBuf = Buffer.from(await (await fetch(url)).arrayBuffer());
        // Auf exakte 2232×3117 skalieren (Ratio ist identisch → keine Verzerrung) …
        const CW = TILE_W * 3, CH = TILE_H * 3;
        let final = await sharp(outBuf).resize(CW, CH, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
        // … und die HOCHAUFLÖSENDE Karte scharf in die Mittelkachel setzen (kleine Feder).
        const f = 22;
        const centerA = await sharp(centerHi).removeAlpha().joinChannel(await featherAlpha(TILE_W, TILE_H, f)).png().toBuffer();
        final = await sharp(final).composite([{ input: centerA, left: TILE_W, top: TILE_H }]).png().toBuffer();
        return NextResponse.json({ provider: 'sdxlout', latencyMs: Date.now() - t0, image: `data:image/png;base64,${final.toString('base64')}` });
      } catch (e) {
        return NextResponse.json({ provider: 'sdxlout', error: e instanceof Error ? e.message : String(e) }, { status: 502 });
      }
    }

    // ── Bria Expand (bria/expand-image, offiziell, "Warm", $0.04/Bild): behält das
    // Originalbild an exakter Position/Größe und generiert NUR die neuen Pixel drumherum
    // → Karte bleibt pixelgenau in der Mitte. `maskKeep` (Zahl) = Zielskalierung (Default 3×).
    if (provider === 'bria') {
      const t0 = Date.now();
      try {
        // STEP-Modus: übergebenes Bild EINMAL auf ein festes aspect_ratio erweitern
        // (Bria behält Originalgröße, fügt echte Szene an). Für die stufenweise Kette.
        if (variant === 'step') {
          const ar = typeof aspectRatio === 'string' && aspectRatio ? aspectRatio : '1:1';
          const s2 = await fetchImageBase64(imageUrl);
          const inp = await sharp(Buffer.from(s2.data, 'base64')).metadata();
          const { url } = await replicateRun('bria/expand-image', {
            image: `data:image/png;base64,${Buffer.from(s2.data, 'base64').toString('base64')}`,
            aspect_ratio: ar,
            prompt: 'seamless continuation of the same illustrated scene, same art style, colours, lighting and time of day; extend only the surrounding sky and city, keep it one coherent scene',
            negative_prompt: 'frame, border, text, watermark, duplicate subject, second creature, extra bird, tiling',
            preserve_alpha: false,
          });
          return NextResponse.json({ provider: 'bria', step: true, ar, inSize: [inp.width, inp.height], latencyMs: Date.now() - t0, image: url });
        }
        const s = await fetchImageBase64(imageUrl);
        // Arbeits-Kachel klein halten (Bria-Canvas ≤ ~1400 lange Kante), danach hochskalieren.
        const wTile = 466, wTileW = Math.round(wTile * 744 / 1039); // 334×466 (63:88)
        const center = await sharp(Buffer.from(s.data, 'base64')).resize(wTileW, wTile, { fit: 'cover' }).png().toBuffer();
        const mult = typeof maskKeep === 'number' && maskKeep >= 1.2 ? maskKeep : 3;
        const CW = Math.round(wTileW * mult), CH = Math.round(wTile * mult);
        const ox = Math.round((CW - wTileW) / 2), oy = Math.round((CH - wTile) / 2);
        const input = {
          image: `data:image/png;base64,${center.toString('base64')}`,
          canvas_size: [CW, CH],
          original_image_size: [wTileW, wTile],
          original_image_location: [ox, oy],
          prompt: typeof variant === 'string' && variant ? variant : 'seamless continuation of the same illustrated scene, same art style, colours, lighting and time of day; extend the surroundings naturally',
          negative_prompt: 'frame, border, picture frame, text, letters, watermark, logo, signature, duplicate subject, second creature, tiling, seam',
          preserve_alpha: false,
        };
        const { url } = await replicateRun('bria/expand-image', input);
        if (variant === 'raw') {
          return NextResponse.json({ provider: 'bria', raw: true, canvas: [CW, CH], center: [wTileW, wTile], loc: [ox, oy], image: url });
        }
        // auf exakte Druckgröße 2232×3117 hochskalieren (Ratio identisch) …
        const outBuf = Buffer.from(await (await fetch(url)).arrayBuffer());
        const TILE_W = 744, TILE_H = 1039, GW = TILE_W * 3, GH = TILE_H * 3;
        let final = await sharp(outBuf).resize(GW, GH, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
        // … und die HOCHAUFLÖSENDE freigestellte Karte pixelgenau in die Mittelkachel setzen,
        // damit „in 9 splitten → Mitte = Karte" exakt stimmt (kleine Feder gegen Naht; Bria ist
        // von der Karte aus gewachsen → Umgebung passt an der Kante).
        const centerHi = await sharp(Buffer.from(s.data, 'base64')).resize(TILE_W, TILE_H, { fit: 'cover' }).png().toBuffer();
        const cardA = await sharp(centerHi).removeAlpha().joinChannel(await featherAlpha(TILE_W, TILE_H, 10)).png().toBuffer();
        final = await sharp(final).composite([{ input: cardA, left: TILE_W, top: TILE_H }]).png().toBuffer();
        return NextResponse.json({ provider: 'bria', canvas: [CW, CH], latencyMs: Date.now() - t0, image: `data:image/png;base64,${final.toString('base64')}` });
      } catch (e) {
        return NextResponse.json({ provider: 'bria', error: e instanceof Error ? e.message : String(e) }, { status: 502 });
      }
    }

    // ── EXTEND: ein VORHANDENES Bild pixelgenau behalten und nur den ÄUSSEREN Rand
    // erweitern (Himmel/Stadt ohne Motiv → sauber). factor via `centerScale` (Default 1.5).
    // Nutzt Kanten-Anker + Modell-Fill, danach Original pixelgenau (weiche Kante) wieder rein.
    if (provider === 'extend') {
      const t0 = Date.now();
      try {
        const s = await fetchImageBase64(imageUrl);
        const G = Buffer.from(s.data, 'base64');
        const md = await sharp(G).metadata();
        const w = md.width ?? 1000, h = md.height ?? 1000;
        const factor = typeof centerScale === 'number' && centerScale > 1 && centerScale <= 2.5 ? centerScale : 1.5;
        const CW = Math.round(w * factor), CH = Math.round(h * factor);
        const left = Math.round((CW - w) / 2), top = Math.round((CH - h) / 2);
        const seed = await sharp(G)
          .extend({ left, right: CW - w - left, top, bottom: CH - h - top, extendWith: 'copy' })
          .blur(Math.max(20, Math.round(Math.min(w, h) * 0.05))).toBuffer();
        const canvas = await sharp(seed).composite([{ input: G, left, top }]).png().toBuffer();
        const model = typeof cfModel === 'string' && cfModel ? cfModel : 'google/nano-banana-pro';
        const res = typeof imageSize === 'string' ? imageSize : '2K';
        const prompt = 'Extend ONLY the surrounding sky, clouds and city rooftops outward from the central image, as a natural continuation of the SAME scene, same art style, colours, lighting and time of day. Do NOT add any creatures, birds or characters; do not change the central image. One coherent wide scene, sharp to the edges.';
        const { url } = await genImageNanoBanana(model, prompt, `data:image/png;base64,${canvas.toString('base64')}`, res);
        let out = await sharp(Buffer.from(await (await fetch(url)).arrayBuffer())).resize(CW, CH, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
        if (variant !== 'nopaste') {
          // Original pixelgenau (weiche Kante) wieder einsetzen → G bleibt exakt (aber Naht möglich).
          const f = Math.max(8, Math.round(Math.min(w, h) * 0.05));
          const GA = await sharp(G).removeAlpha().joinChannel(await featherAlpha(w, h, f)).png().toBuffer();
          out = await sharp(out).composite([{ input: GA, left, top }]).png().toBuffer();
        }
        return NextResponse.json({ provider: 'extend', factor, dim: [CW, CH], latencyMs: Date.now() - t0, image: `data:image/png;base64,${out.toString('base64')}` });
      } catch (e) {
        return NextResponse.json({ provider: 'extend', error: e instanceof Error ? e.message : String(e) }, { status: 502 });
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
