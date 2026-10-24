import fs from 'node:fs';
import admin from 'firebase-admin';
import sharp from 'sharp';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
admin.initializeApp({ credential: admin.credential.cert({ projectId: env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey: env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
const db = admin.firestore();
const BUCKET = 'smartfamilyzone-d9657.firebasestorage.app';
const bucket = admin.storage().bucket(BUCKET);

const SET_ID = 'CBB1C', SET_NAME = 'Gem Pack Vol. 1', SERIES = 'Gem Pack', RELEASE = '2025-02-20';
const GALLERY = 'https://pokezentrum.de/pokemon-karten-news/pokemon-card-game-gem-pack-vol-1-kartenliste-und-kartengalerie/';
const UA = { 'User-Agent': 'Mozilla/5.0' };
const DRY = process.argv.includes('--dry');
const SAMPLE = process.argv.includes('--sample'); // schreibt Beispiel-Crops nach OUT, kein Firestore/Storage
const OUT = '/private/tmp/claude-501/-Users-sgr-Entwicklung-ai-pokedex/ac61eb9b-bd24-4c0e-99ea-23fd4dfba546/scratchpad';

// Nicht-Pokémon-Namen → Supertyp. Alles andere = Pokémon (Dex via Katalog).
// Dex-Fallback für Namen, deren Katalog-Drucke keine nationalDexNumber tragen.
const DEX_FALLBACK = { 'Pikachu': 25 };
const ENERGY = /-?Energie$/i;
const ITEMS = /^(Pokéball|Pokeball|Superball|Hyperball|Meisterball|Flottball|Turboball)$/i;
const fetchBuf = async (u) => Buffer.from(await (await fetch(u, { headers: UA })).arrayBuffer());

async function roundPng(buf) {
  const m = await sharp(buf).metadata(); const w = m.width, h = m.height;
  const r = Math.round(w * 0.055);
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

const html = await (await fetch(GALLERY, { headers: UA })).text();
const heads = [...html.matchAll(/<strong>\s*([^<&]+?)\s*&#8211;\s*(\d{2})(\d{2})\/(\d{2})\s*<\/strong>/g)]
  .map(m => ({ name: m[1].trim(), nn: m[2], vv: m[3], tt: m[4] }));
const imgs = [...new Map([...html.matchAll(/href="(https:\/\/pokezentrum\.de\/wp-content\/uploads\/([^"]+?)\.(?:jpg|jpeg|png))"\s+data-elementor-open-lightbox/g)]
  .map(m => [m[1], { url: m[1], file: m[2] }])).values()];

console.log(`Parsed ${heads.length} Karten, ${imgs.length} Galerie-Bilder. DRY=${DRY} SAMPLE=${SAMPLE}`);
let docs = 0, withImg = 0, placeholders = 0; const report = []; const dexMiss = [];

for (const h of heads) {
  const num = `${h.nn}${h.vv}`;
  const id = `${SET_ID}-${num}`;
  try {
    // Supertyp bestimmen
    let supertype = 'Pokémon';
    if (ENERGY.test(h.name)) supertype = 'Energy';
    else if (ITEMS.test(h.name)) supertype = 'Trainer';

    // Dex/Kataloginfos nur für Pokémon
    let pk = null, dex = null, nameEn = h.name, types = [], family = [];
    if (supertype === 'Pokémon') {
      // Mehrere Kandidaten holen und den ersten MIT Dex nehmen — der erste
      // Treffer hat im Katalog nicht immer eine nationalDexNumber gesetzt.
      const cands = (await db.collection('tcg_catalog').where('nameDe', '==', h.name).limit(12).get()).docs.map(d => d.data());
      pk = cands.find(c => c.nationalDexNumber != null) ?? cands[0];
      dex = pk?.nationalDexNumber ?? DEX_FALLBACK[h.name] ?? null;
      nameEn = pk?.name ?? h.name; types = pk?.types ?? []; family = pk?.evolutionFamily ?? (dex ? [dex] : []);
      if (!dex) dexMiss.push(`${num} ${h.name}`);
    }

    // Bild per Dateinamen-Nummer (NNVV-TT-CBB1C); besten Kandidaten wählen
    let cand = imgs.filter(i => new RegExp(`-${num}-${h.tt}-CBB1C`, 'i').test(i.file));
    // Fallback für Item-Karten (Pokéball/Superball/Hyperball): pokezentrum hat
    // die Dateinummer teils vertippt (z.B. „10701" statt „1701"), aber der
    // Item-Name im Dateinamen ist eindeutig → darüber matchen.
    if (!cand.length && supertype === 'Trainer') {
      const base = h.name.replace(/é/g, 'e');
      cand = imgs.filter(i => new RegExp(`^${base}-\\d+-${h.tt}-CBB1C`, 'i').test(i.file.split('/').pop()));
    }
    cand.sort((a, b) => a.file.length - b.file.length); // kürzester Name = „Basis"-Scan
    const pick = cand[0] || null;

    let url = null, png = null;
    if (pick) {
      png = await roundPng(await fetchBuf(pick.url));
      url = await upload(`catalog-images/${id}.png`, png);
      withImg++;
      if (SAMPLE && ['01', '08', '17', '18'].includes(h.nn)) await sharp(png).toFile(`${OUT}/${id}.png`);
    } else placeholders++;

    const doc = {
      id, name: nameEn, nameLower: nameEn.toLowerCase(), nameDe: h.name, nameDeLower: h.name.toLowerCase(), nameSortLower: h.name.toLowerCase(),
      number: `${num}/${h.tt}`, setId: SET_ID, setName: SET_NAME, series: SERIES, setCode: SET_ID,
      rarity: pick ? rarityFromFile(pick.file) : 'Common', supertype, types,
      ...(dex ? { nationalDexNumber: dex } : {}), ...(family.length ? { evolutionFamily: family } : {}),
      imgSmall: '', imgLarge: '', variants: ['holo'],
      ...(url ? { imgSmallDe: url, imgLargeDe: url, hasDeImage: true, deImageSource: 'pokezentrum' } : { hasDeImage: false }),
    };
    if (!DRY && !SAMPLE) await db.collection('tcg_catalog').doc(id).set(doc, { merge: true });
    docs++;
    report.push(`${num}/${h.tt} ${h.name} [${supertype}${dex ? ' dex ' + dex : ''}] ${pick ? '🖼 ' + rarityFromFile(pick.file) : '— KEIN BILD'}`);
  } catch (e) { report.push(`${num} ${h.name}: FEHLER ${e.message}`); }
}

if (!DRY && !SAMPLE) await db.collection('tcg_sets').doc(SET_ID).set({
  id: SET_ID, name: SET_NAME, nameDe: SET_NAME, series: SERIES, releaseDate: RELEASE,
  total: heads.length, printedTotal: heads.length, ptcgoCode: SET_ID, logoUrl: '', symbolUrl: '', custom: true,
}, { merge: true });

console.log(report.join('\n'));
console.log(`\nDex-Lücken (${dexMiss.length}): ${dexMiss.join(', ') || '—'}`);
console.log(`\nFERTIG: ${docs} Docs, ${withImg} Bilder, ${placeholders} Platzhalter. DRY=${DRY} SAMPLE=${SAMPLE}`);
process.exit(0);
