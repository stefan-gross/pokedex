import sharp from 'sharp';
import { getAdminDb } from '../firebase/admin';
import { SYMBOL_ONLY_SERIES } from '../card-constants';

export interface ReferenceSheet {
  label: string;
  buffer: Buffer;
  mimeType: 'image/jpeg';
}

// Ära-Reihenfolge = SYMBOL_ONLY_SERIES (lib/card-constants.ts) — Single Source of
// Truth, auch von RecognizedCardLarge (app/(app)/scanner/page.tsx) genutzt, um zu
// entscheiden, ob ein Set einen echten Kürzel-Aufdruck hat oder nicht.
// Scarlet & Violet ist bewusst NICHT enthalten — für S&V-Karten liest Gemini den
// Text-Code direkt (siehe PROMPT in app/api/scan/route.ts), ein Symbol-Abgleich
// ist dort nicht nötig.
const ERA_ORDER = SYMBOL_ONLY_SERIES;

const MAX_ICONS_PER_SHEET = 20;
const COLS = 5;
const CELL_W = 220;
const CELL_H = 260;
const ICON_BOX = 150;

interface SetForSheet {
  ptcgoCode: string;
  name: string;
  symbolUrl: string;
  series: string;
}

let sheetsCache: Promise<ReferenceSheet[]> | null = null;
let validCodesCache: Promise<Set<string>> | null = null;

export function getReferenceSheets(): Promise<ReferenceSheet[]> {
  if (!sheetsCache) sheetsCache = buildReferenceSheets();
  return sheetsCache;
}

/**
 * Alle ptcgoCodes, die tatsächlich auf den Referenzblättern abgebildet sind. Gemini
 * verwechselt im Symbolabgleich gelegentlich das Energie-Typ-Icon neben der Kartennummer
 * (z.B. "F" für Fighting) mit dem eigentlichen Set-Symbol und gibt dessen Buchstaben
 * zurück — ein Code, der auf keinem Blatt existiert. Gegen diese Liste validieren wir,
 * bevor wir einem `matchedSetCode` vertrauen.
 */
export function getValidSymbolSetCodes(): Promise<Set<string>> {
  if (!validCodesCache) {
    validCodesCache = loadEligibleSets().then(sets => new Set(sets.map(s => s.ptcgoCode)));
  }
  return validCodesCache;
}

async function buildReferenceSheets(): Promise<ReferenceSheet[]> {
  const sets = await loadEligibleSets();
  const buckets = bucketSets(sets);
  const sheets = await Promise.all(
    buckets.map((bucket, i) => buildSheet(bucket, i + 1, buckets.length)),
  );
  return sheets.filter((s): s is ReferenceSheet => s !== null);
}

let eligibleSetsCache: Promise<SetForSheet[]> | null = null;

function loadEligibleSets(): Promise<SetForSheet[]> {
  if (!eligibleSetsCache) eligibleSetsCache = loadEligibleSetsUncached();
  return eligibleSetsCache;
}

async function loadEligibleSetsUncached(): Promise<SetForSheet[]> {
  const snap = await getAdminDb().collection('tcg_sets').get();
  const sets: SetForSheet[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    if (!d.ptcgoCode || !d.symbolUrl) continue;
    if (!ERA_ORDER.includes(d.series)) continue; // S&V/Mega Evolution etc. ausschließen
    sets.push({
      ptcgoCode: d.ptcgoCode,
      name: d.nameDe ?? d.name,
      symbolUrl: d.symbolUrl,
      series: d.series,
    });
  }
  sets.sort((a, b) => ERA_ORDER.indexOf(a.series) - ERA_ORDER.indexOf(b.series));
  return sets;
}

/** Packt Sets sequenziell (in Ära-Reihenfolge) in Blätter mit max. MAX_ICONS_PER_SHEET. */
function bucketSets(sets: SetForSheet[]): SetForSheet[][] {
  const buckets: SetForSheet[][] = [];
  for (const s of sets) {
    let last = buckets[buckets.length - 1];
    if (!last || last.length >= MAX_ICONS_PER_SHEET) {
      last = [];
      buckets.push(last);
    }
    last.push(s);
  }
  return buckets;
}

async function fetchIconDataUri(url: string): Promise<string | null> {
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 5000);
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return `data:image/png;base64,${buf.toString('base64')}`;
    } finally {
      clearTimeout(to);
    }
  } catch {
    return null;
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function buildSheet(sets: SetForSheet[], index: number, total: number): Promise<ReferenceSheet | null> {
  if (sets.length === 0) return null;

  const icons = await Promise.all(sets.map(s => fetchIconDataUri(s.symbolUrl)));
  const rows = Math.ceil(sets.length / COLS);
  const width = COLS * CELL_W;
  const height = rows * CELL_H;

  const cells: string[] = [];
  sets.forEach((s, i) => {
    const uri = icons[i];
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx = col * CELL_W;
    const cy = row * CELL_H;
    const boxX = cx + (CELL_W - ICON_BOX) / 2;
    const boxY = cy + 14;
    const imgPad = 16;

    cells.push(`
      <rect x="${boxX}" y="${boxY}" width="${ICON_BOX}" height="${ICON_BOX}" rx="12" fill="#ffffff" stroke="#ccc" stroke-width="1.5" />
      ${uri ? `<image x="${boxX + imgPad}" y="${boxY + imgPad}" width="${ICON_BOX - imgPad * 2}" height="${ICON_BOX - imgPad * 2}" href="${uri}" preserveAspectRatio="xMidYMid meet" />` : ''}
      <text x="${cx + CELL_W / 2}" y="${boxY + ICON_BOX + 30}" font-family="monospace" font-size="24" font-weight="700" fill="#000000" text-anchor="middle">${escapeXml(s.ptcgoCode)}</text>
      <text x="${cx + CELL_W / 2}" y="${boxY + ICON_BOX + 52}" font-family="sans-serif" font-size="13" fill="#555555" text-anchor="middle">${escapeXml(s.name.length > 22 ? s.name.slice(0, 21) + '…' : s.name)}</text>
    `);
  });

  const title = `Referenzblatt ${index}/${total}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 10}" viewBox="0 0 ${width} ${height + 10}">
    <rect x="0" y="0" width="${width}" height="${height + 10}" fill="#f2f2f2" />
    ${cells.join('\n')}
  </svg>`;

  const buffer = await sharp(Buffer.from(svg))
    .flatten({ background: '#f2f2f2' })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { label: title, buffer, mimeType: 'image/jpeg' };
}
