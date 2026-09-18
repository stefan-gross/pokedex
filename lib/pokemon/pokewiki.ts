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

// Tabellen-/Meta-Abschnitte, die keine Prosa sind.
const SKIP_HEADINGS = /weblinks|einzelnachweise|quellen|hauptartikel/i;

/** Überschriftstext aus einem Abschnitts-Chunk (mw-headline) — Edit-Links raus. */
function headingText(chunk: string, closeTag = '</h2>'): string {
  const end = chunk.indexOf(closeTag);
  const head = end >= 0 ? chunk.slice(0, end) : '';
  return decode(head.replace(/<[^>]+>/g, ''))
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Body EINES h2-Abschnitts (nach `</h2>`, bis zum nächsten h2) — '' wenn keiner passt. */
function h2Body(html: string, match: RegExp): string {
  const parts = html.split(/<h2\b[^>]*>/i);
  for (let i = 1; i < parts.length; i++) {
    if (!match.test(headingText(parts[i]))) continue;
    const b = parts[i].indexOf('</h2>');
    return b >= 0 ? parts[i].slice(b + 5) : parts[i];
  }
  return '';
}

/** Einen Abschnitts-Body nach h3-Unterüberschriften in {heading, text} zerlegen. */
function splitByH3(body: string, cap: number): { heading: string; text: string }[] {
  const parts = body.split(/<h3\b[^>]*>/i);
  const subs: { heading: string; text: string }[] = [];
  for (let i = 1; i < parts.length; i++) {
    const heading = headingText(parts[i], '</h3>');
    const b = parts[i].indexOf('</h3>');
    const t = extractParagraphs(b >= 0 ? parts[i].slice(b + 5) : parts[i]);
    if (heading && !SKIP_HEADINGS.test(heading) && t.length >= 30) subs.push({ heading, text: t.slice(0, cap) });
  }
  return subs;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function pageHtml(title: string): Promise<string | null> {
  try {
    const r = await fetch(
      `${PW_API}?action=parse&format=json&redirects=1&prop=text&page=${encodeURIComponent(title)}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) },
    );
    const raw = await r.text();
    const j: any = raw.startsWith('{') ? JSON.parse(raw) : null;
    if (!j || j.error) return null;
    return j.parse?.text?.['*'] ?? null;
  } catch { return null; }
}

/** Intro + (optional gefilterte) Abschnitte einer Seite als Rohtext (mit
 *  Überschriften), gedeckelt. `filter` wählt die zu übernehmenden Abschnitte. */
function collectProse(html: string, filter: (heading: string) => boolean, cap: number): string {
  const parts = html.split(/<h2\b[^>]*>/i);
  let out = extractParagraphs(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    const heading = headingText(parts[i]);
    if (!heading || SKIP_HEADINGS.test(heading) || !filter(heading)) continue;
    const bodyStart = parts[i].indexOf('</h2>');
    const body = bodyStart >= 0 ? parts[i].slice(bodyStart + 5) : parts[i];
    const t = extractParagraphs(body);
    if (t.length >= 40) out += `\n\n## ${heading}\n${t}`;
  }
  return out.slice(0, cap).trim();
}

/** Prosa EINES benannten Abschnitts (nach der passenden `<h2>`-Überschrift). */
function extractSection(html: string, match: RegExp, cap: number): string {
  const parts = html.split(/<h2\b[^>]*>/i);
  for (let i = 1; i < parts.length; i++) {
    if (!match.test(headingText(parts[i]))) continue;
    const bodyStart = parts[i].indexOf('</h2>');
    const body = bodyStart >= 0 ? parts[i].slice(bodyStart + 5) : parts[i];
    return extractParagraphs(body).slice(0, cap).trim();
  }
  return '';
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface PokewikiRaw {
  intro: string;                                   // Intro-Absatz der Hauptseite → „Allgemeiner Text"
  spezies: { heading: string; text: string }[];    // h3-Unterthemen des „Spezies"-Abschnitts
  tcg: string;                                     // „Im Sammelkartenspiel" (+ ggf. Unterseite)
  url: string;
  tcgUrl: string | null;
}

/**
 * Rohtexte für die Zusammenfassung holen, dreigeteilt:
 *  - `intro`: der einleitende Absatz der Hauptseite (allgemeiner Überblick),
 *  - `spezies`: die h3-Unterthemen des „Spezies"-Abschnitts (Aussehen, Verhalten,
 *    Herkunft/Namensbedeutung …), je mit Überschrift,
 *  - `tcg`: der Abschnitt „Im Sammelkartenspiel" (+ optional die Unterseite).
 * `null`, wenn die Hauptseite fehlt oder gar keinen Prosatext hat.
 */
export async function fetchPokewikiRaw(name: string): Promise<PokewikiRaw | null> {
  const mainHtml = await pageHtml(name);
  if (!mainHtml) return null;

  // Intro = Prosa vor der ersten h2-Überschrift.
  const intro = extractParagraphs(mainHtml.split(/<h2\b[^>]*>/i)[0]).slice(0, 3000).trim();

  // Spezies-Abschnitt (h2) → h3-Unterthemen. Falls flach (keine h3), ein Sammel-
  // Eintrag „Spezies".
  const speziesBody = h2Body(mainHtml, /^spezies/i);
  let spezies = splitByH3(speziesBody, 2800);
  if (!spezies.length && speziesBody) {
    const flat = extractParagraphs(speziesBody).slice(0, 2800).trim();
    if (flat.length >= 40) spezies = [{ heading: 'Spezies', text: flat }];
  }

  if (intro.length < 40 && spezies.length === 0) return null;

  // TCG-Quelle 1: der Abschnitt „Im Sammelkartenspiel" auf der HAUPTSEITE (immer
  // der richtige Ort, auch wenn es keine separate Seite gibt).
  const section = extractSection(mainHtml, /sammelkartenspiel/i, 4000);

  // TCG-Quelle 2 (optional, für mehr Detail): separate Seite „(TCG)" bzw.
  // „(Sammelkartenspiel)".
  let subPage = '', tcgUrl: string | null = null;
  for (const suffix of ['(TCG)', '(Sammelkartenspiel)']) {
    const tcgTitle = `${name} ${suffix}`;
    const tcgHtml = await pageHtml(tcgTitle);
    if (tcgHtml) {
      const t = collectProse(tcgHtml, () => true, 5000);
      if (t.length >= 40) { subPage = t; tcgUrl = PW_PAGE(tcgTitle); break; }
    }
  }

  const tcg = [section, subPage].filter(Boolean).join('\n\n').slice(0, 6000).trim();
  // Link: separate Seite bevorzugt, sonst der Abschnitt-Anker der Hauptseite.
  const tcgLink = tcgUrl ?? (tcg ? `${PW_PAGE(name)}#Im_Sammelkartenspiel` : null);

  return { intro, spezies, tcg, url: PW_PAGE(name), tcgUrl: tcgLink };
}
