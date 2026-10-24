import fs from 'node:fs';
import admin from 'firebase-admin';
import sharp from 'sharp';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
admin.initializeApp({ credential: admin.credential.cert({ projectId: env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey: env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
const db = admin.firestore();
const BUCKET = 'smartfamilyzone-d9657.firebasestorage.app';
const bucket = admin.storage().bucket(BUCKET);
const SET_ID = 'CBB6C', SET_NAME = 'Gem Pack Vol. 6', SERIES = 'Gem Pack', RELEASE = '2026-08-07';
const DEX_FALLBACK = { 'Owei': 102, 'Formeo': 351, 'Knapfel': 840 };
const UA = { 'User-Agent': 'Mozilla/5.0' };
const DRY = process.argv.includes('--dry');

const fetchBuf = async (u) => Buffer.from(await (await fetch(u, { headers: UA })).arrayBuffer());
const stripForm = (n) => n.replace(/\s*\(.*\)\s*$/, '').trim();
const ratioOf = async (b) => { const m = await sharp(b).metadata(); return m.width / m.height; };

async function roundPng(buf) {
  const m = await sharp(buf).metadata(); const w = m.width, h = m.height;
  const r = Math.round(w * 0.055);
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
  return sharp(buf).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}
async function cropCell(montBuf, mm /*1..6, SPALTENWEISE nummeriert: 01/02=Spalte1 oben/unten, 03/04=Spalte2, 05/06=Spalte3*/) {
  const m = await sharp(montBuf).metadata(); const cw = Math.floor(m.width / 3), ch = Math.floor(m.height / 2);
  const col = Math.floor((mm - 1) / 2), row = (mm - 1) % 2;
  return sharp(montBuf).extract({ left: col * cw, top: row * ch, width: cw, height: ch }).png().toBuffer();
}
async function upload(path, png) {
  if (DRY) return `https://storage.googleapis.com/${BUCKET}/${path}`;
  await bucket.file(path).save(png, { contentType: 'image/png', resumable: false, predefinedAcl: 'publicRead', metadata: { cacheControl: 'public, max-age=31536000' } });
  return `https://storage.googleapis.com/${BUCKET}/${path}`;
}

const html = await (await fetch('https://pokezentrum.de/pokemon-karten-news/pokemon-gem-pack-vol-6-kartenliste-und-galerie/', { headers: UA })).text();
const heads = [...html.matchAll(/<strong>([^<]+?)\s*(?:&#8211;|–|-)\s*(\d{2})\/07\s*:/g)].map(m => ({ nameDe: m[1].trim(), nn: m[2] }));
const uniq = [...new Set([...html.matchAll(/https:\/\/pokezentrum\.de\/wp-content\/uploads\/[^" ]+?\.(?:jpg|jpeg|png)/g)].map(m => m[0].replace(/-\d+x\d+(\.\w+)$/, '$1')))];

console.log(`Parsed ${heads.length} Pokémon, ${uniq.length} uniq images. DRY=${DRY}`);
let docs = 0, imgs = 0, placeholders = 0; const report = [];

for (const h of heads) {
  const { nn, nameDe } = h;
  try {
    let pk = (await db.collection('tcg_catalog').where('nameDe', '==', nameDe).limit(1).get()).docs[0]?.data()
          || (await db.collection('tcg_catalog').where('nameDe', '==', stripForm(nameDe)).limit(1).get()).docs[0]?.data();
    let dex = pk?.nationalDexNumber ?? DEX_FALLBACK[stripForm(nameDe)] ?? DEX_FALLBACK[nameDe];
    if (!pk && dex) pk = (await db.collection('tcg_catalog').where('nationalDexNumber', '==', dex).limit(1).get()).docs[0]?.data();
    const nameEn = pk?.name ?? stripForm(nameDe), types = pk?.types ?? [], family = pk?.evolutionFamily ?? (dex ? [dex] : []);

    // Bild-URLs bestimmen
    const irUrl = uniq.find(u => new RegExp(`(CBB6C-${nn}-07-07)|(-${nn}-07-07-CBB6C)`, 'i').test(u));
    // Montage: direkt "…-07-Pokemon…" (bei #07 ist das "CBB6C-07-07-Pokemon"); die IR hat
    // stattdessen "…-07-07-Pokemon…" → der Regex trennt beide auch bei Pokémon-Nr. 07 korrekt.
    // Sonderfall: Knapfel (#19) hat die Montage unter einem GENERISCHEN Dateinamen (ohne Name/NN).
    const MONT_OVERRIDE = { '19': 'https://pokezentrum.de/wp-content/uploads/Pokemon-CBB6C-Card-Gem-Pack-Vol.-6-Holo-Pokemon-Karten-China-TCG-Sammelkartenspiel.jpg' };
    const montUrl = uniq.find(u => new RegExp(`CBB6C-${nn}-07-Pokemon`, 'i').test(u)) || MONT_OVERRIDE[nn];
    // Fallback-Einzelbild (z.B. Knapfel "neu") für 01-06, wenn keine Montage
    let baseUrl = null;
    if (!montUrl) {
      for (const u of uniq) {
        if (u === irUrl) continue;
        if (u.toLowerCase().includes(nameDe.toLowerCase().split(' ')[0])) { const rr = await ratioOf(await fetchBuf(u)); if (rr > 0.6 && rr < 0.85) { baseUrl = u; break; } }
      }
    }
    const montBuf = montUrl ? await fetchBuf(montUrl) : null;
    const baseBuf = baseUrl ? await fetchBuf(baseUrl) : null;
    const irBuf = irUrl ? await fetchBuf(irUrl) : null;

    let withImg = 0;
    const batch = db.batch();
    for (let mm = 1; mm <= 7; mm++) {
      const id = `${SET_ID}-${nn}-${String(mm).padStart(2, '0')}`;
      let png = null;
      if (mm <= 6) png = montBuf ? await roundPng(await cropCell(montBuf, mm)) : (baseBuf ? await roundPng(baseBuf) : null);
      else png = irBuf ? await roundPng(irBuf) : null;
      let url = null;
      if (png) { url = await upload(`catalog-images/${id}.png`, png); imgs++; withImg++; } else placeholders++;
      const doc = {
        id, name: nameEn, nameLower: nameEn.toLowerCase(), nameDe, nameDeLower: nameDe.toLowerCase(), nameSortLower: nameDe.toLowerCase(),
        number: `${nn} ${String(mm).padStart(2, '0')}/07`, setId: SET_ID, setName: SET_NAME, series: SERIES, setCode: SET_ID,
        rarity: mm === 7 ? 'Illustration Rare' : 'Holo Rare', supertype: 'Pokémon', types,
        ...(dex ? { nationalDexNumber: dex } : {}), ...(family.length ? { evolutionFamily: family } : {}),
        imgSmall: '', imgLarge: '', variants: ['holo'],
        ...(url ? { imgSmallDe: url, imgLargeDe: url, hasDeImage: true, deImageSource: 'pokezentrum' } : { hasDeImage: false }),
      };
      if (!DRY) batch.set(db.collection('tcg_catalog').doc(id), doc, { merge: true });
      docs++;
    }
    if (!DRY) await batch.commit();
    report.push(`#${nn} ${nameDe} (dex ${dex ?? '??'}): 7 Docs, ${withImg} Bilder${montBuf ? '' : baseBuf ? ' [Basis-Shared]' : ' [kein Bild]'}${irBuf ? '' : ' [IR fehlt]'}`);
  } catch (e) { report.push(`#${nn} ${nameDe}: FEHLER ${e.message}`); }
}

if (!DRY) await db.collection('tcg_sets').doc(SET_ID).set({
  id: SET_ID, name: SET_NAME, nameDe: SET_NAME, series: SERIES, releaseDate: RELEASE,
  total: 196, printedTotal: 196, ptcgoCode: SET_ID, logoUrl: '', symbolUrl: '',
  custom: true, // manuell importiert, nicht in TCGdex → vom Sync-Prune ausnehmen
}, { merge: true });

console.log(report.join('\n'));
console.log(`\nFERTIG: ${docs} Docs, ${imgs} Bilder, ${placeholders} Platzhalter. DRY=${DRY}`);
process.exit(0);
