import type { CatalogCard } from '@/lib/firestore/catalog';

/**
 * Zentrale, wiederverwendbare Karten-Auflösung für den Scanner (und später den
 * Hinzufügen-Drawer). Bildet eine EXPLIZITE, priorisierte Regel-Leiter ab: mit
 * welchen von Gemini gelesenen Feldern welche Katalog-Abfrage gemacht wird, und
 * ein Eindeutigkeits-Gate je Regel:
 *   - genau 1 Treffer  → `unique`  (zuweisen)
 *   - > 1 Treffer       → `ambiguous` (Kandidaten zur Auswahl, NICHT raten)
 *   - 0 Treffer         → nächste Regel; am Ende `notfound`
 *
 * Reihenfolge (stärkstes/eindeutigstes Signal zuerst):
 *   R1 setCode + number                     (per Set-Definition eindeutig)
 *   R2 printedTotal + number → Set → Karte  (printedTotal ist Set-Fingerabdruck)
 *   R3 name (de/en) + number                (mit printedTotal/setCode eingegrenzt)
 *   R4 nationalDexNumber + number           (nur als Eingrenzung, nie „alle")
 *
 * Der Symbolabgleich (nur alte, kürzellose Sets) bleibt bewusst DRAUSSEN — er
 * ist im Scanner die letzte Not-Option, wenn hier `notfound` zurückkommt UND
 * gar kein textliches Signal trug.
 *
 * Alle Katalog-/Set-Zugriffe werden als Dependencies injiziert → rein logisch
 * testbar und unabhängig von REST- vs. SDK-Zugriff.
 */

export interface ScanSignals {
  setCode?: string | null;
  /** Rohe, von Gemini gelesene Nummer (z.B. "091"). */
  number?: string | null;
  printedTotal?: number | null;
  name?: string | null;
  nationalDexNumber?: number | null;
}

export interface ResolveDeps {
  bySetCodeAndNumber(setCode: string, number: string): Promise<CatalogCard | null>;
  bySetAndNumber(setId: string, number: string): Promise<CatalogCard | null>;
  byNameAndNumber(name: string, number: string): Promise<CatalogCard[]>;
  byDexNumber(dex: number): Promise<CatalogCard[]>;
  setIdsByPrintedTotal(printedTotal: number): Promise<string[]>;
  /** Gedruckter Gesamtumfang eines Sets (gecacht empfohlen). */
  setPrintedTotal(setId: string): Promise<number | null>;
  /** Name-Präfix-Suche (nameLower ∪ nameDeLower) für den Promo-Fallback R5.
   *  Optional — fehlt sie, wird R5 übersprungen. */
  byNamePrefix?(prefixLower: string): Promise<CatalogCard[]>;
  /** National-Dex einer Art über ihren DE-/EN-Namen — für das artbewusste
   *  Namens-Gate in R2 (Froxy↔Froakie). Optional. */
  dexForName?(name: string): Promise<number | null>;
}

/** Name auf Vergleichsform reduzieren (Bindestriche/Leerzeichen/Suffix-Zeichen
 *  raus) — „Ash-Greninja EX" und „Ash Greninja EX" werden identisch. */
function nameNorm(s?: string | null): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9äöü]/g, '');
}

/** Reine Ziffern einer Nummer ohne führende Nullen: „XY133"→„133", „091"→„91".
 *  Bildet den Nummern-Kern ab, den Gemini auch bei fehlendem Set-Präfix liest. */
