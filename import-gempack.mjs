import fs from 'node:fs';
import admin from 'firebase-admin';
import sharp from 'sharp';

// ── Generischer Gem-Pack-Importer (Einzelbild-Volumes Vol. 1–5) ──────────────
// Aufruf:  node import-gempack.mjs --vol N [--dry] [--sample]
//   --dry     nichts schreiben, nur Report
//   --sample  Beispiel-Crops nach OUT schreiben (kein Firestore/Storage)
// Quelle: pokezentrum-Galerie. Daten kommen bei Vol. 2–5 rein aus den
// Dateinamen (keine <strong>-Textliste); Schema je Volume unterschiedlich.

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
admin.initializeApp({ credential: admin.credential.cert({ projectId: env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey: env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
const db = admin.firestore();
const BUCKET = 'smartfamilyzone-d9657.firebasestorage.app';
const bucket = admin.storage().bucket(BUCKET);
const UA = { 'User-Agent': 'Mozilla/5.0' };
const OUT = '/private/tmp/claude-501/-Users-sgr-Entwicklung-ai-pokedex/ac61eb9b-bd24-4c0e-99ea-23fd4dfba546/scratchpad';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry'), SAMPLE = argv.includes('--sample');
const VOL = Number(argv[argv.indexOf('--vol') + 1]);

const VOLS = {
  2: { setId: 'CBB2C', name: 'Gem Pack Vol. 2', release: '2025-06-10', scheme: 'concat', url: 'https://pokezentrum.de/pokemon-karten-news/pokemon-card-gem-pack-vol-2-kartenliste-und-kartengalerie/' },
  3: { setId: 'CBB3C', name: 'Gem Pack Vol. 3', release: '2025-09-27', scheme: 'dash', url: 'https://pokezentrum.de/pokemon-karten-news/pokemon-card-gem-pack-vol-3-kartenliste-und-kartengalerie/' },
  4: { setId: 'CBB4C', name: 'Gem Pack Vol. 4', release: '2026-02-08', scheme: 'dash', url: 'https://pokezentrum.de/pokemon-karten-news/pokemon-card-gem-pack-vol-4-kartenliste-und-kartengalerie/' },
  5: { setId: 'CBB5C', name: 'Gem Pack Vol. 5', release: '2026-04-23', scheme: 'dash', url: 'https://pokezentrum.de/pokemon-karten-news/pokemon-gem-pack-vol-5-kartenliste-und-kartengalerie/' },
};
const cfg = VOLS[VOL];
if (!cfg) { console.error('Unbekanntes --vol (nur 2–5):', VOL); process.exit(1); }
const SET_ID = cfg.setId, SERIES = 'Gem Pack';

const DEX_FALLBACK = { 'Pikachu': 25 };
const ENERGY = /Energ(ie|y)$/i;                              // dt. „Energie" + engl. „Energy"
const ITEMS = /(ball|angel)$|(^|\s)(Switch|Tausch|Rod)(\s|$)/i;  // Trainer-Items
const SUFFIX = /\s+(V|VMAX|VSTAR|ex|EX|GX)$/; // Kartentyp-Suffix fürs Dex-Lookup abstreifen

const fetchBuf = async (u) => Buffer.from(await (await fetch(u, { headers: UA })).arrayBuffer());
async function roundPng(buf) {
  const m = await sharp(buf).metadata(); const w = m.width, h = m.height; const r = Math.round(w * 0.055);
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
  return sharp(buf).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}
async function upload(path, png) {
  if (DRY || SAMPLE) return `https://storage.googleapis.com/${BUCKET}/${path}`;
  await bucket.file(path).save(png, { contentType: 'image/png', resumable: false, predefinedAcl: 'publicRead', metadata: { cacheControl: 'public, max-age=31536000' } });
  return `https://storage.googleapis.com/${BUCKET}/${path}`;
}
function rarityFromFile(f) {
  if (/Secret-Rare|Shiny/i.test(f)) return 'Secret Rare';
  if (/AR-Art-Rare|Art-Rare/i.test(f)) return 'Art Rare';
  if (/Master-Ball/i.test(f)) return 'Master Ball Holo';
  if (/Pokeball-Reverse|Poke-?ball/i.test(f)) return 'Poké Ball Holo';
  if (/Reverse-Holo/i.test(f)) return 'Reverse Holo';
  if (/Holo/i.test(f)) return 'Holo';
  return 'Common';
}

const html = await (await fetch(cfg.url, { headers: UA })).text();
const imgs = [...new Map([...html.matchAll(/href="(https:\/\/pokezentrum\.de\/wp-content\/uploads\/([^"]+?)\.(?:jpg|jpeg|png))"\s+data-elementor-open-lightbox/g)]
  .map(m => [m[1], { url: m[1], file: m[2].split('/').pop() }])).values()];

// Dateinamen → {name, nn, vv, tt}. Einheitliches Muster, das BEIDE Schemata
// fängt: „…-NNVV-TT-SET" (concat) und „…-NN-VV-TT-SET" (dash, Trenner optional).
// Der Name steht davor (inkl. evtl. englischem Zweitnamen / V/VMAX-Suffix).
const re = new RegExp(`^(.+?)-(\\d{2})-?(\\d{2})-(\\d{2})-${SET_ID}`, 'i');
const parsed = [];
for (const img of imgs) {
  const m = img.file.match(re);
  if (!m) continue;
  parsed.push({ name: m[1].replace(/-/g, ' ').trim(), nn: m[2], vv: m[3], tt: m[4], ...img });
}
// Je Kartennummer (nn+vv) der beste Scan (kürzester Dateiname = „Basis")
const byNum = new Map();
for (const p of parsed) {
  const key = `${p.nn}${p.vv}`;
  const cur = byNum.get(key);
  if (!cur || p.file.length < cur.file.length) byNum.set(key, p);
}
const cards = [...byNum.values()].sort((a, b) => (a.nn + a.vv).localeCompare(b.nn + b.vv));

console.log(`VOL ${VOL} (${SET_ID}) · ${imgs.length} Galerie-Bilder · ${cards.length} eindeutige Karten · DRY=${DRY} SAMPLE=${SAMPLE}`);
let docs = 0, withImg = 0; const dexMiss = []; const report = [];

async function lookupDex(name) {
  const noRegion = name.replace(/^(Alola|Galar|Hisui|Paldea)[-\s]+/i, '').trim();
  const toks = name.split(' ');
  // Reihenfolge: voller Name, Suffix-frei, Region-frei, erstes Token, letztes
  // Token (doppelsprachige Dateinamen „Spheal Seemops" → dt. Name hinten).
  const tries = [name, name.replace(SUFFIX, '').trim(), noRegion, noRegion.replace(SUFFIX, '').trim(), toks[0], toks[toks.length - 1]];
  for (const t of [...new Set(tries.filter(Boolean))]) {
    // erst deutscher Name, dann englischer name-Feld (engl. Dateinamen wie „Floragato")
    for (const field of ['nameDe', 'name']) {
      const cands = (await db.collection('tcg_catalog').where(field, '==', t).limit(12).get()).docs.map(d => d.data());
      const hit = cands.find(c => c.nationalDexNumber != null);
      if (hit) return { pk: hit, dex: hit.nationalDexNumber };
      if (cands[0] && DEX_FALLBACK[t] != null) return { pk: cands[0], dex: DEX_FALLBACK[t] };
    }
  }
  return { pk: null, dex: DEX_FALLBACK[name] ?? null };
}

for (const c of cards) {
  const num = `${c.nn}${c.vv}`, id = `${SET_ID}-${num}`;
  try {
    let supertype = 'Pokémon';
    if (ENERGY.test(c.name)) supertype = 'Energy';
    else if (ITEMS.test(c.name)) supertype = 'Trainer';

    let pk = null, dex = null, nameEn = c.name, nameDe = c.name, types = [], family = [];
    if (supertype === 'Pokémon') {
      const r = await lookupDex(c.name); pk = r.pk; dex = r.dex;
      // Bei erkanntem Pokémon den sauberen Katalognamen nehmen (statt dual-
      // sprachigem Dateinamen wie „Aquana Vaporeon").
      nameEn = pk?.name ?? c.name; nameDe = pk?.nameDe ?? c.name;
      types = pk?.types ?? []; family = pk?.evolutionFamily ?? (dex ? [dex] : []);
      if (!dex) dexMiss.push(`${num} ${c.name}`);
    }

    const png = await roundPng(await fetchBuf(c.url));
    const url = await upload(`catalog-images/${id}.png`, png); withImg++;
    if (SAMPLE && Number(c.nn) <= 2) await sharp(png).toFile(`${OUT}/${id}.png`);

    const doc = {
      id, name: nameEn, nameLower: nameEn.toLowerCase(), nameDe, nameDeLower: nameDe.toLowerCase(), nameSortLower: nameDe.toLowerCase(),
      number: `${num}/${c.tt}`, setId: SET_ID, setName: cfg.name, series: SERIES, setCode: SET_ID,
      rarity: rarityFromFile(c.file), supertype, types,
      ...(dex ? { nationalDexNumber: dex } : {}), ...(family.length ? { evolutionFamily: family } : {}),
      imgSmall: '', imgLarge: '', variants: ['holo'], nativeLanguage: 'zh',
      imgSmallDe: url, imgLargeDe: url, hasDeImage: true, deImageSource: 'pokezentrum',
    };
    if (!DRY && !SAMPLE) await db.collection('tcg_catalog').doc(id).set(doc, { merge: true });
    docs++;
    report.push(`${num}/${c.tt} ${c.name} [${supertype}${dex ? ' dex ' + dex : ''}] ${rarityFromFile(c.file)}`);
  } catch (e) { report.push(`${num} ${c.name}: FEHLER ${e.message}`); }
}

if (!DRY && !SAMPLE) await db.collection('tcg_sets').doc(SET_ID).set({
  id: SET_ID, name: cfg.name, nameDe: cfg.name, series: SERIES, releaseDate: cfg.release,
  total: cards.length, printedTotal: cards.length, ptcgoCode: SET_ID, logoUrl: '', symbolUrl: '', custom: true,
}, { merge: true });

if (argv.includes('--verbose')) console.log(report.join('\n'));
console.log(`\nDex-Lücken (${dexMiss.length}): ${dexMiss.join(', ') || '—'}`);
console.log(`\nFERTIG: ${docs} Docs, ${withImg} Bilder. VOL ${VOL} DRY=${DRY} SAMPLE=${SAMPLE}`);
process.exit(0);
