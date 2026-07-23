import { getAdminDb } from './firebase/admin';
import { FieldPath } from 'firebase-admin/firestore';
import type { CatalogCard, SyncMeta } from './firestore/catalog';
import type { CardVariant } from '@/types';
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
    set: { id: string; name: string; series: string; ptcgoCode?: string };
    rarity?: string; supertype?: string; types?: string[]; subtypes?: string[];
    hp?: string; artist?: string;
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
    ...(c.set.ptcgoCode ? { setCode: c.set.ptcgoCode } : {}),
    rarity: c.rarity ?? '',
    supertype: c.supertype ?? '',
    types: c.types ?? [],
    subtypes: c.subtypes ?? [],
    ...(c.hp                          ? { hp: parseInt(c.hp) }                          : {}),
    ...(c.artist                      ? { artist: c.artist, artistTokens: c.artist.toLowerCase().split(/\s+/) } : {}),
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

  // IMMER frisch von der API holen (nicht mehr nur bei `update`) — sonst
  // merkt `auto` nie, dass pokemontcg.io inzwischen neue Karten/Sets hat,
  // weil es sich auf den zuletzt gespeicherten `meta.currentTotal` verlässt.
  // Das war der eigentliche Bug: nach einem einmal abgeschlossenen Bootstrap
  // (`isFullySynced` gegen den EIGENEN veralteten Stand) hielt sich `auto`
  // für immer für "aktuell", auch wenn längst ein neues Set erschienen war.
  const currentTotal = await fetchCurrentTotal();

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

  // ── UPDATE: Nur neue Karten — gezielter Nachlade-Modus für den
  // Normalfall (nach abgeschlossenem Bootstrap). Holt anhand der FRISCHEN
  // Gesamtzahl exakt die fehlenden hinteren Seiten neu, unabhängig davon, was
  // `meta.lastPage` zuletzt war — robust auch wenn neue Karten/Sets die
  // Seitenaufteilung gegenüber dem letzten Sync verschoben haben (anders als
  // `auto`s reiner Seiten-Cursor, siehe unten). ─────────────────────────────
  if (mode === 'update') {
    if (isFullySynced) {
      await setMeta({ bootstrapped: true });
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
    await setMeta({ lastPage: totalPages, totalPages, syncedTotal: currentTotal, currentTotal, bootstrapped: true, lastSynced: new Date().toISOString() });
    return { status: 'updated', message: `✅ ${written} neue Karten hinzugefügt`, written, syncedTotal: currentTotal, currentTotal };
  }

  // ── AUTO: Initialer Bootstrap-Sync — holt seitenweise (per `lastPage`-
  // Cursor) den KOMPLETTEN Katalog beim allerersten Mal, in kleinen Häppchen
  // über mehrere Aufrufe verteilt (Vercel-Timeout). Nur für diesen einmaligen
  // Anfangszustand gedacht — für laufenden Nachschub neuer Karten danach ist
  // `update` (siehe oben) der richtige Modus, siehe Aufrufer in
  // `app/api/cron/sync-catalog/route.ts` und der Settings-Seite. ───────────
  if (isFullySynced) {
    await setMeta({ bootstrapped: true });
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
  if (done) await setMeta({ bootstrapped: true });
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

// ── Deutsche Namen-Anreicherung via TCGdex ────────────────────────────────
// Holt deutsche Kartennamen set-weise von TCGdex und schreibt nameDe + nameDeLower.

interface TcgdexCardVariants { normal?: boolean; reverse?: boolean; holo?: boolean; firstEdition?: boolean; }
interface TcgdexCard { id: string; localId: string; name: string; variants?: TcgdexCardVariants; }
interface TcgdexSet  { cards?: TcgdexCard[]; }

const tcgdexSetCache = new Map<string, Map<string, TcgdexCard>>(); // tcgdexSetId → localId → card

async function fetchDeCardsForSet(tcgdexSetId: string): Promise<Map<string, TcgdexCard>> {
  if (tcgdexSetCache.has(tcgdexSetId)) return tcgdexSetCache.get(tcgdexSetId)!;
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/de/sets/${tcgdexSetId}`);
    if (!res.ok) { tcgdexSetCache.set(tcgdexSetId, new Map()); return new Map(); }
    const data: TcgdexSet = await res.json();
    const map = new Map<string, TcgdexCard>();
    (data.cards ?? []).forEach(c => {
      // localId kann führende Nullen haben (z.B. "001") → normalisieren
      const normalized = String(parseInt(c.localId) || 0) || c.localId;
      map.set(c.localId, c);
      map.set(normalized, c);
    });
    tcgdexSetCache.set(tcgdexSetId, map);
    return map;
  } catch {
    tcgdexSetCache.set(tcgdexSetId, new Map());
    return new Map();
  }
}

/** Holt die ECHTEN Pro-Karten-Varianten von TCGdex — nur der Einzelkarten-
 *  Endpunkt liefert ein `variants`-Objekt (`{normal,holo,reverse,firstEdition,
 *  wPromo}`), das pro Druck korrekt ist (z.B. Grundset-Karten: `reverse:
 *  false`, da Reverse Holo erst ab der e-Card/EX-Ära existiert) — der
 *  /sets-Bulk-Endpoint liefert dort nur `id/image/localId/name`. Ein Request
 *  pro Karte, daher gepaced wie `fetchTcgdexIllustrator`. */
async function fetchTcgdexCardVariants(tcgdexCardId: string): Promise<TcgdexCardVariants | null> {
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/de/cards/${tcgdexCardId}`);
    if (!res.ok) return null;
    const data: { variants?: TcgdexCardVariants } = await res.json();
    return data.variants ?? null;
  } catch {
    return null;
  }
}

