import type { BinderPage } from '@/types';

/** Ein „Blatt" = 2 aufeinanderfolgende Pages (Vorder + Rück). */
export interface BinderSheet {
  front: BinderPage;
  back: BinderPage;
  /** Index dieses Blatts (0-basiert). */
  sheetIdx: number;
  /** Page-Indizes in der flachen pages[]-Liste. */
  frontPageIdx: number;
  backPageIdx: number;
}

/** Eine „Doppelseite" wie ein aufgeschlagenes Buch.
 *  spread 0:       null         | pages[0]     (Buch-Anfang, nur Vorderseite Blatt 1 rechts)
 *  spread 1:       pages[1]     | pages[2]      (Rück Blatt 1 + Vorder Blatt 2)
 *  spread k≥1:     pages[2k-1]  | pages[2k]
 *  letzter Spread bei gerader Page-Anzahl: rechts null.
 */
export interface BookSpread {
  spreadIdx: number;
  left: BinderPage | null;
  right: BinderPage | null;
  leftPageIdx: number | null;
  rightPageIdx: number | null;
}

const emptyPage = (size: number): BinderPage => ({ slots: Array(size).fill(null) });

/** Pages → Sheets (je 2 Pages = 1 Blatt). Ungerade Page-Anzahl → letztes Blatt hat leere Rückseite. */
export function pagesToSheets(pages: BinderPage[], size: number): BinderSheet[] {
  const out: BinderSheet[] = [];
  for (let i = 0; i < pages.length; i += 2) {
    const front = pages[i] ?? emptyPage(size);
    const back  = pages[i + 1] ?? emptyPage(size);
    out.push({
      front, back,
      sheetIdx: out.length,
      frontPageIdx: i,
      backPageIdx: i + 1,
    });
  }
  return out;
}

/** Sheets → flache Pages (Vorder, Rück, Vorder, Rück, …). */
export function sheetsToPages(sheets: BinderSheet[]): BinderPage[] {
  return sheets.flatMap(s => [s.front, s.back]);
}

/** Stellt eine gerade Page-Anzahl sicher. Hängt ggf. eine leere Rückseite an. */
export function ensureEvenPages(pages: BinderPage[], size: number): BinderPage[] {
  if (pages.length === 0) return [emptyPage(size), emptyPage(size)];
  if (pages.length % 2 === 0) return pages;
  return [...pages, emptyPage(size)];
}

/** Initiale Anzahl Blätter aus Capacity berechnen. Ohne Capacity → 1 Blatt. */
export function initialSheetCount(capacity: number | null | undefined, size: number): number {
  if (!capacity || capacity <= 0) return 1;
  // Pro Blatt 2 Seiten à `size` Slots = 2*size Karten
  return Math.max(1, Math.ceil(capacity / (size * 2)));
}

/** Pages → Buch-Spreads. Erster Spread hat nur rechts, dann immer Paare Rück/Vorder. */
export function pagesToSpreads(pages: BinderPage[]): BookSpread[] {
  if (pages.length === 0) {
    return [{ spreadIdx: 0, left: null, right: null, leftPageIdx: null, rightPageIdx: null }];
  }
  const out: BookSpread[] = [
    { spreadIdx: 0, left: null, right: pages[0], leftPageIdx: null, rightPageIdx: 0 },
  ];
  for (let k = 1; k < Math.ceil((pages.length + 1) / 2); k++) {
    const lIdx = 2 * k - 1;
    const rIdx = 2 * k;
    out.push({
      spreadIdx: k,
      left: pages[lIdx] ?? null,
      right: pages[rIdx] ?? null,
      leftPageIdx: lIdx < pages.length ? lIdx : null,
      rightPageIdx: rIdx < pages.length ? rIdx : null,
    });
  }
  return out;
}

/** „Blatt 3 · Vorderseite" / „Blatt 3 · Rückseite" für einen flachen Page-Index. */
export function pageLabel(pageIdx: number): { sheet: number; side: 'front' | 'back'; label: string } {
  const sheet = Math.floor(pageIdx / 2) + 1;
  const side: 'front' | 'back' = pageIdx % 2 === 0 ? 'front' : 'back';
  return { sheet, side, label: `Blatt ${sheet} · ${side === 'front' ? 'Vorderseite' : 'Rückseite'}` };
}

/** Header-Label für einen Spread.
 *  Erster Spread (nur rechts): „Vorderseite Blatt 1"
 *  Letzter Spread (nur links): „Rückseite Blatt N"
 *  Sonst: „Blatt 1 Rückseite | Blatt 2 Vorderseite" */
export function spreadLabel(spread: BookSpread): string {
  const labels: string[] = [];
  if (spread.leftPageIdx != null) {
    const l = pageLabel(spread.leftPageIdx);
    labels.push(`Blatt ${l.sheet} R.`);
  }
  if (spread.rightPageIdx != null) {
    const r = pageLabel(spread.rightPageIdx);
    labels.push(`Blatt ${r.sheet} V.`);
  }
  return labels.join(' · ');
}
