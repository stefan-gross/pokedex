/**
 * Client-seitiger Suggest-Index (Autosuggest + Fuzzy-Korrektur). Lädt EINMAL das
 * Doc `meta/suggest_index` direkt via Client-SDK (öffentliche Read-Rule), cacht
 * in Memory + localStorage (TTL 7 Tage). Alle Vorschläge/Fuzzy laufen danach
 * rein lokal — keine Firestore-Reads pro Tastendruck.
 */
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { SuggestIndex } from '@/lib/build-search-index';

const LS_KEY = 'pokedex.suggest_index.v1';
const TTL = 7 * 24 * 60 * 60 * 1000;

let cache: SuggestIndex | null = null;
let inflight: Promise<SuggestIndex | null> | null = null;

async function fetchIndex(): Promise<SuggestIndex | null> {
  try {
    // Direkt aus Firestore (öffentliche Read-Rule für meta/) — funktioniert auch
    // in Produktion, wo dem Admin-SDK die Env-Vars fehlen.
    const snap = await getDoc(doc(db, 'meta', 'suggest_index'));
    if (!snap.exists()) return null;
    const data = snap.data() as SuggestIndex;
    if (!data?.names?.length) return null;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ ...data, _cachedAt: Date.now() })); } catch { /* quota */ }
    return data;
  } catch { return null; }
}

/** Lädt den Index (Memory → localStorage → Netz). Idempotent/dedupliziert. */
export async function loadSuggestIndex(): Promise<SuggestIndex | null> {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as SuggestIndex & { _cachedAt?: number };
      if (p?.names?.length && Date.now() - (p._cachedAt ?? 0) < TTL) { cache = p; return cache; }
    }
  } catch { /* ignore */ }
  if (!inflight) inflight = fetchIndex();
  cache = await inflight;
  inflight = null;
  return cache;
}

export interface Suggestion { value: string; kind: 'name' | 'artist' | 'set'; }

/** Vorschläge zur (Teil-)Eingabe: Präfix zuerst, dann Substring. Namen > Sets >
 *  Illustratoren gewichtet. Rein lokal. */
/** Reduziert einen Kartennamen auf den Basis-Pokémon-Namen: Mega-Präfix und
 *  Sonderform-Suffixe (ex/V/VMAX/VSTAR/GX/BREAK) sowie ☆/δ-Marker entfernen.
 *  „Glurak ex" / „Glurak V" / „Mega-Glurak" / „Glurak ☆ δ" → „Glurak". */
export function baseName(name: string): string {
  let n = name.trim();
  n = n.replace(/^(mega|m)[\s-]+/i, '');                       // Mega-/M-Präfix
  n = n.replace(/[\s-]+(vmax|vstar|ex|gx|break|v)$/i, '');     // Sonderform-Suffix
  n = n.replace(/\s*[☆★δΔ]+/g, ' ').replace(/\s{2,}/g, ' ').trim(); // Shiny-/Delta-Marker
  return n || name.trim();
}

// Deduplizierte Basis-Namen je Index (gecacht — index.names ist nach dem Laden stabil).
const baseNamesCache = new WeakMap<string[], string[]>();
function dedupeBaseNames(names: string[]): string[] {
  const cached = baseNamesCache.get(names);
  if (cached) return cached;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const b = baseName(n);
    const key = b.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  baseNamesCache.set(names, out);
  return out;
}

export function suggest(index: SuggestIndex | null, q: string, limit = 8): Suggestion[] {
  if (!index) return [];
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  // Namensvorschläge auf Basis-Pokémon reduzieren (Varianten zusammenfassen).
  const baseNames = dedupeBaseNames(index.names);
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (value: string, kind: Suggestion['kind']) => {
    const key = kind + ':' + value.toLowerCase();
    if (seen.has(key)) return; seen.add(key);
    out.push({ value, kind });
  };
  // Ranking: Präfix-Treffer vor Substring; Namen zuerst.
  const rank = (arr: string[], kind: Suggestion['kind']) => {
    const pref: string[] = [], sub: string[] = [];
    for (const v of arr) {
      const lv = v.toLowerCase();
      if (lv.startsWith(s)) pref.push(v);
      else if (lv.includes(s)) sub.push(v);
    }
    return [...pref, ...sub].slice(0, limit).map(v => [v, kind] as const);
  };
  const ranked = [
    ...rank(baseNames, 'name'),
    ...rank(index.sets.map(x => x.name), 'set'),
    ...rank(index.artists, 'artist'),
  ];
  for (const [v, k] of ranked) { if (out.length >= limit) break; push(v, k); }

  // Tippfehler-Toleranz: wenn wenige exakte Treffer, das erste Suchwort per
  // Edit-Distanz gegen die TOKEN der Kandidaten prüfen — so schlägt „Yoka" auch
  // „Yuka Morii" vor (Token „yuka" ist 1 Tippfehler entfernt).
  if (out.length < limit) {
    const key = s.split(/\s+/).filter(Boolean)[0] ?? s;
    if (key.length >= 3) {
      const maxD = Math.max(1, Math.floor(key.length / 4));
      const fuzzyHit = (value: string) =>
        value.toLowerCase().split(/\s+/).some(tok => Math.abs(tok.length - key.length) <= maxD && levBounded(key, tok, maxD) <= maxD);
      const fuzzyPass = (arr: string[], kind: Suggestion['kind']) => {
        for (const v of arr) {
          if (out.length >= limit) break;
          if (v.toLowerCase().includes(s)) continue;   // schon exakt drin
          if (fuzzyHit(v)) push(v, kind);
        }
      };
      fuzzyPass(baseNames, 'name');
      fuzzyPass(index.artists, 'artist');
      fuzzyPass(index.sets.map(x => x.name), 'set');
    }
  }
  return out.slice(0, limit);
}

/** Levenshtein-Distanz mit früher Obergrenze (Abbruch, sobald > max). */
function levBounded(a: string, b: string, max: number): number {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1);
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[lb];
}

/** Fuzzy-Korrektur für 0-Treffer: findet den nächsten Namen/Illustrator zur
 *  (ggf. mehrteiligen) Eingabe. Toleranz ~1 Tippfehler je 5 Zeichen. Gibt den
 *  korrigierten Suchstring zurück oder null. */
export function correctQuery(index: SuggestIndex | null, q: string): string | null {
  if (!index) return null;
  const raw = q.trim();
  if (raw.length < 3) return null;
  const s = raw.toLowerCase();
  const maxDist = Math.max(1, Math.floor(raw.length / 5));

  // Holder-Objekt statt `let` — sonst narrowt TS die Closure-Zuweisung zu `null`.
  const r: { best: string | null; dist: number } = { best: null, dist: maxDist + 1 };
  const consider = (candidate: string) => {
    const d = levBounded(s, candidate.toLowerCase(), maxDist);
    if (d <= maxDist && d < r.dist) { r.dist = d; r.best = candidate; }
  };
  // Volltext-Kandidaten (Illustratoren sind oft mehrteilig, z.B. „Yuka Morii").
  for (const a of index.artists) consider(a);
  for (const n of index.names) if (Math.abs(n.length - raw.length) <= maxDist) consider(n);
  return r.best && r.best.toLowerCase() !== s ? r.best : null;
}
