import { getAdminDb } from './firebase/admin';
import type { CatalogCard, SyncMeta } from './firestore/catalog';
import { detectVariants } from './card-constants';
import { toTcgdexId } from './tcgdex';

const TCG_BASE = 'https://api.pokemontcg.io/v2';
const PAGE_SIZE = 250;
const MAX_PAGES_PER_REQUEST = 2;   // 500 Karten pro Aufruf (~4-6 Sek.) → sicher unter Vercel-Timeout
const COL = 'tcg_catalog';
const META_COL = 'tcg_catalog_meta';

function apiHeaders(): Record<string, string> {
  return process.env.POKEMON_TCG_API_KEY
    ? { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY }
    : {};
}

export async function fetchCurrentTotal(): Promise<number> {
  const res = await fetch(`${TCG_BASE}/cards?pageSize=1`, { headers: apiHeaders() });
  const data = await res.json();
  return data.totalCount ?? 0;
}

async function fetchPage(page: number): Promise<CatalogCard[]> {
  const res = await fetch(
    `${TCG_BASE}/cards?page=${page}&pageSize=${PAGE_SIZE}&orderBy=set.releaseDate`,
    { headers: apiHeaders() }
  );
  const data = await res.json();
  return (data.data ?? []).map((c: {
    id: string; name: string; number: string;
    set: { id: string; name: string; series: string };
    rarity?: string; supertype?: string; types?: string[]; subtypes?: string[];
    hp?: string;
    nationalPokedexNumbers?: number[];
    images: { small: string; large: string };
  }): CatalogCard => ({
    id: c.id,
    name: c.name,
    nameLower: c.name.toLowerCase(),
    number: c.number,
    setId: c.set.id,
    setName: c.set.name,
    series: c.set.series,
    rarity: c.rarity ?? '',
    supertype: c.supertype ?? '',
    types: c.types ?? [],
    subtypes: c.subtypes ?? [],
    ...(c.hp                          ? { hp: parseInt(c.hp) }                          : {}),
    ...(c.nationalPokedexNumbers?.[0] ? { nationalDexNumber: c.nationalPokedexNumbers[0] } : {}),
    imgSmall: c.images.small,
    imgLarge: c.images.large,
    variants: detectVariants(c.rarity ?? ''),
  }));
}

async function upsertBatch(cards: CatalogCard[]): Promise<void> {
  const db = getAdminDb();
  // Admin SDK: 500 Dokumente pro Batch
  for (let i = 0; i < cards.length; i += 500) {
    const batch = db.batch();
    cards.slice(i, i + 500).forEach(card => {
      batch.set(db.collection(COL).doc(card.id), card, { merge: true });
    });
    await batch.commit();
  }
}

async function getMeta(): Promise<SyncMeta | null> {
  const db = getAdminDb();
  const snap = await db.collection(META_COL).doc('sync').get();
  return snap.exists ? (snap.data() as SyncMeta) : null;
}

async function setMeta(data: Partial<SyncMeta>): Promise<void> {
  const db = getAdminDb();
  await db.collection(META_COL).doc('sync').set(data, { merge: true });
}

export interface SyncResult {
  status: 'up-to-date' | 'in-progress' | 'complete' | 'updated' | 'error';
  message: string;
  written?: number;
  syncedTotal?: number;
  currentTotal?: number;
  done?: boolean;
}

