import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { enrichPokemon } from '@/lib/pokemon/enrich';
import { POKEMON_COL, type PokemonProfile } from '@/lib/firestore/pokemon';
import SPECIES_JSON from '@/lib/pokemon-species-de.json';

const NAME_BY_DEX = new Map((SPECIES_JSON as { dex: number; name: string }[]).map(s => [s.dex, s.name]));

// Enrichment kann PokéWiki + Gemini aufrufen — großzügiges Zeitbudget.
export const maxDuration = 60;

/** Angereichertes Pokémon-Profil (allgemeiner Text + TCG-Zusammenfassung) lesen;
 *  bei Cache-Miss einmalig anreichern und in `pokemon/<dex>` ablegen. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ dex: string }> }) {
  const { dex } = await params;
  const n = parseInt(dex, 10);
  const name = NAME_BY_DEX.get(n);
  if (!name) return NextResponse.json({ profile: null }, { status: 404 });
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  try {
    const ref = getAdminDb().collection(POKEMON_COL).doc(String(n));
    if (!refresh) {
      const snap = await ref.get();
      if (snap.exists) return NextResponse.json({ profile: snap.data() as PokemonProfile });
    }

    const profile = await enrichPokemon(n, name);
    return NextResponse.json({ profile });
  } catch (e) {
    console.error('[api/pokemon]', dex, e);
    return NextResponse.json({ profile: null }, { status: 500 });
  }
}
