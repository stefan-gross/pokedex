/**
 * Rohquellen für ein Illustrator-Profil: PokéWiki (DE-Intro) + Bulbapedia
 * (EN-Intro + Portraitfoto), beide über die jeweilige MediaWiki-API.
 *
 * PokéWiki hat KEINE TextExtracts-Extension (`prop=extracts` liefert leer) → wir
 * holen den Intro-Abschnitt via `action=parse&section=0` als HTML und strippen ihn.
 * Bulbapedia hat `extracts` + `pageimages` (Original-Lead-Bild = i.d.R. das Portrait).
 */

const UA = 'pokedex-app/1.0 (private family use; wiki enrichment)';

const PW_API = 'https://www.pokewiki.de/api.php';
const BP_API = 'https://bulbapedia.bulbagarden.net/w/api.php';
const PW_PAGE = (n: string) => `https://www.pokewiki.de/wiki/${encodeURIComponent(n.replace(/\s+/g, '_'))}`;
const BP_PAGE = (title: string) => `https://bulbapedia.bulbagarden.net/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;

/** Text nur übernehmen, wenn er plausibel einen Illustrator/Karten beschreibt —
 *  der reine Name kann sonst auf eine Charakter-/Film-/Firmen-/Begriffsklärungs-
 *  Seite führen (Bulbapedia-„Rika"-Problem bzw. „2017 Pikachu Project" = Film).
 *  Greift für DE (PokéWiki) UND EN (Bulbapedia-Fallback ohne Kategorie-Treffer). */
const looksLikeIllustrator = (t: string) =>
  /illustrat|sammelkart|zeichner|künstler|grafiker|designer|mangaka|artist|modeler|clay model/i.test(t);

export interface ArtistSources {
  pokewikiDe: string;
  pokewikiUrl: string | null;
  bulbapediaEn: string;
  bulbapediaUrl: string | null;
  photoUrl: string | null;
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    const t = await r.text();
    return t.startsWith('{') || t.startsWith('[') ? JSON.parse(t) : null;
  } catch { return null; }
}

/** Intro-HTML → grober Plaintext (Tags/Refs/Tabellen/Fußnoten raus). */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<sup[\s\S]*?<\/sup>/gi, '')
    .replace(/<table[\s\S]*?<\/table>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/&#\d+;|&[a-z]+;/gi, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function pokewikiIntro(name: string): Promise<string> {
  const j: any = await getJson(`${PW_API}?action=parse&format=json&redirects=1&prop=text&section=0&page=${encodeURIComponent(name)}`);
  if (!j || j.error) return '';
  const html = j.parse?.text?.['*'] ?? '';
  return htmlToText(html).slice(0, 2500);
}

async function bulbapedia(title: string): Promise<{ text: string; photo: string | null }> {
  const j: any = await getJson(`${BP_API}?action=query&format=json&redirects=1&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=original&titles=${encodeURIComponent(title)}`);
  const page: any = j?.query?.pages ? Object.values(j.query.pages)[0] : null;
  if (!page || page.missing !== undefined) return { text: '', photo: null };
  const text = (page.extract ?? '').trim().slice(0, 2500);
  // Guard: Nicht-Illustrator-Seiten (Film/Firma/Charakter) verwerfen — nötig, weil
  // der Titel bei fehlendem Kategorie-Treffer aus dem reinen Namen stammen kann.
  if (!looksLikeIllustrator(text)) return { text: '', photo: null };
  return { text, photo: page.original?.source ?? null };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * `bulbaTitle` = exakter Bulbapedia-Seitentitel aus der Illustrator-Kategorie
 * (siehe bulbapedia-index.ts). `null` = kein Illustrator-Eintrag → Bulbapedia
 * wird NICHT über den Namen geraten (das führte bei mehrdeutigen Namen wie
 * „Rika" auf die falsche Seite).
 */
export async function fetchArtistSources(name: string, bulbaTitle: string | null): Promise<ArtistSources> {
  const [pwRaw, bp] = await Promise.all([
    pokewikiIntro(name),
    bulbaTitle ? bulbapedia(bulbaTitle) : Promise.resolve({ text: '', photo: null }),
  ]);
  const pw = looksLikeIllustrator(pwRaw) ? pwRaw : '';
  return {
    pokewikiDe: pw,
    pokewikiUrl: pw ? PW_PAGE(name) : null,
    bulbapediaEn: bp.text,
    bulbapediaUrl: bp.text && bulbaTitle ? BP_PAGE(bulbaTitle) : null,
    photoUrl: bp.photo,
  };
}
