/**
 * Angereichertes Pokémon-Profil (`pokemon`-Collection): allgemeiner deutscher Text
 * + TCG-Zusammenfassung, von Gemini aus PokéWiki (Hauptseite + „(Sammelkartenspiel)")
 * zusammengesetzt und gecacht. Reiner Typ + Konstante (client-sicher — KEIN
 * firebase-admin-Import hier).
 */

export const POKEMON_COL = 'pokemon';

export interface PokemonSourceRef {
  name: string;    // z.B. "PokéWiki"
  url: string;
  license: string; // z.B. "CC BY-SA 3.0"
}

export interface SpeziesTopic {
  heading: string;          // Unterthema (z.B. „Aussehen und Körperbau")
  text: string;             // KI-Zusammenfassung dieses Unterthemas
}

export interface PokemonProfile {
  dex: number;
  name: string;
  general: string;              // allgemeiner Text (Gemini, aus dem Intro)
  spezies: SpeziesTopic[];      // Spezies-Unterthemen, je zusammengefasst (Gemini)
  tcg: string | null;           // Zusammenfassung zum Sammelkartenspiel (Gemini), sofern vorhanden
  sources: PokemonSourceRef[];
  fetchedAt: string;            // ISO
}
