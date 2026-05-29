// Sync-Logik als wiederverwendbare Funktion
// Wird sowohl von /api/admin/trigger-sync als auch von /api/admin/sync genutzt

import { upsertCatalogBatch, getSyncMeta, setSyncMeta, type CatalogCard } from './firestore/catalog';

const TCG_BASE = 'https://api.pokemontcg.io/v2';
const PAGE_SIZE = 250;
const MAX_WRITES_PER_DAY = 19000;

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

export interface SyncResult {
  status: 'up-to-date' | 'in-progress' | 'complete' | 'updated' | 'error';
  message: string;
  written?: number;
  syncedTotal?: number;
  currentTotal?: number;
  done?: boolean;
}

export async function runSync(mode: 'auto' | 'update' = 'auto'): Promise<SyncResult> {
  const meta = await getSyncMeta();
  const currentTotal = await fetchCurrentTotal();
  const syncedTotal = meta?.syncedTotal ?? 0;
  const lastPage = meta?.lastPage ?? 0;
  const totalPages = Math.ceil(currentTotal / PAGE_SIZE);
  const isFullySynced = syncedTotal >= currentTotal;

  // ── UPDATE: Nur neue Karten (Differenz) ─────────────────────────────────
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
      await upsertCatalogBatch(cards);
      written += cards.length;
    }
    await setSyncMeta({ lastPage: totalPages, totalPages, syncedTotal: currentTotal, currentTotal, lastSynced: new Date().toISOString() });
    return { status: 'updated', message: `✅ ${written} neue Karten hinzugefügt`, written, syncedTotal: currentTotal, currentTotal };
  }

  // ── AUTO: Initialer Sync oder up-to-date ────────────────────────────────
  if (isFullySynced) {
    return { status: 'up-to-date', message: `Alle ${syncedTotal.toLocaleString()} Karten sind aktuell`, syncedTotal, currentTotal };
  }

  const maxPagesThisRun = Math.floor(MAX_WRITES_PER_DAY / PAGE_SIZE);
  const startPage = lastPage + 1;
  const endPage = Math.min(startPage + maxPagesThisRun - 1, totalPages);

  let written = 0;
  for (let p = startPage; p <= endPage; p++) {
    const cards = await fetchPage(p);
    if (!cards.length) break;
    await upsertCatalogBatch(cards);
    written += cards.length;
    await setSyncMeta({ lastPage: p, totalPages, syncedTotal: syncedTotal + written, currentTotal, lastSynced: new Date().toISOString() });
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
  const meta = await getSyncMeta();
  const currentTotal = await fetchCurrentTotal();
  const syncedTotal = meta?.syncedTotal ?? 0;
  return {
    ...(meta ?? { lastPage: 0, totalPages: 0, lastSynced: null }),
    syncedTotal,
    currentTotal,
    newCards: Math.max(0, currentTotal - syncedTotal),
  };
}
