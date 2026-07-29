import { getAdminDb } from './firebase/admin';
import { FieldPath } from 'firebase-admin/firestore';
import type { CatalogCard, SyncMeta } from './firestore/catalog';
import { CATEGORIES, PAGE_SIZE, fetchEnCardsPage, fetchDeNamesForSet, toCatalogCard } from './tcgdex-source';

const MAX_PAGES_PER_REQUEST = 4;   // ~1000 Karten pro Aufruf — resumierbar via Meta-Cursor
const COL = 'tcg_catalog';
const META_COL = 'tcg_catalog_meta';

/** Gesamt-Kartenzahl (Schätzung fürs Fortschritts-%): Summe `total` aller Sets. */
async function catalogTotalFromSets(): Promise<number> {
  const db = getAdminDb();
  const snap = await db.collection('tcg_sets').get();
  let total = 0;
  snap.forEach(d => { total += (d.data().total as number) ?? 0; });
  return total;
}

/** Set-ID → { series, setCode } aus tcg_sets — zum Anreichern jeder Karte
 *  (das Karten-`set`-Objekt liefert weder Serie noch gedrucktes Kürzel). */
async function loadSetsMeta(): Promise<Map<string, { series: string; setCode?: string }>> {
  const db = getAdminDb();
  const snap = await db.collection('tcg_sets').get();
  const m = new Map<string, { series: string; setCode?: string }>();
  snap.forEach(d => {
    const s = d.data();
    m.set(d.id, { series: (s.series as string) ?? '', setCode: s.ptcgoCode as string | undefined });
  });
  return m;
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

/**
 * Voll-Import des Katalogs aus TCGdex — resumierbar über einen Meta-Cursor
 * (`catIndex` = Kategorie-Index, `page` = Seite darin). Pro Aufruf werden
 * `MAX_PAGES_PER_REQUEST` Seiten verarbeitet (Vercel-Timeout-schonend); der
 * Cron/Settings-Aufruf ruft wiederholt, bis `done`.
 *
 * `mode`:
 *  - `reset`  → Cursor auf Anfang (leert NICHT die Docs — das macht der P0-Reset).
 *  - `auto`/`update` → vom Cursor aus weiterlaufen (idempotenter Upsert). Für einen
 *    kompletten Neu-Import erst `reset`, dann wiederholt `auto` bis `done`.
 */
export async function runSync(mode: 'auto' | 'update' | 'reset' = 'auto'): Promise<SyncResult> {
  const nowIso = new Date().toISOString();

  if (mode === 'reset') {
    await setMeta({ catIndex: 0, page: 1, syncedTotal: 0, bootstrapped: false, lastSynced: nowIso });
    return { status: 'in-progress', message: '↺ Katalog-Cursor zurückgesetzt', syncedTotal: 0, done: false };
  }

  const meta = await getMeta();
  let catIndex = meta?.catIndex ?? 0;
  let page = meta?.page ?? 1;
  let syncedTotal = meta?.syncedTotal ?? 0;

  const currentTotal = await catalogTotalFromSets();

  if (catIndex >= CATEGORIES.length) {
    await setMeta({ bootstrapped: true, lastSynced: nowIso });
    return { status: 'up-to-date', message: `Alle ${syncedTotal.toLocaleString()} Karten aktuell`, syncedTotal, currentTotal, done: true };
  }

  const setsMeta = await loadSetsMeta();
  const deCache = new Map<string, Map<string, string>>(); // setId → localId→dt.Name (pro Aufruf)
  let written = 0;

  for (let i = 0; i < MAX_PAGES_PER_REQUEST && catIndex < CATEGORIES.length; i++) {
    const category = CATEGORIES[catIndex];
    const enCards = await fetchEnCardsPage(category, page);
    if (enCards.length === 0) { catIndex++; page = 1; continue; }

    const cards: CatalogCard[] = [];
    for (const en of enCards) {
      const setId = en.set?.id ?? '';
      if (setId && !deCache.has(setId)) deCache.set(setId, await fetchDeNamesForSet(setId));
      const deName = setId ? deCache.get(setId)?.get(en.localId) : undefined;
      const sm = setsMeta.get(setId);
      cards.push(toCatalogCard(en, deName, { series: sm?.series, setCode: sm?.setCode }));
    }
    await upsertBatch(cards);
    written += cards.length;
    syncedTotal += cards.length;

    if (enCards.length < PAGE_SIZE) { catIndex++; page = 1; } else { page++; }
    await setMeta({ catIndex, page, syncedTotal, currentTotal, lastSynced: nowIso });
  }

  const done = catIndex >= CATEGORIES.length;
  if (done) await setMeta({ bootstrapped: true });
  return {
    status: done ? 'complete' : 'in-progress',
    message: done
      ? `✅ Katalog vollständig (${syncedTotal.toLocaleString()} Karten)`
      : `📥 ${syncedTotal.toLocaleString()} / ${currentTotal.toLocaleString()} Karten…`,
    written,
    syncedTotal,
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

// Cursor-Dokument merkt sich die zuletzt bearbeitete Karten-ID zwischen
// einzelnen Aufrufen (Settings-Button feuert wiederholt POST-Requests, jeder
// Request ist eine neue Function-Invocation ohne gemeinsamen Speicher).
// Vorher: Query ohne orderBy/startAfter las bei jedem Aufruf dieselben ersten
// `batchSize` Dokumente (Firestore ordnet implizit nach Dokument-ID) — nach
// deren erster Anreicherung lieferte der `!evolutionFamily`-Filter dort immer
// 0 Treffer, der Lauf meldete fälschlich "complete", der Rest des Katalogs
// wurde nie erreicht.
const EVO_CURSOR_DOC = 'sync_state/evolutionEnrichment';

export async function enrichEvolutionFamilies(batchSize = 500): Promise<EnrichResult> {
  const db = getAdminDb();
  const cursorRef = db.doc(EVO_CURSOR_DOC);
  const cursorSnap = await cursorRef.get();
  const lastId = cursorSnap.exists ? (cursorSnap.data()?.lastId as string | undefined) : undefined;

  // Firestore verlangt bei einer Ungleichheits-Filterung, dass die erste
  // orderBy-Klausel auf demselben Feld liegt — __name__ nur als Tie-Breaker danach.
  let q = db.collection(COL)
    .where('nationalDexNumber', '>', 0)
    .orderBy('nationalDexNumber')
    .orderBy('__name__')
    .limit(batchSize);

  if (lastId) {
    const lastDocSnap = await db.collection(COL).doc(lastId).get();
    if (lastDocSnap.exists) q = q.startAfter(lastDocSnap);
  }

  const snap = await q.get();

  if (snap.empty) {
    await cursorRef.delete().catch(() => {});
    return { status: 'complete', message: '✅ Evolutionsdaten vollständig durchlaufen', enriched: 0, remaining: 0 };
  }

  // Unique Pokédex-Nummern sammeln
  const uniqueDexNums = [...new Set(snap.docs.map(d => d.data().nationalDexNumber as number))];

  // Evolutionsketten parallel (max 8 gleichzeitig) abrufen
  const CONCURRENCY = 8;
  for (let i = 0; i < uniqueDexNums.length; i += CONCURRENCY) {
    await Promise.all(uniqueDexNums.slice(i, i + CONCURRENCY).map(fetchEvoFamily));
  }

  // Batch-Update — unabhängig davon, ob evolutionFamily schon gesetzt war
  // (idempotent, Cursor garantiert ohnehin, dass jede Karte nur einmal drankommt).
  const batch = db.batch();
  snap.docs.forEach(doc => {
    const dexNum = doc.data().nationalDexNumber as number;
    const family = evoRunCache.get(dexNum) ?? [dexNum];
    batch.update(doc.ref, { evolutionFamily: family });
  });
  await batch.commit();

  const done = snap.docs.length < batchSize;
  const newLastId = snap.docs[snap.docs.length - 1].id;
  if (done) {
    await cursorRef.delete().catch(() => {});
  } else {
    await cursorRef.set({ lastId: newLastId });
  }

  return {
    status: done ? 'complete' : 'in-progress',
    message: done
      ? `✅ Evolutionsdaten vollständig (${snap.docs.length} Karten im letzten Batch)`
      : `📥 ${snap.docs.length} Karten angereichert — weitere vorhanden`,
    enriched: snap.docs.length,
    remaining: 0,
  };
}

// ── Sets-Sync ──────────────────────────────────────────────────────────────
// Holt alle Sets von pokemontcg.io + DE-Namen von TCGdex → schreibt in tcg_sets.

export interface SyncSetsResult {
  status: 'complete' | 'error';
  message: string;
  synced: number;
}

interface TcgdexFullSet {
  id: string;
  name: string;
  releaseDate?: string;
  serie?: { id: string; name: string } | null;
  abbreviation?: { official?: string } | null;
  tcgOnline?: string | null;
  cardCount?: { official?: number; total?: number };
  logo?: string;
  symbol?: string;
}

const TCGDEX_REST = 'https://api.tcgdex.net/v2';

export async function syncSets(): Promise<SyncSetsResult> {
  const db = getAdminDb();

  // 1. Set-Listen (EN für IDs, DE für dt. Namen/Logos). Symbol/Logo sind
  //    Basis-URLs OHNE Endung → `.png` anhängen.
  let enList: Array<{ id: string }>;
  try {
    const enRes = await fetch(`${TCGDEX_REST}/en/sets`);
    if (!enRes.ok) return { status: 'error', message: `TCGdex /en/sets HTTP ${enRes.status}`, synced: 0 };
    enList = await enRes.json();
  } catch (e) {
    return { status: 'error', message: `TCGdex /en/sets: ${e instanceof Error ? e.message : String(e)}`, synced: 0 };
  }
  const deMap = new Map<string, { name: string; logo?: string }>();
  try {
    const deRes = await fetch(`${TCGDEX_REST}/de/sets`);
    if (deRes.ok) {
      const deSets: Array<{ id: string; name: string; logo?: string }> = await deRes.json();
      for (const s of deSets) deMap.set(s.id, { name: s.name, logo: s.logo });
    }
  } catch { /* kein DE → Fallback EN */ }

  // 2. Voll-Objekt je Set (abbreviation/serie/releaseDate/cardCount/logo/symbol)
  //    — nur dort steht das gedruckte Kürzel. Gechunkte Parallelität für ~218 Sets.
  const ids = (enList ?? []).map(s => s.id);
  const full: TcgdexFullSet[] = [];
  const CHUNK = 15;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = await Promise.all(ids.slice(i, i + CHUNK).map(id =>
      fetch(`${TCGDEX_REST}/en/sets/${id}`)
        .then(r => (r.ok ? r.json() as Promise<TcgdexFullSet> : null))
        .catch(() => null),
    ));
    for (const f of part) if (f) full.push(f);
  }

  // 3. Dokumente (TCGdex-native ID). `ptcgoCode` = gedrucktes Kürzel
  //    (abbreviation.official), sonst der Online-Code (tcgOnline).
  const withExt = (base?: string | null) => (base ? `${base}.png` : undefined);
  const docs = full.map(s => {
    const de = deMap.get(s.id);
    const code = s.abbreviation?.official ?? s.tcgOnline ?? undefined;
    return {
      id: s.id,
      name: s.name,
      ...(de?.name ? { nameDe: de.name } : {}),
      series: s.serie?.name ?? '',
      total: s.cardCount?.total ?? 0,
      printedTotal: s.cardCount?.official ?? 0,
      ...(code ? { ptcgoCode: code } : {}),
      logoUrl: withExt(de?.logo ?? s.logo) ?? '',
      ...(s.logo ? { logoUrlEn: withExt(s.logo) } : {}),
      ...(s.symbol ? { symbolUrl: withExt(s.symbol) } : {}),
      ...(s.releaseDate ? { releaseDate: s.releaseDate } : {}),
    };
  });

  // 4. In Firestore schreiben
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    docs.slice(i, i + 500).forEach(s => {
      batch.set(db.collection('tcg_sets').doc(s.id), s, { merge: true });
    });
    await batch.commit();
  }

  return { status: 'complete', message: `✅ ${docs.length} Sets synchronisiert`, synced: docs.length };
}

// ── Pokémon-Artdaten-Anreicherung via PokéAPI ──────────────────────────────
// Holt genus, flavorText, height, weight, region pro nationalDexNumber und
// schreibt sie in alle zugehörigen Catalog-Karten (einmalig).

interface SpeciesData {
  genusDe: string;
  flavorTextDe: string;
  heightDm: number;
  weightHg: number;
  region: string;
}

const GENERATION_REGIONS: Record<string, string> = {
  '1': 'Kanto', '2': 'Johto',  '3': 'Hoenn',  '4': 'Sinnoh',
  '5': 'Einall', '6': 'Kalos', '7': 'Alola',  '8': 'Galar', '9': 'Paldea',
};

const speciesRunCache = new Map<number, SpeciesData | null>();

async function fetchSpeciesForDex(dexNum: number): Promise<SpeciesData | null> {
  if (speciesRunCache.has(dexNum)) return speciesRunCache.get(dexNum)!;
  try {
    const [sRes, pRes] = await Promise.all([
      fetch(`https://pokeapi.co/api/v2/pokemon-species/${dexNum}`, { signal: AbortSignal.timeout(6000) }),
      fetch(`https://pokeapi.co/api/v2/pokemon/${dexNum}`,         { signal: AbortSignal.timeout(6000) }),
    ]);
    if (!sRes.ok) { speciesRunCache.set(dexNum, null); return null; }
    const sd = await sRes.json();

    const genusDe = sd.genera
      ?.find((g: { language: { name: string }; genus: string }) => g.language.name === 'de')
      ?.genus ?? '';
    const flavorTextDe = [...(sd.flavor_text_entries ?? [])]
      .filter((e: { language: { name: string }; flavor_text: string }) => e.language.name === 'de')
      .pop()
      ?.flavor_text?.replace(/[\f\n]/g, ' ') ?? '';
    const generationId = sd.generation?.url?.split('/').filter(Boolean).pop() ?? '';
    const region = GENERATION_REGIONS[generationId] ?? '';

    let heightDm = 0, weightHg = 0;
    if (pRes.ok) {
      const pd = await pRes.json();
      heightDm = pd.height ?? 0;
      weightHg = pd.weight ?? 0;
    }

    const result: SpeciesData = { genusDe, flavorTextDe, heightDm, weightHg, region };
    speciesRunCache.set(dexNum, result);
    return result;
  } catch {
    speciesRunCache.set(dexNum, null);
    return null;
  }
}

export interface EnrichSpeciesResult {
  status: 'complete' | 'in-progress' | 'up-to-date';
  message: string;
  enriched: number;
  remaining: number;
}

export async function enrichSpeciesData(batchSize = 500): Promise<EnrichSpeciesResult> {
  const db = getAdminDb();

  const cursorRef = db.doc('tcg_catalog_meta/species_cursor');
  const cursorSnap = await cursorRef.get();
  const lastDocId: string = cursorSnap.exists ? (cursorSnap.data()?.lastDocId ?? '') : '';

  let q = db.collection(COL)
    .orderBy(FieldPath.documentId())
    .limit(batchSize + 1);

  if (lastDocId) {
    const lastDoc = await db.doc(`${COL}/${lastDocId}`).get();
    if (lastDoc.exists) q = q.startAfter(lastDoc) as typeof q;
  }

  const snap = await q.get();

  if (snap.empty) {
    await cursorRef.delete();
    return { status: 'complete', message: '✅ Alle Pokémon-Artdaten sind angereichert', enriched: 0, remaining: 0 };
  }

  const hasMore = snap.docs.length > batchSize;
  const toEnrich = snap.docs
    .slice(0, batchSize)
    .filter(d => { const data = d.data(); return data.nationalDexNumber && !data.genusDe; });

  if (toEnrich.length > 0) {
    const uniqueDexNums = [...new Set(toEnrich.map(d => d.data().nationalDexNumber as number))];
    const CONCURRENCY = 8;
    for (let i = 0; i < uniqueDexNums.length; i += CONCURRENCY) {
      await Promise.all(uniqueDexNums.slice(i, i + CONCURRENCY).map(fetchSpeciesForDex));
    }

    for (let i = 0; i < toEnrich.length; i += 500) {
      const batch = db.batch();
      toEnrich.slice(i, i + 500).forEach(doc => {
        const species = speciesRunCache.get(doc.data().nationalDexNumber as number);
        if (species) batch.update(doc.ref, species as unknown as Record<string, unknown>);
      });
      await batch.commit();
    }
  }

  const lastDoc = snap.docs[batchSize - 1] ?? snap.docs[snap.docs.length - 1];
  if (hasMore) {
    await cursorRef.set({ lastDocId: lastDoc.id });
  } else {
    await cursorRef.delete();
  }

  return {
    status: hasMore ? 'in-progress' : 'complete',
    message: hasMore
      ? `📥 ${toEnrich.length} Artdaten angereichert — weitere vorhanden`
      : `✅ Pokémon-Artdaten vollständig (${toEnrich.length} Karten angereichert)`,
    enriched: toEnrich.length,
    remaining: hasMore ? -1 : 0,
  };
}

export async function getSyncStatus() {
  const meta = await getMeta();
  const currentTotal = await catalogTotalFromSets();
  const syncedTotal = meta?.syncedTotal ?? 0;
  return {
    ...(meta ?? { lastPage: 0, totalPages: 0, lastSynced: null, bootstrapped: false }),
    syncedTotal,
    currentTotal,
    newCards: Math.max(0, currentTotal - syncedTotal),
  };
}
