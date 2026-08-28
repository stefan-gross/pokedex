/**
 * Import/Export im Pokémon-TCG-Live-Format (PTCGL-Deckcode).
 *
 * Export ist rein (Rezept + Katalog-Map → Text). Import ist zweistufig:
 * `parsePtcglCode` (rein, nur Textzerlegung) + `resolvePtcglDeck` (async,
 * Katalog-Lookups). Auflösung: primär Set-Kürzel (`setCode`/ptcgoCode) + Nummer,
 * sonst Namenssuche als Fallback; nicht auflösbare Zeilen werden sichtbar
 * zurückgegeben (keine stille Unterschlagung).
 */
import { getCardBySetCodeAndNumber, type CatalogCard } from '../firestore/catalog';
import { searchCatalogCards } from '../search/catalog-search';
import type { DeckCardRef } from '@/types';

// PTCGL-Sektionsreihenfolge fürs Export-Gruppieren.
const SECTIONS: { key: string; label: string }[] = [
  { key: 'Pokémon', label: 'Pokémon' },
  { key: 'Trainer', label: 'Trainer' },
  { key: 'Energy',  label: 'Energy' },
];

/** Rezept → PTCGL-Deckcode. Nutzt den englischen Namen (PTCGL-kompatibel) +
 *  Set-Kürzel + Nummer aus dem Katalog; fehlt der Katalogeintrag, greift der
 *  denormalisierte Ref (dt. Name / setId) als Notnagel. */
export function deckToPtcglCode(cards: DeckCardRef[], byId: Map<string, CatalogCard>): string {
  const lineFor = (ref: DeckCardRef): { supertype: string; line: string } => {
    const c = byId.get(ref.catalogId);
    const name = c?.name ?? ref.name;
    const code = c?.setCode ?? '';
    const number = c?.number ?? ref.number;
    const supertype = c?.supertype ?? ref.supertype ?? 'Pokémon';
    const line = code
      ? `${ref.count} ${name} ${code} ${number}`
      : `${ref.count} ${name} ${number}`;
    return { supertype, line };
  };

  const bySection = new Map<string, string[]>();
  const counts = new Map<string, number>();
  for (const ref of cards) {
    const { supertype, line } = lineFor(ref);
    const sec = supertype === 'Trainer' ? 'Trainer' : supertype === 'Energy' ? 'Energy' : 'Pokémon';
    (bySection.get(sec) ?? bySection.set(sec, []).get(sec)!).push(line);
    counts.set(sec, (counts.get(sec) ?? 0) + ref.count);
  }

  const out: string[] = [];
  for (const s of SECTIONS) {
    const lines = bySection.get(s.key);
    if (!lines?.length) continue;
    out.push(`${s.label}: ${counts.get(s.key) ?? 0}`);
    out.push(...lines);
    out.push('');
  }
  const total = cards.reduce((sum, c) => sum + c.count, 0);
  out.push(`Total Cards: ${total}`);
  return out.join('\n');
}

export interface ParsedPtcglLine {
  raw: string;
  count: number;
  name: string;
  setCode?: string;
  number?: string;
}

// „4 Charizard ex PAF 54" / „4 Charizard ex PAF 054" — Name (greedy bis Code),
// Set-Kürzel (Großbuchstaben/Ziffern), Nummer (Ziffern + optional Buchstabe).
const LINE_WITH_CODE = /^(\d+)\s+(.+?)\s+([A-Z][A-Z0-9-]{1,6})\s+(\d+[A-Za-z]?)$/;
// „9 Fire Energy 2" — Name + Nummer ohne Set-Kürzel.
const LINE_NAME_NUMBER = /^(\d+)\s+(.+?)\s+(\d+[A-Za-z]?)$/;
// „9 Fire Energy" — nur Name (z.B. Basis-Energie in alten Exporten).
const LINE_NAME_ONLY = /^(\d+)\s+(.+?)$/;

/** Zerlegt einen PTCGL-Deckcode in Zeilen (rein, kein I/O). Header-/Leerzeilen
 *  werden übersprungen. */