/** Mappt TCGdex-Variants-Objekt auf unser CardVariant[]-Format.
 *  alt-art und promo kommen nicht von TCGdex → werden aus rarity ergänzt. */
function tcgdexVariantsToCardVariants(v: TcgdexCardVariants | undefined, rarity: string): CardVariant[] {
  if (!v) return detectVariants(rarity);
  const result: CardVariant[] = [];
  if (v.normal)       result.push('standard');
  if (v.holo)         result.push('holo');
  if (v.reverse)      result.push('reverse');
  if (v.firstEdition) result.push('1st-ed');
  // alt-art / promo sind keine TCGdex-Varianten — weiter aus rarity ableiten
  const r = rarity.toLowerCase();
  if (r.includes('illustration rare') || r.includes('special illustration')) result.push('alt-art');
  if (r.includes('promo') || r.includes('classic collection')) result.push('promo');
  return result.length > 0 ? result : detectVariants(rarity);
}

export interface EnrichDeNamesResult {
  status: 'complete' | 'in-progress' | 'up-to-date';
  message: string;
  enriched: number;
  remaining: number;
}

export async function enrichGermanNames(batchSize = 500): Promise<EnrichDeNamesResult> {
  const db = getAdminDb();

  // Cursor-basierte Pagination: merkt sich den letzten verarbeiteten Doc-ID
  // (Firestore unterscheidet fehlende Felder von null → where('nameDe','==',null) funktioniert nicht)
  const cursorRef = db.doc('tcg_catalog_meta/de_enrichment_cursor');
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
    // Ende der Collection — Cursor zurücksetzen
    await cursorRef.delete();
    return { status: 'complete', message: 'Alle deutschen Namen sind bereits vorhanden', enriched: 0, remaining: 0 };
  }

  const hasMore = snap.docs.length > batchSize;
  const toEnrich = snap.docs.slice(0, batchSize).filter(d => !d.data().nameDe);

  // Distinct setIds dieser Batch
  const setIds = [...new Set(toEnrich.map(d => (d.data() as CatalogCard).setId))];

  // TCGdex-Karten (Name + Variants) set-weise holen (max 8 parallel)
  const CONCURRENCY = 8;
  for (let i = 0; i < setIds.length; i += CONCURRENCY) {
    await Promise.all(setIds.slice(i, i + CONCURRENCY).map(id => fetchDeCardsForSet(toTcgdexId(id))));
  }

  // Batch-Update
  let enriched = 0;
  for (let i = 0; i < toEnrich.length; i += 500) {
    const batch = db.batch();
    toEnrich.slice(i, i + 500).forEach(doc => {
      const card = doc.data() as CatalogCard;
      const tcgdexId = toTcgdexId(card.setId);
      const cardMap = tcgdexSetCache.get(tcgdexId);
      if (!cardMap) return;
      // Kartennummer normalisieren (z.B. "049/198" → "49", "001" → "1")
      const rawNum    = card.number.split('/')[0];
      const normNum   = String(parseInt(rawNum) || 0) || rawNum;
      const tcgdexCard = cardMap.get(rawNum) ?? cardMap.get(normNum);
      if (tcgdexCard) {
        batch.update(doc.ref, {
          nameDe:      tcgdexCard.name,
          nameDeLower: tcgdexCard.name.toLowerCase(),
          variants:    tcgdexVariantsToCardVariants(tcgdexCard.variants, card.rarity ?? ''),
        });
        enriched++;
      }
    });
    await batch.commit();
  }

  // Cursor für nächsten Aufruf speichern (oder löschen wenn fertig)
  const lastDoc = snap.docs[batchSize - 1] ?? snap.docs[snap.docs.length - 1];
  if (hasMore) {
    await cursorRef.set({ lastDocId: lastDoc.id });
  } else {
    await cursorRef.delete();
  }

  return {
    status: hasMore ? 'in-progress' : 'complete',
    message: hasMore
      ? `📥 ${enriched} Karten angereichert — weitere vorhanden`
      : `✅ Deutsche Namen vollständig (${enriched} Karten angereichert)`,
    enriched,
    remaining: hasMore ? -1 : 0,
  };
}

