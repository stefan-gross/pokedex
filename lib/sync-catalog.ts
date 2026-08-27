import { getAdminDb } from './firebase/admin';
import { FieldPath } from 'firebase-admin/firestore';
import type { CatalogCard, SyncMeta } from './firestore/catalog';
import { CATEGORIES, PAGE_SIZE, fetchEnCardsPage, fetchDeCardsForSet, toCatalogCard,
         fetchSetCardIds, fetchEnCardsByIds, fetchCardMechanics, tcgdexImage,
         type DeCardInfo, type CardMechanicsData } from './tcgdex-source';

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
    // Cursor am Ende: normalerweise fertig. Sind laut Set-Definitionen aber mehr
    // Karten verfügbar als importiert (neue Sets/Karten bei TCGdex) UND für diesen
    // Gesamtstand wurde noch kein Nachzieh-Resync gestartet → Cursor zurücksetzen
    // und komplett neu durchlaufen (upsert idempotent). `resyncedForTotal` merkt
    // sich den Stand, sodass ein dauerhafter Phantom-Rest (currentTotal bleibt
    // > syncedTotal) KEINEN Endlos-Resync auslöst — nur ein weiteres Wachstum tut es.
    if (currentTotal > syncedTotal && (meta?.resyncedForTotal ?? 0) !== currentTotal) {
      catIndex = 0; page = 1; syncedTotal = 0;
      await setMeta({ catIndex, page, syncedTotal, resyncedForTotal: currentTotal, lastSynced: nowIso });
      // fällt durch zum Import-Loop unten
    } else {
      await setMeta({ bootstrapped: true, lastSynced: nowIso });
      return { status: 'up-to-date', message: `Alle ${syncedTotal.toLocaleString()} Karten aktuell`, syncedTotal, currentTotal, done: true };
    }
  }

  const setsMeta = await loadSetsMeta();
  const excludedSetIds = await fetchExcludedSetIds(); // z.B. Pokémon TCG Pocket
  const deCache = new Map<string, Map<string, DeCardInfo>>(); // setId → localId→DE-Info (pro Aufruf)
  let written = 0;

  for (let i = 0; i < MAX_PAGES_PER_REQUEST && catIndex < CATEGORIES.length; i++) {
    const category = CATEGORIES[catIndex];
    const enCards = await fetchEnCardsPage(category, page);
    if (enCards.length === 0) { catIndex++; page = 1; continue; }

    const cards: CatalogCard[] = [];
    for (const en of enCards) {
      const setId = en.set?.id ?? '';
      // Ausgeschlossene Serie (z.B. Pokémon TCG Pocket) — nicht in den Katalog.
      if (setId && excludedSetIds.has(setId)) continue;
      if (setId && !deCache.has(setId)) deCache.set(setId, (await fetchDeCardsForSet(setId)) ?? new Map());
      const de = setId ? deCache.get(setId)?.get(en.localId) : undefined;
      const sm = setsMeta.get(setId);
      cards.push(toCatalogCard(en, de, { series: sm?.series, setCode: sm?.setCode }));
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

// ── Delta-Sync: nur NEUE Karten holen ──────────────────────────────────────
export interface SyncNewResult {
  status: 'complete' | 'in-progress' | 'error';
  added: number;
  checkedSets: number;
  deficientSets: number;
  done: boolean;
  message: string;
}

/** Gezieltes Nachziehen: pro Set lokale Kartenzahl vs. Set-`total` vergleichen,
 *  für defizitäre Sets nur die tatsächlich FEHLENDEN Karten-IDs (Set-Endpunkt vs.
 *  lokale IDs) mit vollen Feldern holen und upserten. Weitaus günstiger als der
 *  komplette Re-Import. Kappt bei MAX_ADD Karten pro Aufruf (done:false → Button
 *  ruft erneut). */
export async function syncNewCards(): Promise<SyncNewResult> {
  const nowIso = new Date().toISOString();
  const db = getAdminDb();
  const MAX_ADD = 800;

  const setsSnap = await db.collection('tcg_sets').get();
  // Parallel: lokale Kartenzahl je Set (count()-Aggregation, günstig).
  const counts = await Promise.all(setsSnap.docs.map(async d => {
    const c = await db.collection('tcg_catalog').where('setId', '==', d.id).count().get();
    return { setId: d.id, total: (d.data().total as number) ?? 0, local: c.data().count };
  }));
  const deficient = counts.filter(x => x.local < x.total);

  const setsMeta = await loadSetsMeta();
  let added = 0;
  let hitCap = false;

  for (const { setId } of deficient) {
    if (added >= MAX_ADD) { hitCap = true; break; }
    const remoteIds = await fetchSetCardIds(setId);
    if (remoteIds.length === 0) continue;
    const localSnap = await db.collection('tcg_catalog').where('setId', '==', setId).select().get();
    const localIds = new Set(localSnap.docs.map(d => d.id));
    const missing = remoteIds.filter(id => !localIds.has(id)).slice(0, MAX_ADD - added);
    if (missing.length === 0) continue; // Defizit ist „Phantom" (Set-total > gelistet)

    const enCards = await fetchEnCardsByIds(missing);
    const deCards = (await fetchDeCardsForSet(setId)) ?? new Map();
    const sm = setsMeta.get(setId);
    const cards = enCards.map(en => toCatalogCard(en, deCards.get(en.localId), { series: sm?.series, setCode: sm?.setCode }));
    await upsertBatch(cards);
    added += cards.length;
  }

  // syncedTotal auf die echte Katalog-Anzahl setzen (eine count()-Aggregation)
  // → „neue Karten verfügbar" spiegelt danach den realen Stand.
  const realCount = (await db.collection('tcg_catalog').count().get()).data().count;
  const currentTotal = await catalogTotalFromSets();
  // Bei einem VOLLSTÄNDIGEN Lauf (nicht gekappt) ist alles Einlesbare drin — die
  // verbleibende Lücke ist per Definition Phantom (in Set-Listen genannt, aber
  // via GraphQL nicht holbar). Als Grundwert merken, damit sie nicht als „neue
  // Karten" erscheint; ein gekappter Lauf lässt den Wert unangetastet.
  // lastChecked = jede Prüfung; lastSynced NUR, wenn wirklich Karten dazukamen.
  const metaUpdate: Partial<SyncMeta> = { syncedTotal: realCount, currentTotal, lastChecked: nowIso };
  if (added > 0) metaUpdate.lastSynced = nowIso;
  if (!hitCap) metaUpdate.phantomTotal = Math.max(0, currentTotal - realCount);
  await setMeta(metaUpdate);

  return {
    status: hitCap ? 'in-progress' : 'complete',
    added,
    checkedSets: counts.length,
    deficientSets: deficient.length,
    done: !hitCap,
    message: hitCap ? `📥 ${added} neue Karten (weitere folgen)…`
      : added ? `✅ ${added} neue Karten geholt` : '✅ Keine neuen Karten',
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
// Holt alle Sets von TCGdex (EN+DE) → schreibt in tcg_sets.

export interface SyncSetsResult {
  status: 'complete' | 'error';
  message: string;
  synced: number;
  prunedSets?: number;
  prunedCards?: number;
}

interface TcgdexFullSet {
  id: string;
  name: string;
  releaseDate?: string;
  serie?: { id: string; name: string } | null;
  abbreviation?: { official?: string } | null;
  tcgOnline?: string | null;
  cardCount?: { official?: number; total?: number };
  cards?: { id: string }[];   // vom /en/sets/{id}-Endpunkt: tatsächlich gelistete Karten
  logo?: string;
  symbol?: string;
}

const TCGDEX_REST = 'https://api.tcgdex.net/v2';

/** Serien, die NICHT in den Katalog gehören. „Pokémon TCG Pocket" ist ein
 *  separates Mobile-Game (eigene Karten, nur EN, keine echten Sammelkarten) —
 *  bewusst ausgeschlossen, sonst tauchen die Karten in Suche/Browse als
 *  Fremdkörper auf und der nächste Sync würde gelöschte wieder anlegen. */
const EXCLUDED_SERIES = new Set(['Pokémon TCG Pocket']);

/** Set-IDs, die zu einer ausgeschlossenen Serie (EXCLUDED_SERIES) gehören, über
 *  den TCGdex-`/series`-Endpunkt aufgelöst. Der Voll-Import (`runSync`) holt
 *  Karten nach `category` (ohne Serien-Info) und muss diese Sets daher aktiv
 *  überspringen — sonst landeten z.B. die rein digitalen Pokémon-TCG-Pocket-
 *  Karten wieder im Katalog. (Der Delta-Sync iteriert nur über `tcg_sets`, wo
 *  diese Serien ohnehin fehlen, und ist damit schon sauber.) */
async function fetchExcludedSetIds(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const res = await fetch(`${TCGDEX_REST}/en/series`);
    if (!res.ok) return out;
    const series: Array<{ id: string; name: string }> = await res.json();
    const ids = series.filter(s => EXCLUDED_SERIES.has(s.name)).map(s => s.id);
    for (const sid of ids) {
      const r = await fetch(`${TCGDEX_REST}/en/series/${sid}`);
      if (!r.ok) continue;
      const detail: { sets?: Array<{ id: string }> } = await r.json();
      for (const set of detail.sets ?? []) out.add(set.id);
    }
  } catch { /* im Zweifel nichts ausschließen — der Set-Sync filtert weiterhin */ }
  return out;
}

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
  const docs = full
    .filter(s => !EXCLUDED_SERIES.has(s.serie?.name ?? ''))
    .map(s => {
    const de = deMap.get(s.id);
    const code = s.abbreviation?.official ?? s.tcgOnline ?? undefined;
    return {
      id: s.id,
      name: s.name,
      ...(de?.name ? { nameDe: de.name } : {}),
      series: s.serie?.name ?? '',
      // total = tatsächlich von TCGdex GELISTETE Karten (cards.length), NICHT
      // cardCount.total: letzteres zählt Secret-Rare-Slots mit, zu denen TCGdex
      // gar keine Karte liefert (~302 Phantom app-weit) → sonst zeigt „neue Karten
      // verfügbar" dauerhaft eine Zahl, die kein Sync je schließen kann.
      total: s.cards?.length ?? s.cardCount?.total ?? 0,
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

  // 5. Veraltete Sets prunen: alles in tcg_sets, das TCGdex NICHT mehr listet
  //    (z.B. das alte Duplikat swsh12.5tg). `ids` = alle aktuell von TCGdex
  //    gelieferten Set-IDs (inkl. ausgeschlossener Serien → die gelten als
  //    „existiert", werden also NICHT gelöscht; nur wirklich Entferntes fliegt).
  let prunedSets = 0, prunedCards = 0;
  const validIds = new Set(ids);
  if (validIds.size > 0) {                                  // leere Liste = kaputte Antwort → nie prunen
    const existing = await db.collection('tcg_sets').select().get();
    const stale = existing.docs.map(d => d.id).filter(id => !validIds.has(id));
    // Sicherheitskappe: eine legitime Bereinigung betrifft 0–2 Sets. Viele
    // „verwaiste" IDs deuten auf eine unvollständige TCGdex-Antwort → NICHT löschen.
    if (stale.length > 10) {
      console.warn(`[syncSets] Prune übersprungen: ${stale.length} Sets gälten als veraltet (verdächtig viel) → [${stale.join(', ')}]`);
    } else {
      for (const setId of stale) {
        for (;;) {
          const snap = await db.collection('tcg_catalog').where('setId', '==', setId).limit(400).get();
          if (snap.empty) break;
          const b = db.batch();
          snap.docs.forEach(d => b.delete(d.ref));
          await b.commit();
          prunedCards += snap.size;
          if (snap.size < 400) break;
        }
        await db.collection('tcg_sets').doc(setId).delete();
        prunedSets++;
        console.log(`[syncSets] veraltetes Set gelöscht: ${setId}`);
      }
    }
  }

  const pruneMsg = prunedSets ? ` · ${prunedSets} veraltete Sets (${prunedCards} Karten) entfernt` : '';
  return {
    status: 'complete',
    message: `✅ ${docs.length} Sets synchronisiert${pruneMsg}`,
    synced: docs.length,
    prunedSets, prunedCards,
  };
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

/**
 * TCG-Kartenmechanik (Effekt/Trainer-Typ/Attacken/Fähigkeiten/Schwäche/Resistenz/
 * Rückzug) pro Karte per REST `/de/cards/{id}` (Fallback `/en/`) nachziehen —
 * Texte deutsch, Energietypen kanonisch EN. Bewusst NICHT im Bulk-GraphQL (der
 * bricht bei Karten mit null-Attackennamen). Cursor über Karten-IDs,
 * `mechanicsDone`-Flag gegen Doppelabrufe; transienter Fehler → nächster Lauf.
 */
export async function enrichCardMechanics(batchSize = 150): Promise<EnrichSpeciesResult> {
  const db = getAdminDb();
  const cursorRef = db.doc('tcg_catalog_meta/mechanics_cursor');
  const cursorSnap = await cursorRef.get();
  const lastDocId: string = cursorSnap.exists ? (cursorSnap.data()?.lastDocId ?? '') : '';

  let q = db.collection(COL).orderBy(FieldPath.documentId()).limit(batchSize + 1);
  if (lastDocId) {
    const lastDoc = await db.doc(`${COL}/${lastDocId}`).get();
    if (lastDoc.exists) q = q.startAfter(lastDoc) as typeof q;
  }
  const snap = await q.get();
  if (snap.empty) {
    await cursorRef.delete();
    return { status: 'complete', message: '✅ Alle Kartenmechaniken sind angereichert', enriched: 0, remaining: 0 };
  }

  const hasMore = snap.docs.length > batchSize;
  const pageDocs = snap.docs.slice(0, batchSize);
  const todo = pageDocs.filter(d => !d.data().mechanicsDone);

  let enriched = 0;
  if (todo.length > 0) {
    const CONCURRENCY = 8;
    const byId = new Map<string, CardMechanicsData | null>();
    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      const chunk = todo.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(d => fetchCardMechanics(d.id)));
      chunk.forEach((d, j) => byId.set(d.id, results[j]));
    }

    for (let i = 0; i < todo.length; i += 400) {
      const batch = db.batch();
      todo.slice(i, i + 400).forEach(doc => {
        const m = byId.get(doc.id);
        if (m === null) return;                         // transient → nächster Voll-Lauf
        batch.update(doc.ref, { ...(m as Record<string, unknown>), mechanicsDone: true });
        enriched++;
      });
      await batch.commit();
    }
  }

  const lastDoc = pageDocs[pageDocs.length - 1];
  if (hasMore) await cursorRef.set({ lastDocId: lastDoc.id });
  else await cursorRef.delete();

  return {
    status: hasMore ? 'in-progress' : 'complete',
    message: hasMore
      ? `📥 ${enriched} Kartenmechaniken angereichert — weitere vorhanden`
      : `✅ Kartenmechaniken vollständig (${enriched} in diesem Lauf)`,
    enriched,
    remaining: hasMore ? -1 : 0,
  };
}

/**
 * Reconcile der deutschen Daten für BESTEHENDE Katalogkarten gegen die echte
 * Quelle `/de/sets/{id}`:
 *  - fehlenden `nameDe` ergänzen,
 *  - `hasDeImage` (Bool) setzen = „ein deutsches Bild ist verfügbar": entweder
 *    selbst gehostet (`deImageSource` gesetzt, z. B. pokewiki) ODER TCGdex hat
 *    ein echtes DE-Bild (`/de/sets` liefert `image`; wird beim Lesen abgeleitet).
 *
 * WICHTIG: `imgLargeDe`/`imgSmallDe` werden NIE geschrieben oder gelöscht — diese
 * Felder halten ausschließlich selbst gehostete Backfill-URLs (pokewiki, Storage),
 * die laut Design (Projekt-Memory) von keinem Sync überschrieben werden dürfen.
 * Die TCGdex-DE-URL wird beim LESEN abgeleitet (`deImageUrl`, /en/→/de/).
 * Set-weise, Cursor über Set-IDs, gekappt. Transienter Fehler (fetch → null) →
 * Set überspringen.
 */
export async function enrichDeData(setsPerCall = 12): Promise<EnrichSpeciesResult> {
  const db = getAdminDb();

  const cursorRef = db.doc('tcg_catalog_meta/de_cursor');
  const cursorSnap = await cursorRef.get();
  const lastSetId: string = cursorSnap.exists ? (cursorSnap.data()?.lastSetId ?? '') : '';

  let q = db.collection('tcg_sets').orderBy(FieldPath.documentId()).limit(setsPerCall + 1);
  if (lastSetId) {
    const lastDoc = await db.doc(`tcg_sets/${lastSetId}`).get();
    if (lastDoc.exists) q = q.startAfter(lastDoc) as typeof q;
  }
  const setsSnap = await q.get();

  if (setsSnap.empty) {
    await cursorRef.delete();
    return { status: 'complete', message: '✅ Deutsche Namen/Bilder vollständig', enriched: 0, remaining: 0 };
  }

  const hasMore = setsSnap.docs.length > setsPerCall;
  const setDocs = setsSnap.docs.slice(0, setsPerCall);
  let enriched = 0;

  for (const setDoc of setDocs) {
    const setId = setDoc.id;

    // Echte DE-Quelle. null = transienter Fehler → Set überspringen (nicht bereinigen).
    const deCards = await fetchDeCardsForSet(setId);
    if (deCards === null) continue;

    const cardsSnap = await db.collection(COL).where('setId', '==', setId).get();

    const batch = db.batch();
    let inBatch = 0;
    for (const doc of cardsSnap.docs) {
      const c = doc.data();
      const de = deCards.get(c.number as string);
      const update: Record<string, unknown> = {};

      // Name ergänzen (nie entfernen).
      if (de?.name && !c.nameDe) { update.nameDe = de.name; update.nameDeLower = de.name.toLowerCase(); }

      // DE-Bild-Verfügbarkeit als Bool ableiten (Bilder-FELDER NICHT anfassen!):
      // selbst gehostet (deImageSource) ODER TCGdex hat ein echtes DE-Bild.
      const hasDe = !!c.deImageSource || !!de?.image;
      if (c.hasDeImage !== hasDe) update.hasDeImage = hasDe;

      if (Object.keys(update).length === 0) continue;
      batch.update(doc.ref, update);
      enriched++;
      if (++inBatch >= 450) break; // Firestore-Batch-Grenze; Rest holt der nächste Lauf
    }
    if (inBatch > 0) await batch.commit();
  }

  const lastSet = setDocs[setDocs.length - 1];
  if (hasMore) await cursorRef.set({ lastSetId: lastSet.id });
  else await cursorRef.delete();

  return {
    status: hasMore ? 'in-progress' : 'complete',
    message: hasMore
      ? `📥 ${enriched} Karten DE-Daten aktualisiert/bereinigt — weitere Sets folgen`
      : `✅ Deutsche Daten abgeglichen (${enriched} Karten aktualisiert/bereinigt)`,
    enriched,
    remaining: hasMore ? -1 : 0,
  };
}

/** Stempelt das ENDE eines „Daten aktualisieren"-Laufs: `lastChecked` = jetzt
 *  (immer), `lastSynced` = jetzt NUR wenn im Lauf tatsächlich etwas geändert wurde.
 *  So spiegelt „Zuletzt geprüft"/„Zuletzt geändert" den ganzen Lauf, nicht nur den
 *  Karten-Sync-Zwischenschritt. */
export async function touchSyncMeta(changed: boolean): Promise<void> {
  const nowIso = new Date().toISOString();
  await setMeta(changed ? { lastChecked: nowIso, lastSynced: nowIso } : { lastChecked: nowIso });
}

export async function getSyncStatus() {
  const meta = await getMeta();
  const currentTotal = await catalogTotalFromSets();
  const syncedTotal = meta?.syncedTotal ?? 0;

  // Abdeckungs-Kennzahlen via count()-Aggregation. Einzeln in try/catch, damit
  // ein fehlender Index (z.B. für prices.provider) die Statusabfrage nicht kippt.
  const db = getAdminDb();
  const safeCount = async (build: () => FirebaseFirestore.Query | FirebaseFirestore.CollectionReference): Promise<number> => {
    try { return (await build().count().get()).data().count; } catch { return 0; }
  };
  const cat = () => db.collection('tcg_catalog');
  const [totalCards, totalSets, withImage, selfHostedDe, hasDeFlag, withDeName, withPrice, deNoEn] = await Promise.all([
    safeCount(() => cat()),
    safeCount(() => db.collection('tcg_sets')),
    safeCount(() => cat().where('imgLarge', '>', '')),
    // Selbst gehostete DE-Bilder (Backfill-URL in imgLargeDe, z.B. pokewiki).
    safeCount(() => cat().where('imgLargeDe', '>', '')),
    // Abgeleitete DE-Verfügbarkeit (self-hosted ODER TCGdex-DE) — erst nach enrichDeData.
    safeCount(() => cat().where('hasDeImage', '==', true)),
    safeCount(() => cat().where('nameDeLower', '>', '')),
    safeCount(() => cat().where('prices.provider', 'in', ['cardmarket', 'tcgplayer'])),
    // Karten mit DE-Bild, aber OHNE EN-Bild (imgLarge==''). Braucht den
    // Composite-Index (imgLarge, imgLargeDe); fehlt er → safeCount liefert 0.
    safeCount(() => cat().where('imgLarge', '==', '').where('imgLargeDe', '>', '')),
  ]);
  // „Deutsche Bilder" = abgeleitete Verfügbarkeit (hasDeImage). Bis der erste
  // enrichDeData-Lauf lief, ist hasDeImage leer → Fallback auf die selbst
  // gehosteten (imgLargeDe), damit die Zahl nicht fälschlich 0 zeigt.
  const withDeImage = Math.max(hasDeFlag, selfHostedDe);
  // Karten mit IRGENDEINEM Bild (EN oder selbst gehostetes DE) = EN + DE-ohne-EN.
  // max() als Sicherheitsnetz (irgendein Bild ≥ EN und ≥ self-hosted DE).
  const withAnyImage = Math.max(withImage + deNoEn, withImage, selfHostedDe);

  return {
    ...(meta ?? { lastPage: 0, totalPages: 0, lastSynced: null, bootstrapped: false }),
    syncedTotal,
    currentTotal,
    // „Neue Karten" = Lücke abzüglich des kalibrierten Phantom-Grundwerts
    // (nicht einlesbare, aber gelistete Karten). Erst ein echtes Katalog-Wachstum
    // hebt die Zahl wieder über 0.
    newCards: Math.max(0, currentTotal - syncedTotal - (meta?.phantomTotal ?? 0)),
    totalCards,
    totalSets,
    withImage,
    withAnyImage,
    withDeImage,
    withDeName,
    withPrice,
  };
}