export function parsePtcglCode(text: string): ParsedPtcglLine[] {
  const out: ParsedPtcglLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Sektions-/Total-Header überspringen ("Pokémon: 6", "Trainer: 30", …).
    if (/^(Pok[eé]mon|Trainer|Energy|Energie|Total Cards|Total)\s*:/i.test(line)) continue;

    let m = LINE_WITH_CODE.exec(line);
    if (m) { out.push({ raw: line, count: +m[1], name: m[2].trim(), setCode: m[3], number: m[4] }); continue; }
    m = LINE_NAME_NUMBER.exec(line);
    if (m) { out.push({ raw: line, count: +m[1], name: m[2].trim(), number: m[3] }); continue; }
    m = LINE_NAME_ONLY.exec(line);
    if (m) { out.push({ raw: line, count: +m[1], name: m[2].trim() }); continue; }
    out.push({ raw: line, count: 0, name: line });   // unparsebar → unaufgelöst
  }
  return out;
}

/** Nummer-Varianten für den Set+Nummer-Lookup (mit/ohne führende Nullen). */
function numberVariants(n: string): string[] {
  const set = new Set<string>([n]);
  const digits = n.replace(/[A-Za-z]$/, '');
  const suffix = n.slice(digits.length);
  const stripped = String(parseInt(digits, 10));
  if (!Number.isNaN(+stripped)) {
    set.add(stripped + suffix);
    set.add(stripped.padStart(3, '0') + suffix);
  }
  return [...set];
}

export interface ResolvedPtcglCard { card: CatalogCard; count: number; }
export interface UnresolvedPtcglLine { raw: string; count: number; name: string; reason: string; }
export interface PtcglResolveResult {
  resolved: ResolvedPtcglCard[];
  unresolved: UnresolvedPtcglLine[];
}

async function resolveOne(l: ParsedPtcglLine): Promise<CatalogCard | null> {
  // 1. Set-Kürzel + Nummer (zuverlässigster Weg).
  if (l.setCode && l.number) {
    for (const num of numberVariants(l.number)) {
      const hit = await getCardBySetCodeAndNumber(l.setCode, num);
      if (hit) return hit;
    }
  }
  // 2. Namenssuche als Fallback. Exakter Namenstreffer (EN oder DE) bevorzugt;
  //    bei mehreren Drucken der mit passendem Set-Kürzel, sonst der erste.
  const { cards } = await searchCatalogCards(l.name, { displayLimit: 12 });
  if (cards.length === 0) return null;
  const key = l.name.toLowerCase();
  const exact = cards.filter(c => c.name.toLowerCase() === key || c.nameDe?.toLowerCase() === key);
  const pool = exact.length ? exact : cards;
  if (l.setCode) {
    const bySet = pool.find(c => c.setCode === l.setCode);
    if (bySet) return bySet;
  }
  return pool[0];
}

/** Löst einen PTCGL-Deckcode gegen den Katalog auf. Aggregiert nach catalogId
 *  (mehrere Zeilen derselben Karte summieren); nicht auflösbare Zeilen kommen
 *  sichtbar in `unresolved`. */
export async function resolvePtcglDeck(text: string): Promise<PtcglResolveResult> {
  const parsed = parsePtcglCode(text);
  const byId = new Map<string, ResolvedPtcglCard>();
  const unresolved: UnresolvedPtcglLine[] = [];

  for (const l of parsed) {
    if (l.count <= 0) { unresolved.push({ raw: l.raw, count: l.count, name: l.name, reason: 'nicht lesbar' }); continue; }
    let card: CatalogCard | null = null;
    try { card = await resolveOne(l); }
    catch (e) { console.error('[ptcgl] resolve error', l.raw, e); }
    if (!card) { unresolved.push({ raw: l.raw, count: l.count, name: l.name, reason: 'nicht im Katalog gefunden' }); continue; }
    const ex = byId.get(card.id);
    if (ex) ex.count += l.count;
    else byId.set(card.id, { card, count: l.count });
  }

  return { resolved: [...byId.values()], unresolved };
}
