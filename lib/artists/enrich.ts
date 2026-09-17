/**
 * Illustrator-Profil anreichern: PokéWiki (DE) + Bulbapedia (EN) holen und via
 * Gemini zu EINER sachlichen deutschen Übersicht + strukturierten Fakten
 * verschmelzen, dann in `artists/<slug>` cachen. Server-only (Gemini-Key +
 * firebase-admin).
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getStorage } from 'firebase-admin/storage';
import { getAdminDb } from '@/lib/firebase/admin';
import { fetchArtistSources } from './sources';
import { fetchIllustratorTitleIndex, resolveBulbaTitle } from './bulbapedia-index';
import { artistSlug } from './slug';
import { ARTISTS_COL, type ArtistProfile, type ArtistSourceRef } from '@/lib/firestore/artists';

const MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

/** Wiki-Fotos blocken Browser-Hotlinking (Referer) → das Portrait serverseitig
 *  laden und in unseren Storage kopieren (öffentlich lesbar, wie die Katalog-
 *  Bilder). Gibt unsere eigene URL zurück, oder null bei Fehlschlag. */
async function rehostPhoto(slug: string, photoUrl: string): Promise<string | null> {
  if (!BUCKET) return null;
  try {
    const res = await fetch(photoUrl, { headers: { 'User-Agent': 'pokedex-app/1.0 (private family use)' } });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? 'image/jpeg';
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
    const buf = Buffer.from(await res.arrayBuffer());
    const path = `artist-photos/${slug}.${ext}`;
    await getStorage().bucket(BUCKET).file(path).save(buf, {
      contentType: ct, resumable: false, predefinedAcl: 'publicRead',
      metadata: { cacheControl: 'public, max-age=31536000' },
    });
    return `https://storage.googleapis.com/${BUCKET}/${path}`;
  } catch { return null; }
}

interface GeminiOut {
  summaryDe?: string;
  birthDate?: string | null;
  nationality?: string | null;
  education?: string | null;
  occupation?: string | null;
  activeYears?: string | null;
  notableFacts?: string[];
}

function buildPrompt(name: string, pw: string, bp: string): string {
  return `Du erstellst eine deutschsprachige Kurzübersicht über den Pokémon-Sammelkarten-Illustrator "${name}" für eine private Sammlungs-App.

Es folgen zwei Quelltexte. Führe sie zu EINER sachlichen deutschen Übersicht zusammen (3–6 Sätze). Nutze AUSSCHLIESSLICH, was in den Texten steht — erfinde nichts, spekuliere nicht. Wenn sich Quellen ergänzen, kombiniere sie; bei Widerspruch bevorzuge die konkretere Angabe.

[Quelle 1 — PokéWiki (Deutsch)]
${pw || '(keine Angaben)'}

[Quelle 2 — Bulbapedia (Englisch)]
${bp || '(keine Angaben)'}

Extrahiere zusätzlich strukturierte Fakten NUR wenn sie in den Texten GENANNT sind (sonst null bzw. leer). ALLE Ausgaben auf DEUTSCH; das Geburtsdatum im deutschen Format "TT. Monat JJJJ" (z.B. "27. Januar 1966"), die Nationalität als deutsches Adjektiv (z.B. "japanisch"). Gib AUSSCHLIESSLICH JSON zurück:
{"summaryDe": string, "birthDate": string|null, "nationality": string|null, "education": string|null, "occupation": string|null, "activeYears": string|null, "notableFacts": string[]}`;
}

/** Reichert einen Illustrator an und schreibt das Profil. `null`, wenn zu beiden
 *  Quellen nichts gefunden wurde (dann kein Profil-Doc). */
export async function enrichArtist(name: string): Promise<ArtistProfile | null> {
  const index = await fetchIllustratorTitleIndex();
  const bulbaTitle = resolveBulbaTitle(index, name);
  const src = await fetchArtistSources(name, bulbaTitle);
  if (!src.pokewikiDe && !src.bulbapediaEn) return null;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const prompt = buildPrompt(name, src.pokewikiDe, src.bulbapediaEn);

  let out: GeminiOut | null = null;
  for (const model of MODELS) {
    try {
      const m = genAI.getGenerativeModel({ model, generationConfig: { responseMimeType: 'application/json' } });
      const r = await m.generateContent(prompt);
      out = JSON.parse(r.response.text());
      break;
    } catch { /* nächstes Modell */ }
  }
  if (!out?.summaryDe) return null;

  const sources: ArtistSourceRef[] = [];
  if (src.pokewikiUrl) sources.push({ name: 'PokéWiki', url: src.pokewikiUrl, license: 'CC BY-SA 3.0' });
  if (src.bulbapediaUrl) sources.push({ name: 'Bulbapedia', url: src.bulbapediaUrl, license: 'CC BY-NC-SA 2.5' });

  const slug = artistSlug(name);
  // Foto zu uns kopieren (Hotlinking blockiert); scheitert das, kein Foto (→ die
  // Profilseite zeigt dann ein Karten-Artwork als Fallback).
  const photoUrl = src.photoUrl ? await rehostPhoto(slug, src.photoUrl) : null;

  const profile: ArtistProfile = {
    slug,
    name,
    summaryDe: out.summaryDe.trim(),
    birthDate: out.birthDate ?? null,
    nationality: out.nationality ?? null,
    education: out.education ?? null,
    occupation: out.occupation ?? null,
    activeYears: out.activeYears ?? null,
    notableFacts: Array.isArray(out.notableFacts) ? out.notableFacts.slice(0, 8) : [],
    photoUrl,
    photoSource: photoUrl ? 'Bulbapedia' : null,
    sources,
    fetchedAt: new Date().toISOString(),
  };

  await getAdminDb().collection(ARTISTS_COL).doc(profile.slug).set(profile, { merge: true });
  return profile;
}
