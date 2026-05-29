import { NextRequest, NextResponse } from 'next/server';

const TCG_BASE = 'https://api.pokemontcg.io/v2';
const headers: Record<string, string> = process.env.POKEMON_TCG_API_KEY
  ? { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY }
  : {};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  const page = searchParams.get('page') ?? '1';
  const pageSize = searchParams.get('pageSize') ?? '20';
  const id = searchParams.get('id');

  try {
    if (id) {
      const res = await fetch(`${TCG_BASE}/cards/${id}`, { headers, next: { revalidate: 3600 } });
      const data = await res.json();
      return NextResponse.json(data);
    }

    const params = new URLSearchParams({ q, page, pageSize });
    const res = await fetch(`${TCG_BASE}/cards?${params}`, { headers, next: { revalidate: 3600 } });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('TCG API error:', err);
    return NextResponse.json({ error: 'TCG API request failed' }, { status: 500 });
  }
}