// ── Illustrator-Anreicherung via TCGdex (Fallback für pokemontcg.io-Lücken) ─
// pokemontcg.io liefert bei manchen Karten `artist: null`, obwohl der Name auf
// dem Kartenbild aufgedruckt ist (z.B. sv8-138 „Knapfel"/Applin aus „Stürmische
// Funken", von Yuka Morii illustriert). TCGdex hat pro Karte einen eigenen
// `illustrator`-Wert — ABER nur über den Einzelkarten-Endpunkt, nicht im
// Set-Bulk-Response (der nur id/image/localId/name liefert) — deshalb ein
// Request pro fehlender Karte, gepaced wie die anderen Enrichments.

async function fetchTcgdexIllustrator(tcgdexCardId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/de/cards/${tcgdexCardId}`);
    if (!res.ok) return null;
    const data: { illustrator?: string } = await res.json();
    return data.illustrator ?? null;
  } catch {
    return null;
  }
}

export interface EnrichArtistResult {
  status: 'complete' | 'in-progress';
  message: string;
  enriched: number;
  remaining: number;
}

export async function enrichArtistFromTcgdex(batchSize = 150): Promise<EnrichArtistResult> {
  const db = getAdminDb();

  const cursorRef = db.doc('tcg_catalog_meta/artist_enrichment_cursor');
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
    return { status: 'complete', message: '✅ Alle Illustrator-Daten sind vollständig', enriched: 0, remaining: 0 };
  }

  const hasMore  = snap.docs.length > batchSize;
  const pageDocs = snap.docs.slice(0, batchSize);
  // Defensiv: einzelne (fehlerhafte/unvollständige) Dokumente ohne setId/number
  // überspringen, statt toTcgdexId()/split() an undefined abstürzen zu lassen
  // und damit die ganze Batch zu verlieren.
  const toEnrich = pageDocs.filter(d => {
    const data = d.data();
    return !data.artist && data.setId && data.number;
  });

  let enriched = 0;
  if (toEnrich.length > 0) {
    const setIds = [...new Set(toEnrich.map(d => (d.data() as CatalogCard).setId))];
    const CONCURRENCY = 8;
    for (let i = 0; i < setIds.length; i += CONCURRENCY) {
      await Promise.all(setIds.slice(i, i + CONCURRENCY).map(id => fetchDeCardsForSet(toTcgdexId(id))));
    }

    const results: { ref: FirebaseFirestore.DocumentReference; artist: string }[] = [];
    for (let i = 0; i < toEnrich.length; i += CONCURRENCY) {
      const chunk = toEnrich.slice(i, i + CONCURRENCY);
      const fetched = await Promise.all(chunk.map(async doc => {
        try {
          const card = doc.data() as CatalogCard;
          const tcgdexId = toTcgdexId(card.setId);
          const cardMap  = tcgdexSetCache.get(tcgdexId);
          const rawNum   = card.number.split('/')[0];
          const normNum  = String(parseInt(rawNum) || 0) || rawNum;
          const tcgdexCard = cardMap?.get(rawNum) ?? cardMap?.get(normNum);
          if (!tcgdexCard) return null;
          const illustrator = await fetchTcgdexIllustrator(tcgdexCard.id);
          return illustrator ? { ref: doc.ref, artist: illustrator } : null;
        } catch (e) {
          console.warn('[enrich-artist] Karte übersprungen (Fehler)', doc.id, e);
          return null;
        }
      }));
      fetched.forEach(r => { if (r) results.push(r); });
    }

    for (let i = 0; i < results.length; i += 500) {
      const batch = db.batch();
      results.slice(i, i + 500).forEach(({ ref, artist }) => {
        batch.update(ref, { artist, artistTokens: artist.toLowerCase().split(/\s+/) });
      });
      await batch.commit();
    }
    enriched = results.length;
  }

  if (hasMore) {
    await cursorRef.set({ lastDocId: pageDocs[pageDocs.length - 1].id });
  } else {
    await cursorRef.delete();
  }

  return {
    status: hasMore ? 'in-progress' : 'complete',
    message: hasMore
      ? `🎨 ${enriched} Illustrator-Credits ergänzt — weitere vorhanden`
      : `✅ Illustrator-Anreicherung abgeschlossen (${enriched} Karten ergänzt)`,
    enriched,
    remaining: hasMore ? -1 : 0,
  };
}

// ── Variants-Anreicherung ────────────────────────────────────────────────
// Eigener Schritt: iteriert über ALLE Karten (im Gegensatz zu enrichGermanNames,
// das nur Karten ohne nameDe anpackt), holt TCGdex-Variants und überschreibt
// das variants-Array. Behebt das Problem, dass Karten mit schon-angereichertem
// nameDe nie ein Variants-Update bekommen haben.
//
// Holt pro Karte den ECHTEN Einzelkarten-Endpunkt (fetchTcgdexCardVariants) —
// der /sets-Bulk-Endpoint liefert dort kein `variants`-Objekt, nur der
// Fallback (detectVariants(rarity)) wäre sonst möglich, der z.B. Grundset-
// Karten fälschlich "Reverse Holo" andichtet (das Feature gab's dort noch
// nicht). Ein Request pro Karte → kleinerer Default-Batch als bei den
// set-weisen Anreicherungen, analog zu enrichArtistFromTcgdex.

export interface EnrichVariantsResult {
  status: 'complete' | 'in-progress' | 'up-to-date';
  message: string;
  enriched: number;
  remaining: number;
}

export async function enrichVariants(batchSize = 150, reset = false): Promise<EnrichVariantsResult> {
  const db = getAdminDb();

  const cursorRef = db.doc('tcg_catalog_meta/variants_enrichment_cursor');
  if (reset) await cursorRef.delete();
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
    return { status: 'complete', message: 'Alle Karten haben aktuelle Variants', enriched: 0, remaining: 0 };
  }

  const hasMore = snap.docs.length > batchSize;
  const batchDocs = snap.docs.slice(0, batchSize);

  // Defensiv: einzelne (fehlerhafte/unvollständige) Dokumente ohne setId/number
  // überspringen, statt toTcgdexId()/split() an undefined abstürzen zu lassen
  // und damit die ganze Batch zu verlieren (gleiches Muster wie enrichArtistFromTcgdex).
  const validDocs = batchDocs.filter(d => { const data = d.data(); return data.setId && data.number; });

  // Distinct setIds dieser Batch
  const setIds = [...new Set(validDocs.map(d => (d.data() as CatalogCard).setId))];

  // TCGdex set-weise holen (max 8 parallel, nutzt vorhandenen Cache von enrichGermanNames)
  const CONCURRENCY = 8;
  for (let i = 0; i < setIds.length; i += CONCURRENCY) {
    await Promise.all(setIds.slice(i, i + CONCURRENCY).map(id => fetchDeCardsForSet(toTcgdexId(id))));
  }

  // Pro Karte den Einzelkarten-Endpunkt abfragen (echte Varianten), max 8
  // parallel — der Bulk-Cache (fetchDeCardsForSet) liefert nur die TCGdex-
  // Karten-ID, mit der wir den Detail-Request adressieren.
  const ENRICH_CONCURRENCY = 8;
  const toUpdate: { ref: FirebaseFirestore.DocumentReference; variants: CardVariant[] }[] = [];
  for (let i = 0; i < validDocs.length; i += ENRICH_CONCURRENCY) {
    const chunk = validDocs.slice(i, i + ENRICH_CONCURRENCY);
    const computed = await Promise.all(chunk.map(async doc => {
      try {
        const card = doc.data() as CatalogCard;
        const tcgdexId = toTcgdexId(card.setId);
        const cardMap = tcgdexSetCache.get(tcgdexId);
        const rawNum    = card.number.split('/')[0];
        const normNum   = String(parseInt(rawNum) || 0) || rawNum;
        const tcgdexCard = cardMap?.get(rawNum) ?? cardMap?.get(normNum);
        // Echte Pro-Karten-Varianten vom Detail-Endpunkt; ohne TCGdex-Treffer
        // oder bei Request-Fehler bleibt der Fallback in tcgdexVariantsToCardVariants().
        const realVariants = tcgdexCard ? await fetchTcgdexCardVariants(tcgdexCard.id) : null;
        const newVariants = tcgdexVariantsToCardVariants(realVariants ?? undefined, card.rarity ?? '');
        return { ref: doc.ref, card, newVariants };
      } catch (e) {
        console.warn('[enrich-variants] Karte übersprungen (Fehler)', doc.id, e);
        return null;
      }
    }));
    computed.forEach(item => {
      if (!item) return;
      const { ref, card, newVariants } = item;
      // Nur schreiben wenn sich was ändert (vermeidet unnötige writes)
      const current = (card.variants ?? []).slice().sort().join(',');
      const next    = newVariants.slice().sort().join(',');
      if (current !== next) toUpdate.push({ ref, variants: newVariants });
    });
  }

  let enriched = 0;
  for (let i = 0; i < toUpdate.length; i += 500) {
    const batch = db.batch();
    toUpdate.slice(i, i + 500).forEach(({ ref, variants }) => {
      batch.update(ref, { variants });
      enriched++;
    });
    await batch.commit();
  }

  const lastDoc = batchDocs[batchDocs.length - 1];
  if (hasMore) {
    await cursorRef.set({ lastDocId: lastDoc.id });
  } else {
    await cursorRef.delete();
  }

  return {
    status: hasMore ? 'in-progress' : 'complete',
    message: hasMore
      ? `🃏 ${enriched} Varianten angereichert — weitere vorhanden`
      : `✅ Varianten vollständig (${enriched} Karten aktualisiert)`,
    enriched,
    remaining: hasMore ? -1 : 0,
  };
}

// ── Sets-Sync ──────────────────────────────────────────────────────────────
// Holt alle Sets von pokemontcg.io + DE-Namen von TCGdex → schreibt in tcg_sets.

export interface SyncSetsResult {
  status: 'complete' | 'error';
  message: string;
  synced: number;
}

export async function syncSets(): Promise<SyncSetsResult> {
  const db = getAdminDb();

  // 1. Alle Sets von pokemontcg.io (ein einziger Call, ~150 Sets)
  const res = await fetch(`${TCG_BASE}/sets?pageSize=250`, { headers: apiHeaders() });
  if (!res.ok) return { status: 'error', message: `TCG API Fehler: ${res.status}`, synced: 0 };
  const data = await res.json();
  const sets: Array<{
    id: string; name: string; series: string;
    total: number; printedTotal: number;
    ptcgoCode?: string; releaseDate?: string;
    images: { symbol: string; logo: string };
  }> = data.data ?? [];

  // 2. Alle deutschen Set-Namen von TCGdex (ein einziger Call)
  let tcgdexMap = new Map<string, { name: string; logo?: string }>();
  try {
    const deRes = await fetch('https://api.tcgdex.net/v2/de/sets');
    if (deRes.ok) {
      const deSets: Array<{ id: string; name: string; logo?: string }> = await deRes.json();
      tcgdexMap = new Map(deSets.map(s => [
        s.id,
        { name: s.name, logo: s.logo ? `${s.logo}.png` : undefined },
      ]));
    }
  } catch { /* kein DE-Name → Fallback auf englisch */ }

  // 3. Dokumente zusammenbauen
  const docs = sets.map(s => {
    const tcgdexId = toTcgdexId(s.id);
    const de = tcgdexMap.get(tcgdexId);
    return {
      id: s.id,
      name: s.name,
      ...(de?.name ? { nameDe: de.name } : {}),
      series: s.series,
      total: s.total,
      printedTotal: s.printedTotal,
      ...(s.ptcgoCode ? { ptcgoCode: s.ptcgoCode } : {}),
      logoUrl: de?.logo ?? s.images.logo,
      logoUrlEn: s.images.logo,
      symbolUrl: s.images.symbol,
      ...(s.releaseDate ? { releaseDate: s.releaseDate } : {}),
      tcgdexId,
    };
  });

  // 4. In Firestore schreiben (merge: true um manuelle Felder nicht zu überschreiben)
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    docs.slice(i, i + 500).forEach(s => {
      batch.set(db.collection('tcg_sets').doc(s.id), s, { merge: true });
    });
    await batch.commit();
  }

  return { status: 'complete', message: `✅ ${docs.length} Sets synchronisiert`, synced: docs.length };
}

// ── Backfill: setCode in tcg_catalog aus tcg_sets befüllen ─────────────────

export interface BackfillSetCodesResult {
  status: 'complete';
  message: string;
  updated: number;
}

export async function backfillSetCodes(): Promise<BackfillSetCodesResult> {
  const db = getAdminDb();

  // 1. Alle Sets mit ptcgoCode aus tcg_sets lesen
  const setsSnap = await db.collection('tcg_sets').get();
  const setCodeMap = new Map<string, string>(); // setId → ptcgoCode
  setsSnap.docs.forEach(d => {
    const data = d.data();
    if (data.ptcgoCode) setCodeMap.set(d.id, data.ptcgoCode as string);
  });

  if (setCodeMap.size === 0) {
    return { status: 'complete', message: 'Keine Sets mit ptcgoCode gefunden — erst "Sets sync" ausführen', updated: 0 };
  }

  let totalUpdated = 0;

  // 2. Pro Set alle Catalog-Karten ohne setCode aktualisieren
  for (const [setId, ptcgoCode] of setCodeMap) {
    const cardsSnap = await db.collection(COL).where('setId', '==', setId).get();
    const toUpdate = cardsSnap.docs.filter(d => !d.data().setCode);
    if (!toUpdate.length) continue;

    for (let i = 0; i < toUpdate.length; i += 500) {
      const batch = db.batch();
      toUpdate.slice(i, i + 500).forEach(d => batch.update(d.ref, { setCode: ptcgoCode }));
      await batch.commit();
    }
    totalUpdated += toUpdate.length;
  }

  return { status: 'complete', message: `✅ ${totalUpdated} Karten mit Set-Kürzel aktualisiert`, updated: totalUpdated };
}

// ── Backfill: artistTokens aus bereits vorhandenem artist-Feld ableiten ────
// Rein lokale Firestore-Operation (kein pokemontcg.io-Call nötig) — für Karten,
// die vor Einführung der wortweisen Illustrator-Suche synchronisiert wurden.

export interface BackfillArtistTokensResult {
  status: 'complete';
  message: string;
  updated: number;
}

export async function backfillArtistTokens(): Promise<BackfillArtistTokensResult> {
  const db = getAdminDb();
  const snap = await db.collection(COL).where('artist', '>', '').get();
  const toUpdate = snap.docs.filter(d => {
    const data = d.data();
    return data.artist && !data.artistTokens;
  });

  for (let i = 0; i < toUpdate.length; i += 500) {
    const batch = db.batch();
    toUpdate.slice(i, i + 500).forEach(d => {
      const artist = d.data().artist as string;
      batch.update(d.ref, { artistTokens: artist.toLowerCase().split(/\s+/) });
    });
    await batch.commit();
  }

  return { status: 'complete', message: `✅ ${toUpdate.length} Karten mit Illustrator-Tokens aktualisiert`, updated: toUpdate.length };
}

// ── DE-Bilder-Anreicherung ─────────────────────────────────────────────────
// Berechnet DE-Karten-Bild-URLs aus tcg_sets.logoUrl (kein externer API-Call)
// und schreibt imgSmallDe + imgLargeDe in tcg_catalog.

export interface EnrichDeImagesResult {
  status: 'complete' | 'in-progress' | 'up-to-date';
  message: string;
  enriched: number;
  remaining: number;
}

export async function enrichDeImages(batchSize = 500, reset = false): Promise<EnrichDeImagesResult> {
  const db = getAdminDb();

  // Alle Set-Daten aus tcg_sets lesen — Basis-URL für DE-Karten-Bilder bestimmen
  const setsSnap = await db.collection('tcg_sets').get();
  const setLogoMap = new Map<string, string>(); // setId → TCGdex-Basis-URL (ohne /logo.png)
  setsSnap.docs.forEach(d => {
    const data = d.data();
    if (data.logoUrl && String(data.logoUrl).includes('assets.tcgdex.net')) {
      // Direkt aus gespeicherter TCGdex-Logo-URL ableiten (bewährt)
      setLogoMap.set(d.id, data.logoUrl as string);
    } else if (data.tcgdexId) {
      // Fallback: Basis-URL aus tcgdexId konstruieren
      // tcgdexId z.B. "sv1", "xy1", "bw1", "sv4pt5" → series = "sv", "xy", "bw", "sv"
      const tcgdexId = data.tcgdexId as string;
      const series = tcgdexId.match(/^[a-z]+/)?.[0];
      if (series) {
        setLogoMap.set(d.id, `https://assets.tcgdex.net/de/${series}/${tcgdexId}/logo.png`);
      }
    }
  });

  if (setLogoMap.size === 0) {
    return { status: 'up-to-date', message: 'Keine TCGdex-Set-Daten gefunden — erst "Sets sync" ausführen', enriched: 0, remaining: 0 };
  }

  // Cursor-basierte Pagination (reset = neu von vorne anfangen)
  const cursorRef = db.doc('tcg_catalog_meta/de_images_cursor');
  if (reset) await cursorRef.delete();
  const cursorSnap = reset ? { exists: false, data: () => ({}) } : await cursorRef.get();
  const lastDocId: string = cursorSnap.exists ? ((cursorSnap as FirebaseFirestore.DocumentSnapshot).data()?.lastDocId ?? '') : '';

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
    return { status: 'complete', message: '✅ Alle DE-Bilder sind bereits angereichert', enriched: 0, remaining: 0 };
  }

  const hasMore = snap.docs.length > batchSize;
  // imgSmallDe === undefined → noch nicht geprüft
  // imgSmallDe === ''       → geprüft, kein DE-Bild vorhanden (überspringen)
  // imgSmallDe === URL      → DE-Bild vorhanden
  const toEnrich = snap.docs.slice(0, batchSize).filter(d => d.data().imgSmallDe === undefined);

  // Pro Set einen HEAD-Request — DE-Bilder existieren entweder für alle oder keine Karten im Set
  const setIds = [...new Set(toEnrich.map(d => (d.data() as CatalogCard).setId))];
  const setHasDeImages = new Map<string, boolean>();
  await Promise.all(setIds.map(async setId => {
    const logoUrl = setLogoMap.get(setId);
    if (!logoUrl) { setHasDeImages.set(setId, false); return; }
    const base = logoUrl.replace(/\/logo\.png$/, '').replace(/\/logo$/, '');
    const sampleDoc = toEnrich.find(d => (d.data() as CatalogCard).setId === setId);
    if (!sampleDoc) { setHasDeImages.set(setId, false); return; }
    const sampleNum = (sampleDoc.data() as CatalogCard).number.split('/')[0].padStart(3, '0');
    try {
      const res = await fetch(`${base}/${sampleNum}/high.webp`, { method: 'HEAD' });
      setHasDeImages.set(setId, res.ok);
    } catch {
      setHasDeImages.set(setId, false);
    }
  }));

  let enriched = 0;
  for (let i = 0; i < toEnrich.length; i += 500) {
    const batch = db.batch();
    toEnrich.slice(i, i + 500).forEach(doc => {
      const card = doc.data() as CatalogCard;
      const logoUrl = setLogoMap.get(card.setId);
      if (!logoUrl || !setHasDeImages.get(card.setId)) {
        // Kein DE-Bild für dieses Set → '' als Sentinel speichern (wird nicht neu geprüft)
        batch.update(doc.ref, { imgSmallDe: '', imgLargeDe: '' });
        return;
      }
      const base = logoUrl.replace(/\/logo\.png$/, '').replace(/\/logo$/, '');
      const num = card.number.split('/')[0].padStart(3, '0');
      batch.update(doc.ref, {
        imgSmallDe: `${base}/${num}/low.webp`,
        imgLargeDe: `${base}/${num}/high.webp`,
      });
      enriched++;
    });
    await batch.commit();
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
      ? `📥 ${enriched} DE-Bilder angereichert — weitere vorhanden`
      : `✅ DE-Bilder vollständig (${enriched} Karten angereichert)`,
    enriched,
    remaining: hasMore ? -1 : 0,
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

export async function getSyncStatus() {
  const meta = await getMeta();
  const currentTotal = await fetchCurrentTotal();
  const syncedTotal = meta?.syncedTotal ?? 0;
  return {
    ...(meta ?? { lastPage: 0, totalPages: 0, lastSynced: null, bootstrapped: false }),
    syncedTotal,
    currentTotal,
    newCards: Math.max(0, currentTotal - syncedTotal),
  };
}