export async function runSync(mode: 'auto' | 'update' | 'reset' = 'auto'): Promise<SyncResult> {
  const meta = await getMeta();
  const syncedTotal = meta?.syncedTotal ?? 0;
  const lastPage = meta?.lastPage ?? 0;

  // currentTotal nur beim update-Modus frisch von der API holen (braucht extra Aufruf).
  // Beim initialen Sync nehmen wir den gecachten Wert — spart ~1-2s pro Request.
  const currentTotal = mode === 'update' || !meta?.currentTotal
    ? await fetchCurrentTotal()
    : meta.currentTotal;

  const totalPages = Math.ceil(currentTotal / PAGE_SIZE);
  const isFullySynced = syncedTotal >= currentTotal;

  // ── RESET: Meta zurücksetzen → Auto-Sync startet von Seite 1 ───────────
  if (mode === 'reset') {
    await setMeta({ lastPage: 0, syncedTotal: 0, currentTotal, totalPages, lastSynced: new Date().toISOString() });
    return {
      status: 'in-progress',
      message: `↺ Catalog zurückgesetzt — ${currentTotal.toLocaleString()} Karten werden neu geladen`,
      syncedTotal: 0,
      currentTotal,
      done: false,
    };
  }

  // ── UPDATE: Nur neue Karten ──────────────────────────────────────────────
  if (mode === 'update') {
    if (isFullySynced) {
      return { status: 'up-to-date', message: `Alle ${syncedTotal.toLocaleString()} Karten sind aktuell`, syncedTotal, currentTotal };
    }
    const newCards = currentTotal - syncedTotal;
    const pagesToFetch = Math.ceil(newCards / PAGE_SIZE);
    const startPage = Math.max(1, totalPages - pagesToFetch + 1);
    let written = 0;
    for (let p = startPage; p <= totalPages; p++) {
      const cards = await fetchPage(p);
      if (!cards.length) break;
      await upsertBatch(cards);
      written += cards.length;
    }
    await setMeta({ lastPage: totalPages, totalPages, syncedTotal: currentTotal, currentTotal, lastSynced: new Date().toISOString() });
    return { status: 'updated', message: `✅ ${written} neue Karten hinzugefügt`, written, syncedTotal: currentTotal, currentTotal };
  }

  // ── AUTO: Initialer Sync ─────────────────────────────────────────────────
  if (isFullySynced) {
    return { status: 'up-to-date', message: `Alle ${syncedTotal.toLocaleString()} Karten sind aktuell`, syncedTotal, currentTotal };
  }

  const startPage = lastPage + 1;
  const endPage = Math.min(startPage + MAX_PAGES_PER_REQUEST - 1, totalPages);

  let written = 0;
  for (let p = startPage; p <= endPage; p++) {
    const cards = await fetchPage(p);
    if (!cards.length) break;
    await upsertBatch(cards);
    written += cards.length;
    await setMeta({ lastPage: p, totalPages, syncedTotal: syncedTotal + written, currentTotal, lastSynced: new Date().toISOString() });
  }

  const newSyncedTotal = syncedTotal + written;
  const done = newSyncedTotal >= currentTotal;
  return {
    status: done ? 'complete' : 'in-progress',
    message: done
      ? `✅ Alle ${newSyncedTotal.toLocaleString()} Karten synchronisiert`
      : `📥 ${newSyncedTotal.toLocaleString()} / ${currentTotal.toLocaleString()} Karten — morgen weiter`,
    written,
    syncedTotal: newSyncedTotal,
    currentTotal,
    done,
  };
}

// ── Evolutionsfamilien-Anreicherung ────────────────────────────────────────
// Einmaliger Schritt: liest alle Karten mit nationalDexNumber aber ohne evolutionFamily,
// holt Evolutionsketten von PokéAPI (gecacht pro Run) und schreibt evolutionFamily zurück.

const evoRunCache = new Map<number, number[]>();

async function fetchEvoFamily(dexNum: number): Promise<number[]> {
  if (evoRunCache.has(dexNum)) return evoRunCache.get(dexNum)!;
  try {
    const s = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${dexNum}`);
    if (!s.ok) { evoRunCache.set(dexNum, [dexNum]); return [dexNum]; }
    const sd = await s.json();
    const c = await fetch(sd.evolution_chain.url);
    if (!c.ok) { evoRunCache.set(dexNum, [dexNum]); return [dexNum]; }
    const cd = await c.json();
    const nums: number[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function walk(node: any) {
      const id = parseInt(node.species.url.split('/').filter(Boolean).pop() ?? '0');
      if (id > 0) nums.push(id);
      node.evolves_to.forEach(walk);
    }
    walk(cd.chain);
    nums.forEach(n => evoRunCache.set(n, nums)); // alle Familienmitglieder cachen
    return nums.length > 0 ? nums : [dexNum];
  } catch {
    evoRunCache.set(dexNum, [dexNum]);
    return [dexNum];
  }
}

export interface EnrichResult {
  status: 'complete' | 'in-progress' | 'up-to-date';
  message: string;
  enriched: number;
  remaining: number;
}

export async function enrichEvolutionFamilies(batchSize = 500): Promise<EnrichResult> {
  const db = getAdminDb();

  // Karten mit nationalDexNumber aber ohne evolutionFamily
  const snap = await db.collection(COL)
    .where('nationalDexNumber', '>', 0)
    .limit(batchSize + 1)
    .get();

  const toEnrich = snap.docs
    .filter(d => !d.data().evolutionFamily)
    .slice(0, batchSize);

  if (toEnrich.length === 0) {
    return { status: 'up-to-date', message: 'Alle Evolutionsdaten sind bereits vorhanden', enriched: 0, remaining: 0 };
  }

  // Unique Pokédex-Nummern sammeln
  const uniqueDexNums = [...new Set(toEnrich.map(d => d.data().nationalDexNumber as number))];

  // Evolutionsketten parallel (max 8 gleichzeitig) abrufen
  const CONCURRENCY = 8;
  for (let i = 0; i < uniqueDexNums.length; i += CONCURRENCY) {
    await Promise.all(uniqueDexNums.slice(i, i + CONCURRENCY).map(fetchEvoFamily));
  }

  // Batch-Update
  for (let i = 0; i < toEnrich.length; i += 500) {
    const batch = db.batch();
    toEnrich.slice(i, i + 500).forEach(doc => {
      const dexNum = doc.data().nationalDexNumber as number;
      const family = evoRunCache.get(dexNum) ?? [dexNum];
      batch.update(doc.ref, { evolutionFamily: family });
    });
    await batch.commit();
  }

  // Prüfen ob noch mehr zu tun ist
  const remaining = snap.docs.filter(d => !d.data().evolutionFamily).length - toEnrich.length;
  const done = remaining <= 0 && snap.docs.length <= batchSize;

  return {
    status: done ? 'complete' : 'in-progress',
    message: done
      ? `✅ Evolutionsdaten vollständig (${toEnrich.length} Karten angereichert)`
      : `📥 ${toEnrich.length} Karten angereichert — weitere vorhanden`,
    enriched: toEnrich.length,
    remaining: Math.max(0, remaining),
  };
}

// ── Deutsche Namen-Anreicherung via TCGdex ────────────────────────────────
// Holt deutsche Kartennamen set-weise von TCGdex und schreibt nameDe + nameDeLower.

interface TcgdexCard { localId: string; name: string; }
interface TcgdexSet  { cards?: TcgdexCard[]; }

const tcgdexSetCache = new Map<string, Map<string, string>>(); // tcgdexSetId → localId → nameDe

async function fetchDeNamesForSet(tcgdexSetId: string): Promise<Map<string, string>> {
  if (tcgdexSetCache.has(tcgdexSetId)) return tcgdexSetCache.get(tcgdexSetId)!;
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/de/sets/${tcgdexSetId}`);
    if (!res.ok) { tcgdexSetCache.set(tcgdexSetId, new Map()); return new Map(); }
    const data: TcgdexSet = await res.json();
    const map = new Map<string, string>();
    (data.cards ?? []).forEach(c => {
      // localId kann führende Nullen haben (z.B. "001") → normalisieren
      const normalized = String(parseInt(c.localId) || 0) || c.localId;
      map.set(c.localId, c.name);
      map.set(normalized, c.name);
    });
    tcgdexSetCache.set(tcgdexSetId, map);
    return map;
  } catch {
    tcgdexSetCache.set(tcgdexSetId, new Map());
    return new Map();
  }
}

