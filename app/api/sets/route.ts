import { NextRequest, NextResponse } from 'next/server';
import { fetchTcgdexDataMap, resolveSetDe, toTcgdexId } from '@/lib/tcgdex';

const TCG_BASE = 'https://api.pokemontcg.io/v2';
const headers: Record<string, string> = process.env.POKEMON_TCG_API_KEY
  ? { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY }
  : {};

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10000);

  try {
    if (id) {
      // Einzelnes Set: pokemontcg.io + TCGdex parallel
      const [tcgRes, dataMap] = await Promise.all([
        fetch(`${TCG_BASE}/sets/${id}`, {
          headers,
          next: { revalidate: 86400 },
          signal: abort.signal,
        }),
        fetchTcgdexDataMap(),
      ]);
      if (!tcgRes.ok) return NextResponse.json({ error: 'Set not found' }, { status: 404 });
      const data = await tcgRes.json();
      if (data.data) {
        const { nameDe, logoDe } = resolveSetDe(id, dataMap, data.data.name);
        data.data.nameDe = nameDe;
        data.data.logoDe = logoDe;
      }
      return NextResponse.json(data);
    }

    // Alle Sets: pokemontcg.io + TCGdex parallel
    const [tcgRes, dataMap] = await Promise.all([
      fetch(`${TCG_BASE}/sets?orderBy=-releaseDate&pageSize=250`, {
        headers,
        next: { revalidate: 3600 },
        signal: abort.signal,
      }),
      fetchTcgdexDataMap(),
    ]);
    if (!tcgRes.ok) return NextResponse.json({ error: 'Failed to fetch sets' }, { status: 502 });
    const data = await tcgRes.json();

    // Deutschen Namen + Logo in jeden Set-Eintrag mergen
    if (Array.isArray(data.data)) {
      data.data = data.data.map((set: { id: string; name: string }) => ({
        ...set,
        ...resolveSetDe(set.id, dataMap, set.name),
      }));
    }
    return NextResponse.json(data);

  } catch {
    return NextResponse.json({ error: 'Failed to fetch set(s)' }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
