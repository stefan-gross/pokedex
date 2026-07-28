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
  const totalOk = async (c: CatalogCard) => {
    if (!s.printedTotal) return true;
    const t = await deps.setPrintedTotal(c.setId);
    return t == null || t === s.printedTotal;
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
        if (c && !seen.has(c.id) && dexOk(c) && nameOk(c)) { seen.add(c.id); hits.push(c); }
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
    let filtered = dexCards.filter(c => numbers.includes(c.number));
    trace.push(`R4 dex ${s.nationalDexNumber} + number: ${dexCards.length} roh → ${filtered.length} mit Nummer`);
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

  trace.push('kein Treffer über textliche Signale');
  return { status: 'notfound', trace };
}
