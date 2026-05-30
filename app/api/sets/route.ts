import { NextRequest, NextResponse } from 'next/server';

const TCG_BASE = 'https://api.pokemontcg.io/v2';
const headers: Record<string, string> = process.env.POKEMON_TCG_API_KEY
  ? { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY }
  : {};

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 8000);
  try {
    const res = await fetch(`${TCG_BASE}/sets/${id}`, {
      headers,
      next: { revalidate: 86400 },
      signal: abort.signal,
    });
    if (!res.ok) return NextResponse.json({ error: 'Set not found' }, { status: 404 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch set' }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
