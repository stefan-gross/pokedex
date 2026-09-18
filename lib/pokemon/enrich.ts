/**
 * Pokémon-Profil anreichern: PokéWiki-Rohtexte (Hauptseite + „(Sammelkartenspiel)")
 * via Gemini zu (a) einem allgemeinen deutschen Text und (b) einer TCG-Zusammen-
 * fassung verdichten, dann in `pokemon/<dex>` cachen. Server-only (Gemini-Key +
 * firebase-admin).
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getAdminDb } from '@/lib/firebase/admin';
import { fetchPokewikiRaw, type PokewikiRaw } from './pokewiki';
import { POKEMON_COL, type PokemonProfile, type PokemonSourceRef, type SpeziesTopic } from '@/lib/firestore/pokemon';

// Primär das neuere, günstige Flash-Lite (bessere Relevanz-Auswahl, wenig
// Thinking-Overhead); Fallback auf das stabile 2.5-Flash-Lite.
const MODELS = ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite'];

interface GeminiOut {
  general?: string;
  spezies?: { heading?: string; text?: string }[];
  tcg?: string | null;
}

// Diese Spezies-Kapitel fließen in den ALLGEMEINEN Text (als Absätze) ein und
// erscheinen NICHT mehr im Akkordeon. Der Rest bleibt Akkordeon-Thema.
const GENERAL_SRC = /aussehen|körperbau|verhalten|lebensraum|herkunft|namens/i;

function buildPrompt(name: string, raw: PokewikiRaw): string {
  const genSrc = raw.spezies.filter(s => GENERAL_SRC.test(s.heading));
  const rest = raw.spezies.filter(s => !GENERAL_SRC.test(s.heading));
  const block = (list: { heading: string; text: string }[]) =>
    list.length ? list.map(s => `### ${s.heading}\n${s.text}`).join('\n\n') : '(keine Angaben)';
  return `Du bist Redakteur für eine private Pokémon-Sammlungs-App und verdichtest PokéWiki-Texte zu prägnantem, sachlichem Deutsch.

GRUNDREGELN:
- Nutze AUSSCHLIESSLICH die Quelltexte unten. Erfinde nichts, spekuliere nicht, keine Wertungen, keine Anrede an den Leser.
- RELEVANZ-Auswahl statt bloßer Kürzung: nur das Wesentliche/Charakteristische. LASSE WEG: Selbstverständliches, exakte Finger-/Zehenzahl, jede Farbschattierung, reine Spielmechanik-Werte, Verweise/Meta-Angaben.
- Ganze, flüssige Sätze.

Erzeuge DREI Teile:
1. "general": ein zusammenhängender allgemeiner Text zu ${name}, 8–12 Sätze, in MEHREREN ABSÄTZEN (durch \\n\\n getrennt): zuerst ein Überblicks-Absatz aus [Quelle A] (Identität, Typ, Rolle/Entwicklung, Status/Bekanntheit); danach je EIN eigener Absatz aus den vorhandenen Kapiteln in [Quelle B] (Aussehen/Körperbau, Verhalten/Lebensraum, Herkunft/Namensbedeutung). Nur vorhandene Kapitel; keine Zwischenüberschriften.
2. "spezies": pro Kapitel in [Quelle C] EIN Objekt mit dem UNVERÄNDERTEN "heading" (Text nach „### ", ohne Präfix) und einer relevanzbasierten Zusammenfassung als "text" (2–3 Sätze). Reihenfolge beibehalten; Unwichtiges weglassen.
3. "tcg": das Wesentliche zum Sammelkartenspiel aus [Quelle D] (Rolle/Bekanntheit, ikonische Karten, besondere Kartentypen/Formen). Keine Auflistung jeder Einzelkarte. Nichts Brauchbares → null.

[Quelle A — Einleitung der PokéWiki-Hauptseite]
${raw.intro || '(keine Angaben)'}

[Quelle B — Kapitel für den allgemeinen Text]
${block(genSrc)}

[Quelle C — übrige Spezies-Kapitel (Akkordeon)]
${block(rest)}

[Quelle D — „Im Sammelkartenspiel"]
${raw.tcg || '(keine Angaben)'}

Gib AUSSCHLIESSLICH JSON zurück:
{"general": string, "spezies": [{"heading": string, "text": string}], "tcg": string|null}`;
}

/** Reichert ein Pokémon an und schreibt `pokemon/<dex>`. `null`, wenn PokéWiki
 *  keine brauchbaren Rohtexte liefert. */
export async function enrichPokemon(dex: number, name: string): Promise<PokemonProfile | null> {
  const raw = await fetchPokewikiRaw(name);
  if (!raw) return null;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const prompt = buildPrompt(name, raw);

  let out: GeminiOut | null = null;
  for (const model of MODELS) {
    try {
      const m = genAI.getGenerativeModel({ model, generationConfig: { responseMimeType: 'application/json' } });
      const r = await m.generateContent(prompt);
      out = JSON.parse(r.response.text());
      break;
    } catch { /* nächstes Modell */ }
  }
  if (!out?.general) return null;

  const spezies: SpeziesTopic[] = Array.isArray(out.spezies)
    ? out.spezies
        .map(s => ({
          // Sicherung: ein evtl. mitgeschlepptes „Unterthema N:"/„###"-Präfix entfernen.
          heading: String(s.heading ?? '').replace(/^#+\s*/, '').replace(/^Unterthema\s*\d+:\s*/i, '').trim(),
          text: String(s.text ?? '').trim(),
        }))
        .filter(s => s.heading && s.text)
    : [];

  const sources: PokemonSourceRef[] = [{ name: 'PokéWiki', url: raw.url, license: 'CC BY-SA 3.0' }];
  if (raw.tcgUrl) sources.push({ name: 'PokéWiki (Sammelkartenspiel)', url: raw.tcgUrl, license: 'CC BY-SA 3.0' });

  const profile: PokemonProfile = {
    dex,
    name,
    general: out.general.trim(),
    spezies,
    tcg: out.tcg ? String(out.tcg).trim() : null,
    sources,
    fetchedAt: new Date().toISOString(),
  };

  await getAdminDb().collection(POKEMON_COL).doc(String(dex)).set(profile, { merge: true });
  return profile;
}
