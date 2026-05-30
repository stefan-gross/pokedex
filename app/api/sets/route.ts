import { NextRequest, NextResponse } from 'next/server';

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
      // Einzelnes Set
      const res = await fetch(`${TCG_BASE}/sets/${id}`, {
        headers,
        next: { revalidate: 86400 },
        signal: abort.signal,
      });
      if (!res.ok) return NextResponse.json({ error: 'Set not found' }, { status: 404 });
      return NextResponse.json(await res.json());
    }

    // Alle Sets — nach releaseDate absteigend sortiert
    const res = await fetch(`${TCG_BASE}/sets?orderBy=-releaseDate&pageSize=250`, {
      headers,
      next: { revalidate: 3600 }, // 1h Cache — Sets kommen selten neu
      signal: abort.signal,
    });
    if (!res.ok) return NextResponse.json({ error: 'Failed to fetch sets' }, { status: 502 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Failed to fetch set(s)' }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
