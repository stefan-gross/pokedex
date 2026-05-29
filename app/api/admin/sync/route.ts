import { NextRequest, NextResponse } from 'next/server';
import { upsertCatalogBatch, getSyncMeta, setSyncMeta, type CatalogCard } from '@/lib/firestore/catalog';

const TCG_BASE = 'https://api.pokemontcg.io/v2';
const PAGE_SIZE = 250;

function authCheck(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret');
  return secret === process.env.CRON_SECRET;
}

export async function POST(req: NextRequest) {
  if (!authCheck(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fortschritt lesen
    const meta = await getSyncMeta();
    const nextPage = (meta?.lastPage ?? 0) + 1;

    // Karten von pokemontcg.io holen
    const apiHeaders: Record<string, string> = process.env.POKEMON_TCG_API_KEY
      ? { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY }
      : {};

    const res = await fetch(
      `${TCG_BASE}/cards?page=${nextPage}&pageSize=${PAGE_SIZE}&orderBy=set.releaseDate`,
      { headers: apiHeaders }
    );
    const data = await res.json();

    if (!data.data?.length) {
      return NextResponse.json({ done: true, message: 'Alle Karten bereits synchronisiert' });
    }

    const totalPages = Math.ceil(data.totalCount / PAGE_SIZE);

    // Karten in Catalog-Format umwandeln
    const cards: CatalogCard[] = data.data.map((c: {
      id: string; name: string; number: string;
      set: { id: string; name: string; series: string };
      rarity?: string; supertype?: string; types?: string[];
      images: { small: string; large: string };
    }) => ({
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

    // In Firestore speichern (Batch-Write, max 500)
    await upsertCatalogBatch(cards);

    // Fortschritt speichern
    await setSyncMeta({
      lastPage: nextPage,
      totalPages,
      lastSynced: new Date().toISOString(),
    });

    const done = nextPage >= totalPages;

    return NextResponse.json({
      page: nextPage,
      totalPages,
      cardsOnPage: cards.length,
      totalSynced: nextPage * PAGE_SIZE,
      done,
      message: done
        ? '✅ Alle Karten synchronisiert!'
        : `Seite ${nextPage}/${totalPages} synchronisiert`,
    });

  } catch (err) {
    console.error('Sync error:', err);
    return NextResponse.json({ error: 'Sync fehlgeschlagen', details: String(err) }, { status: 500 });
  }
}

// Fortschritt abfragen
export async function GET(req: NextRequest) {
  if (!authCheck(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const meta = await getSyncMeta();
  return NextResponse.json(meta ?? { lastPage: 0, totalPages: 0, lastSynced: null });
}