export interface EnrichDeNamesResult {
  status: 'complete' | 'in-progress' | 'up-to-date';
  message: string;
  enriched: number;
  remaining: number;
}

export async function enrichGermanNames(batchSize = 500): Promise<EnrichDeNamesResult> {
  const db = getAdminDb();

  // Nur Karten ohne nameDe — where('nameDe', '==', null) matcht fehlende + null-Felder
  const snap = await db.collection(COL)
    .where('nameDe', '==', null)
    .limit(batchSize)
    .get();

  if (snap.empty) {
    return { status: 'up-to-date', message: 'Alle deutschen Namen sind bereits vorhanden', enriched: 0, remaining: 0 };
  }

  const toEnrich = snap.docs;

  // Distinct setIds dieser Batch
  const setIds = [...new Set(toEnrich.map(d => (d.data() as CatalogCard).setId))];

  // Deutsche Namen set-weise holen (max 8 parallel)
  const CONCURRENCY = 8;
  for (let i = 0; i < setIds.length; i += CONCURRENCY) {
    await Promise.all(setIds.slice(i, i + CONCURRENCY).map(id => fetchDeNamesForSet(toTcgdexId(id))));
  }

  // Batch-Update
  let enriched = 0;
  for (let i = 0; i < toEnrich.length; i += 500) {
    const batch = db.batch();
    toEnrich.slice(i, i + 500).forEach(doc => {
      const card = doc.data() as CatalogCard;
      const tcgdexId = toTcgdexId(card.setId);
      const nameMap = tcgdexSetCache.get(tcgdexId);
      if (!nameMap) return;
      // Kartennummer normalisieren (z.B. "049/198" → "49", "001" → "1")
      const rawNum  = card.number.split('/')[0];
      const normNum = String(parseInt(rawNum) || 0) || rawNum;
      const nameDe  = nameMap.get(rawNum) ?? nameMap.get(normNum);
      if (nameDe) {
        batch.update(doc.ref, { nameDe, nameDeLower: nameDe.toLowerCase() });
        enriched++;
      }
    });
    await batch.commit();
  }

  // Wenn wir batchSize Docs bekommen haben, gibt es wahrscheinlich noch mehr
  const hasMore = toEnrich.length === batchSize;
  return {
    status: hasMore ? 'in-progress' : 'complete',
    message: hasMore
      ? `📥 ${enriched} Karten angereichert — weitere vorhanden`
      : `✅ Deutsche Namen vollständig (${enriched} Karten angereichert)`,
    enriched,
    remaining: hasMore ? -1 : 0, // -1 = unbekannt aber vorhanden
  };
}

export async function getSyncStatus() {
  const meta = await getMeta();
  const currentTotal = await fetchCurrentTotal();
  const syncedTotal = meta?.syncedTotal ?? 0;
  return {
    ...(meta ?? { lastPage: 0, totalPages: 0, lastSynced: null }),
    syncedTotal,
    currentTotal,
    newCards: Math.max(0, currentTotal - syncedTotal),
  };
}
