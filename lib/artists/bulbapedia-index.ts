/**
 * Index der Bulbapedia-Illustrator-Seitentitel aus `Category:TCG illustrators`.
 * NÖTIG für korrekte Zuordnung: bei mehrdeutigen Namen heißt die Seite z.B.
 * „Rika (illustrator)" (der reine Name „Rika" führt auf eine andere Seite/
 * Begriffsklärung). Nur Titel aus dieser Kategorie sind verlässlich Illustratoren.
 *
 * Der Index wird pro Prozess gecacht (die Kategorie ändert sich selten).
 */

const BP_API = 'https://bulbapedia.bulbagarden.net/w/api.php';
const UA = 'pokedex-app/1.0 (private family use; wiki enrichment)';

const norm = (s: string) => s.toLowerCase().replace(/[.?!]/g, '').replace(/\s+/g, ' ').trim();

let cache: { at: number; map: Map<string, string> } | null = null;
const TTL_MS = 6 * 60 * 60 * 1000;

/** Map: normalisierter (Anzeige-)Name → exakter Bulbapedia-Seitentitel. */
export async function fetchIllustratorTitleIndex(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const map = new Map<string, string>();
  let cont: string | null = null;
  try {
    do {
      const u: string = `${BP_API}?action=query&format=json&list=categorymembers&cmtitle=${encodeURIComponent('Category:TCG illustrators')}&cmtype=page&cmnamespace=0&cmlimit=500${cont ? `&cmcontinue=${encodeURIComponent(cont)}` : ''}`;
      const r = await fetch(u, { headers: { 'User-Agent': UA } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const j: any = await r.json();
      for (const m of (j.query?.categorymembers ?? []) as { title: string }[]) {
        const title: string = m.title;
        const disp = norm(title.replace(/\s*\(.*\)$/, '')); // Klammerzusatz weg für den Anzeigenamen
        if (!map.has(disp)) map.set(disp, title);
        // Auch umgekehrte Wortreihenfolge (jap. „Nachname Vorname" ↔ „Vorname Nachname").
        const parts = disp.split(' ');
        if (parts.length === 2) {
          const rev = `${parts[1]} ${parts[0]}`;
          if (!map.has(rev)) map.set(rev, title);
        }
      }
      cont = j.continue?.cmcontinue ?? null;
    } while (cont);
  } catch { /* Netzfehler → so weit wie gekommen */ }
  cache = { at: Date.now(), map };
  return map;
}

/** Bulbapedia-Titel für einen Katalog-Künstlernamen: Kategorie-Treffer bevorzugt
 *  (löst Mehrdeutigkeiten wie „Rika (illustrator)"), sonst der Name selbst als
 *  Fallback — der ist in `sources.ts` durch einen Illustrator-Guard abgesichert,
 *  damit z.B. Film-/Firmenseiten nicht fälschlich einfließen. So werden auch
 *  echte (Contest-)Illustratoren erfasst, die NICHT in der Kategorie stehen. */
export function resolveBulbaTitle(index: Map<string, string>, name: string): string {
  return index.get(norm(name)) ?? name;
}
