import { NextRequest, NextResponse } from 'next/server';
import { upsertCatalogBatch, getSyncMeta, setSyncMeta, type CatalogCard } from '@/lib/firestore/catalog';

const TCG_BASE = 'https://api.pokemontcg.io/v2';
const PAGE_SIZE = 250;
// Sicherheitsabstand zum 20k Firestore-Limit
const MAX_WRITES_PER_DAY = 19000;

function authCheck(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret');
  return secret === process.env.CRON_SECRET;
}

function apiHeaders(): Record<string, string> {
  return process.env.POKEMON_TCG_API_KEY
    ? { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY }
    : {};
}

// Wie viele Karten hat pokemontcg.io aktuell?
async function fetchCurrentTotal(): Promise<number> {
  const res = await fetch(`${TCG_BASE}/cards?pageSize=1`, { headers: apiHeaders() });
  const data = await res.json();
  return data.totalCount ?? 0;
}

// Eine Seite Karten holen und in Catalog-Format umwandeln
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

// ── POST /api/admin/sync ──────────────────────────────────────────────────────
// mode=initial  → Initialer Sync, maximal MAX_WRITES_PER_DAY Karten pro Aufruf
// mode=update   → Nur neue Karten holen (Differenz zu letztem Sync)
// mode=full     → Alles neu (für manuellen Reset)

export async function POST(req: NextRequest) {
  if (!authCheck(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const mode = searchParams.get('mode') ?? 'auto';

  try {
    const meta = await getSyncMeta();
    const currentTotal = await fetchCurrentTotal();
    const syncedTotal = meta?.syncedTotal ?? 0;
    const lastPage = meta?.lastPage ?? 0;
    const totalPages = Math.ceil(currentTotal / PAGE_SIZE);

    // ── AUTO: entscheidet selbst ob initial oder update
    const isFullySynced = syncedTotal >= currentTotal;

    if (mode === 'auto' || mode === 'initial') {
      if (isFullySynced) {
        return NextResponse.json({
          status: 'up-to-date',
          message: `Alle ${syncedTotal.toLocaleString()} Karten sind aktuell`,
          syncedTotal,
          currentTotal,
        });
      }

      // Initialer Sync: nächste Seiten holen, maximal bis Tageslimit
      const maxPagesThisRun = Math.floor(MAX_WRITES_PER_DAY / PAGE_SIZE); // 76
      const startPage = lastPage + 1;
      const endPage = Math.min(startPage + maxPagesThisRun - 1, totalPages);

      let written = 0;
      for (let p = startPage; p <= endPage; p++) {
        const cards = await fetchPage(p);
        if (!cards.length) break;
        await upsertCatalogBatch(cards);
        written += cards.length;
        await setSyncMeta({
          lastPage: p,
          totalPages,
          syncedTotal: syncedTotal + written,
          currentTotal,
          lastSynced: new Date().toISOString(),
        });
      }

      const newSyncedTotal = syncedTotal + written;
      const done = newSyncedTotal >= currentTotal;

      return NextResponse.json({
        status: done ? 'complete' : 'in-progress',
        message: done
          ? `✅ Alle ${newSyncedTotal.toLocaleString()} Karten synchronisiert`
          : `📥 ${newSyncedTotal.toLocaleString()} / ${currentTotal.toLocaleString()} Karten (morgen weiter)`,
        written,
        syncedTotal: newSyncedTotal,
        currentTotal,
        done,
      });
    }

    // ── UPDATE: Nur neue Karten holen ────────────────────────────────────────
    if (mode === 'update') {
      const newCards = currentTotal - syncedTotal;
      if (newCards <= 0) {
        return NextResponse.json({
          status: 'up-to-date',
          message: `Keine neuen Karten (${syncedTotal.toLocaleString()} aktuell)`,
          syncedTotal,
          currentTotal,
        });
      }

      // Neue Karten sind in den neuesten Sets — von hinten holen
      const pagesToFetch = Math.ceil(newCards / PAGE_SIZE);
      const startPage = totalPages - pagesToFetch + 1;

      let written = 0;
      for (let p = startPage; p <= totalPages; p++) {
        const cards = await fetchPage(p);
        if (!cards.length) break;
        await upsertCatalogBatch(cards);
        written += cards.length;
      }

      await setSyncMeta({
        lastPage: totalPages,
        totalPages,
        syncedTotal: currentTotal,
        currentTotal,
        lastSynced: new Date().toISOString(),
      });

      return NextResponse.json({
        status: 'updated',
        message: `✅ ${written} neue Karten hinzugefügt`,
        written,
        syncedTotal: currentTotal,
        currentTotal,
      });
    }

    return NextResponse.json({ error: 'Unbekannter mode' }, { status: 400 });

  } catch (err) {
    console.error('Sync error:', err);
    return NextResponse.json({ error: 'Sync fehlgeschlagen', details: String(err) }, { status: 500 });
  }
}

// ── GET /api/admin/sync → aktuellen Status abfragen ──────────────────────────
export async function GET(req: NextRequest) {
  if (!authCheck(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const meta = await getSyncMeta();
  const currentTotal = await fetchCurrentTotal();
  return NextResponse.json({
    ...meta,
    currentTotal,
    newCards: currentTotal - (meta?.syncedTotal ?? 0),
  });
}
