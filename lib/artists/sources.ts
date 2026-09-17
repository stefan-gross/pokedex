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
const BP_PAGE = (n: string) => `https://bulbapedia.bulbagarden.net/wiki/${encodeURIComponent(n.replace(/\s+/g, '_'))}`;

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

async function bulbapedia(name: string): Promise<{ text: string; photo: string | null }> {
  const j: any = await getJson(`${BP_API}?action=query&format=json&redirects=1&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=original&titles=${encodeURIComponent(name)}`);
  const page: any = j?.query?.pages ? Object.values(j.query.pages)[0] : null;
  if (!page || page.missing !== undefined) return { text: '', photo: null };
  return { text: (page.extract ?? '').trim().slice(0, 2500), photo: page.original?.source ?? null };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function fetchArtistSources(name: string): Promise<ArtistSources> {
  const [pw, bp] = await Promise.all([pokewikiIntro(name), bulbapedia(name)]);
  return {
    pokewikiDe: pw,
    pokewikiUrl: pw ? PW_PAGE(name) : null,
    bulbapediaEn: bp.text,
    bulbapediaUrl: bp.text ? BP_PAGE(name) : null,
    photoUrl: bp.photo,
  };
}