function numberCore(s?: string | null): string {
  return (s ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

/** Levenshtein-Distanz (OCR-tolerante Namens-Gegenprobe). */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export type ResolveStatus = 'unique' | 'ambiguous' | 'notfound';

export interface ResolveResult {
  status: ResolveStatus;
  card?: CatalogCard;
  candidates?: CatalogCard[];
  /** Welche Regel gegriffen hat (z.B. "printedTotal+number"). */
  matchedBy?: string;
  /** Menschlich lesbare Schritt-Spur fürs Debug-Modal. */
  trace: string[];
}

/** Schreibweisen-Varianten einer Nummer: der Katalog speichert i.d.R. ohne
 *  führende Nullen ("91"), Gemini liest oft gepolstert ("091"). Beide + roh. */
function numberVariants(raw: string): string[] {
  const t = raw.trim();
  const out = [t];
  if (/^\d+$/.test(t)) {
    const stripped = String(parseInt(t, 10));
    const padded = stripped.padStart(3, '0');
    for (const v of [stripped, padded]) if (!out.includes(v)) out.push(v);
  }
  return out;
}

export async function resolveScannedCard(s: ScanSignals, deps: ResolveDeps): Promise<ResolveResult> {
  const trace: string[] = [];
  const numbers = s.number ? numberVariants(s.number) : [];
  const nameLower = s.name ? s.name.trim().toLowerCase() : null;

  const dexOk  = (c: CatalogCard) => !s.nationalDexNumber || !c.nationalDexNumber || c.nationalDexNumber === s.nationalDexNumber;
  const nameOk = (c: CatalogCard) => !nameLower || c.nameLower === nameLower || c.nameDeLower === nameLower;
  // OCR-tolerantes Namens-Gate (normalisiert + Levenshtein) — akzeptiert
  // Bindestrich-/Suffix-Varianten, weist aber klar andere Namen ab. Ohne
  // gelesenen Namen immer true (kein Gate).
  const gNorm = nameNorm(s.name);
  const nameLooseOk = (c: CatalogCard) => {
    if (!gNorm) return true;
    const cn = nameNorm(c.name), cd = nameNorm(c.nameDe);
    return cn === gNorm || cd === gNorm
      || (cn.length >= 3 && lev(cn, gNorm) <= 2)
      || (cd.length >= 3 && lev(cd, gNorm) <= 2);
  };
  const totalOk = async (c: CatalogCard) => {
    if (!s.printedTotal) return true;
    const t = await deps.setPrintedTotal(c.setId);
    return t == null || t === s.printedTotal;
  };
  // Art-Dex aus dem gelesenen Namen (memoisiert, nur bei Bedarf abgefragt) —
  // überbrückt DE-/EN-Namensdifferenzen im Namens-Gate: „Froxy"(de) und
  // „Froakie"(en) sind dieselbe Art (Dex 656). Nur wenn Gemini KEINE eigene
  // Dex-Nr. lieferte (sonst gilt die).
  let nameDex: number | null | undefined;
  const getNameDex = async (): Promise<number | null> => {
    if (nameDex !== undefined) return nameDex;
    nameDex = (deps.dexForName && s.name && !s.nationalDexNumber) ? await deps.dexForName(s.name) : null;
    return nameDex;
  };
  // Namens-Gate mit Art-Fallback: Name gleicht ODER (kein Namensgleich, aber die
  // Karte gehört zur namensaufgelösten Art). Nur dort einsetzen, wo ein starkes
  // zweites Signal (printedTotal = Set-Fingerabdruck) die Karte schon eingrenzt.
  const nameOrSpeciesOk = async (c: CatalogCard) => {
    if (nameOk(c)) return true;
    const nd = await getNameDex();
    return nd != null && c.nationalDexNumber === nd;
  };

  // ── R1: setCode + number ────────────────────────────────────────────────
  if (s.setCode && numbers.length) {
    for (const n of numbers) {
      const c = await deps.bySetCodeAndNumber(s.setCode, n);
      if (c && dexOk(c) && (await totalOk(c))) {
        trace.push(`R1 setCode+number: ${s.setCode}/${n} → ${c.id}`);
        return { status: 'unique', card: c, matchedBy: 'setCode+number', trace };
      }
    }
    trace.push(`R1 setCode+number (${s.setCode}): kein bestätigter Treffer`);
  }

  // ── R2: printedTotal + number → Set → Karte ─────────────────────────────
  if (s.printedTotal && numbers.length) {
    const setIds = await deps.setIdsByPrintedTotal(s.printedTotal);
    trace.push(`R2 printedTotal ${s.printedTotal} → Sets [${setIds.join(', ') || '—'}]`);
    const hits: CatalogCard[] = [];
    const seen = new Set<string>();
    for (const setId of setIds) {
      for (const n of numbers) {
        const c = await deps.bySetAndNumber(setId, n);
        // Namens-Gate artbewusst: die McDonald's-Auflage „Froakie" wird bei
        // deutschem Scan-Namen „Froxy" über die gemeinsame Dex-Nr. akzeptiert.
        if (c && !seen.has(c.id) && dexOk(c) && (await nameOrSpeciesOk(c))) { seen.add(c.id); hits.push(c); }
      }
    }
    if (hits.length === 1) {
      trace.push(`R2 → eindeutig ${hits[0].id}`);
      return { status: 'unique', card: hits[0], matchedBy: 'printedTotal+number', trace };
    }
    if (hits.length > 1) {
      trace.push(`R2 → ${hits.length} Kandidaten (mehrdeutig)`);
      return { status: 'ambiguous', candidates: hits, matchedBy: 'printedTotal+number', trace };
    }
    trace.push('R2 → kein Treffer');
  }

  // ── R3: name (de/en) + number ───────────────────────────────────────────
  if (nameLower && s.name && numbers.length) {
    const all: CatalogCard[] = [];
    const seen = new Set<string>();
    for (const n of numbers) {
      for (const c of await deps.byNameAndNumber(s.name, n)) {
        if (!seen.has(c.id)) { seen.add(c.id); all.push(c); }
      }
    }
    // per Dex + printedTotal eingrenzen (Gegenproben, denen wir vertrauen)
    const filtered: CatalogCard[] = [];
    for (const c of all) if (dexOk(c) && (await totalOk(c))) filtered.push(c);
    trace.push(`R3 name+number: ${all.length} roh → ${filtered.length} nach Gegenprobe`);
    if (filtered.length === 1) {
      return { status: 'unique', card: filtered[0], matchedBy: 'name+number', trace };
    }
    if (filtered.length > 1) {
      if (s.setCode) {
        const byCode = filtered.filter(c => c.setCode === s.setCode);
        if (byCode.length === 1) {
          trace.push(`R3 → per setCode ${s.setCode} auf ${byCode[0].id} eingegrenzt`);
          return { status: 'unique', card: byCode[0], matchedBy: 'name+number+setCode', trace };
        }
      }
      return { status: 'ambiguous', candidates: filtered, matchedBy: 'name+number', trace };
    }
  }

  // ── R4: nationalDexNumber + number (nur als Eingrenzung) ────────────────
  if (s.nationalDexNumber && numbers.length) {
    const dexCards = await deps.byDexNumber(s.nationalDexNumber);
    // Namens-Gate: gleiche Dex+Nummer können ZWEI verschiedene Karten teilen
    // (z.B. Greninja GX `sm6-133` vs. Ash-Greninja EX — beide Dex 658). Ohne
    // Name würde die erste „Nummer 133"-Karte fälschlich gewinnen; mit Name
    // fällt sie durch und R5 (Promo, Nummern-Kern „XY133") übernimmt.
    let filtered = dexCards.filter(c => numbers.includes(c.number) && nameLooseOk(c));
    trace.push(`R4 dex ${s.nationalDexNumber} + number: ${dexCards.length} roh → ${filtered.length} mit Nummer${gNorm ? '+Name' : ''}`);
    if (s.printedTotal && filtered.length > 1) {
      const tf: CatalogCard[] = [];
      for (const c of filtered) if (await totalOk(c)) tf.push(c);
      if (tf.length) filtered = tf;
    }
    if (filtered.length === 1) {
      return { status: 'unique', card: filtered[0], matchedBy: 'dex+number', trace };
    }
    if (filtered.length > 1) {
      return { status: 'ambiguous', candidates: filtered, matchedBy: 'dex+number', trace };
    }
  }

  // ── R5: Promo-Fallback — Name (fuzzy) + Nummer-Kern ──────────────────────
  // Für Promos (XY-/SM-/SWSH-/SV-Serie), deren Katalog-Nummer einen Set-Präfix
  // trägt (z.B. „XY133"), den Gemini als reine Ziffern liest („133"), und deren
  // Name durch Bindestrich/Suffix minimal abweicht („Ash-Greninja EX" vs
  // „Ash Greninja EX"). setCode/printedTotal/Dex fehlen bei Promos meist — R1–R4
  // greifen dann nicht. Erst Name UND Nummern-Kern ZUSAMMEN sind präzise genug.
  const gCore = numberCore(s.number);
  if (deps.byNamePrefix && nameLower && s.name && gCore) {
    // Präfix normalisieren (Sonderzeichen → Leerzeichen) + die ersten zwei
    // Wörter als lockereren Präfix (fängt fehlende/zusätzliche Suffixe wie „EX").
    const spaced = s.name.toLowerCase().replace(/[^a-z0-9äöü]+/g, ' ').trim();
    const tokens = spaced.split(' ').filter(Boolean);
    const prefixes = [...new Set([spaced, tokens.slice(0, 2).join(' ')].filter(p => p.length >= 2))];
    const byId = new Map<string, CatalogCard>();
    for (const p of prefixes) for (const c of await deps.byNamePrefix(p)) byId.set(c.id, c);

    const matches: CatalogCard[] = [];
    for (const c of byId.values()) {
      if (numberCore(c.number) !== gCore) continue;          // Nummern-Kern muss passen
      if (!dexOk(c) || !nameLooseOk(c)) continue;
      if (!(await totalOk(c))) continue;
      matches.push(c);
    }
    trace.push(`R5 promo name+nummern-kern (${prefixes.join(' | ')} × ${gCore}): ${byId.size} roh → ${matches.length} bestätigt`);
    if (matches.length === 1) {
      return { status: 'unique', card: matches[0], matchedBy: 'promo-name+number', trace };
    }
    if (matches.length > 1) {
      return { status: 'ambiguous', candidates: matches, matchedBy: 'promo-name+number', trace };
    }
  }

  trace.push('kein Treffer über textliche Signale');
  return { status: 'notfound', trace };
}
