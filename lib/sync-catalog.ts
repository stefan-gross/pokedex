import { getAdminDb } from './firebase/admin';
import type { CatalogCard, SyncMeta } from './firestore/catalog';

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
    rarity?: string; supertype?: string; types?: string[];
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
    imgSmall: c.images.small,
    imgLarge: c.images.large,
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

export async function runSync(mode: 'auto' | 'update' = 'auto'): Promise<SyncResult> {
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
