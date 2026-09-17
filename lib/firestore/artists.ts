/**
 * Illustrator-Profile (`artists`-Collection) — aus PokéWiki (DE) + Bulbapedia (EN)
 * per Gemini zu einer deutschen Übersicht verschmolzen, plus optionalem Foto und
 * strukturierten Fakten. Wird per Admin-Route (`/api/admin/artists-enrich`) befüllt
 * und gecacht; die App liest read-only. Reiner Typ + Konstanten (client-sicher —
 * KEIN firebase-admin-Import hier).
 */

export const ARTISTS_COL = 'artists';

/** Quelle eines übernommenen Inhalts (für sichtbare Namensnennung + Lizenz). */
export interface ArtistSourceRef {
  name: string;    // z.B. "PokéWiki" / "Bulbapedia"
  url: string;     // Artikel-URL
  license: string; // z.B. "CC BY-SA 3.0" / "CC BY-NC-SA 2.5"
}

export interface ArtistProfile {
  slug: string;               // Doc-ID (URL-sicher)
  name: string;               // Klartext-Illustratorname (= Katalog-`artist`)
  summaryDe: string;          // deutsche Übersicht (Gemini, aus beiden Quellen)
  birthDate?: string | null;
  nationality?: string | null;
  education?: string | null;
  occupation?: string | null;
  activeYears?: string | null;
  notableFacts?: string[];
  photoUrl?: string | null;   // Portrait (i.d.R. Bulbapedia); optional
  photoSource?: string | null;
  sources: ArtistSourceRef[]; // für Namensnennung/Lizenz
  fetchedAt: string;          // ISO — wann zuletzt angereichert
}
