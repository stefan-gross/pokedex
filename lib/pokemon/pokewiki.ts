/**
 * Deutscher Fließtext (Intro) einer Pokémon-Art von **PokéWiki** (CC BY-SA 3.0).
 * PokéWiki hat keine TextExtracts-Extension → wir holen Abschnitt 0 als HTML
 * (`action=parse&section=0&prop=text`) und strippen ihn zu Plaintext.
 *
 * Nur serverseitig nutzen (die Detailseite ruft `/api/pokemon/[dex]/wiki`) —
 * PokéWiki sendet keine CORS-Header für den Browser.
 */

const UA = 'pokedex-app/1.0 (private family use; wiki enrichment)';
const PW_API = 'https://www.pokewiki.de/api.php';
const PW_PAGE = (n: string) => `https://www.pokewiki.de/wiki/${encodeURIComponent(n.replace(/\s+/g, '_'))}`;

/** Entities grob dekodieren (nur die häufigen; Rest → Leerzeichen). */
function decode(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/gi, ' ');
}

/**
 * Nur die **Prosa-Absätze** (`<p>`) aus dem geparsten Section-0-HTML — so bleiben
 * Infobox (Typen/Dex-Nummern/Fangrate …) und Navigations-Templates außen vor, die
 * PokéWiki sonst mit in Abschnitt 0 rendert. Kurze/leere Absätze werden verworfen.
 */
function extractParagraphs(html: string): string {
  const paras: string[] = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = decode(
      m[1]
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<sup[\s\S]*?<\/sup>/gi, '')
        .replace(/<[^>]+>/g, ''),
    )
      .replace(/\[\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 40) paras.push(text);
  }
  return paras.join('\n\n').trim();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface PokewikiIntro { text: string; url: string; }

/** Deutscher Intro-Fließtext zu `name` (dt. PokéWiki-Seitentitel). `null` bei Fehler/leer. */
export async function fetchPokewikiIntro(name: string): Promise<PokewikiIntro | null> {
  try {
    const r = await fetch(
      `${PW_API}?action=parse&format=json&redirects=1&prop=text&section=0&page=${encodeURIComponent(name)}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(7000) },
    );
    const raw = await r.text();
    const j: any = raw.startsWith('{') ? JSON.parse(raw) : null;
    if (!j || j.error) return null;
    const html = j.parse?.text?.['*'] ?? '';
    const text = extractParagraphs(html).slice(0, 2200).trim();
    if (text.length < 40) return null;
    return { text, url: PW_PAGE(name) };
  } catch { return null; }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
