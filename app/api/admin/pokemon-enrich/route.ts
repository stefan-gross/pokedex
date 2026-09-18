import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { enrichPokemon } from '@/lib/pokemon/enrich';
import { POKEMON_COL, type PokemonProfile } from '@/lib/firestore/pokemon';
import SPECIES_JSON from '@/lib/pokemon-species-de.json';

export const maxDuration = 60;

const SPECIES = (SPECIES_JSON as { dex: number; name: string }[]).slice().sort((a, b) => a.dex - b.dex);
const MAX_DEX = SPECIES[SPECIES.length - 1]?.dex ?? 1025;
const CURSOR_DOC = 'sync_state/pokemonEnrichment';

// Schwellen, ab denen ein Text als „auffällig dünn" gilt (zur manuellen Prüfung).
const GENERAL_MIN = 150;
const TCG_MIN = 80;

interface Anomaly { dex: number; name: string; issues: string[] }

function classify(dex: number, name: string, p: PokemonProfile | null): Anomaly | null {
  const issues: string[] = [];
  if (!p) issues.push('keine PokéWiki-Daten');
  else {
    if (!p.general || p.general.length < GENERAL_MIN) issues.push('wenig allgemeiner Text');
    if (!p.tcg) issues.push('keine TCG-Seite');
    else if (p.tcg.length < TCG_MIN) issues.push('wenig TCG-Text');
  }
  return issues.length ? { dex, name, issues } : null;
}

/** Fortschritt + gesammelte Auffälligkeiten lesen. */
export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const snap = await getAdminDb().doc(CURSOR_DOC).get();
  const d = snap.data() ?? {};
  const anomalies: Anomaly[] = d.anomalies ?? [];
  return NextResponse.json({
    nextDex: d.nextDex ?? 1,
    done: !!d.done,
    processed: d.processed ?? 0,
    enriched: d.enriched ?? 0,
    anomalyCount: anomalies.length,
    anomalies,
  });
}

/**
 * Bulk-Backfill der Pokémon-Profile — resümierbar über einen Cursor. Verarbeitet
 * `count` Arten ab dem Cursor (bereits vorhandene werden übersprungen, außer `force`),
 * schreibt `pokemon/<dex>` und sammelt Auffälligkeiten (keine Daten / keine TCG-Seite /
 * dünner Text) im Cursor-Doc.
 *
 * POST { count?: number, start?: number, force?: boolean, reset?: boolean }
 * Sequenziell (Wiki-/Gemini-Rate-Limits schonen). Mehrfach aufrufen, bis `done`.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body?.count) || 8, 1), 30);
  const force = !!body?.force;

  const db = getAdminDb();
  const cursorRef = db.doc(CURSOR_DOC);
  const cur = (await cursorRef.get()).data() ?? {};

  if (body?.reset) {
    await cursorRef.set({ nextDex: 1, done: false, processed: 0, enriched: 0, anomalies: [], updatedAt: new Date().toISOString() });
    return NextResponse.json({ reset: true });
  }

  let nextDex: number = typeof body?.start === 'number' ? body.start : (cur.nextDex ?? 1);
  const anomalies: Anomaly[] = cur.anomalies ?? [];
  let processed = cur.processed ?? 0;
  let enriched = cur.enriched ?? 0;

  const batch: { dex: number; name: string; ok: boolean; skipped?: boolean; issues?: string[] }[] = [];
  let doneThisRun = 0;

  const species = SPECIES.filter(s => s.dex >= nextDex);
  for (const { dex, name } of species) {
    if (doneThisRun >= count) break;
    nextDex = dex + 1;
    doneThisRun++;
    try {
      if (!force) {
        const exists = (await db.collection(POKEMON_COL).doc(String(dex)).get()).exists;
        if (exists) { batch.push({ dex, name, ok: true, skipped: true }); continue; }
      }
      const p = await enrichPokemon(dex, name);
      processed++;
      if (p) enriched++;
      const a = classify(dex, name, p);
      if (a) { anomalies.push(a); batch.push({ dex, name, ok: !!p, issues: a.issues }); }
      else batch.push({ dex, name, ok: true });
    } catch (e) {
      console.error('[pokemon-enrich]', dex, name, e);
      const a: Anomaly = { dex, name, issues: ['Fehler beim Anreichern'] };
      anomalies.push(a);
      batch.push({ dex, name, ok: false, issues: a.issues });
    }
  }

  const done = nextDex > MAX_DEX;
  await cursorRef.set(
    { nextDex, done, processed, enriched, anomalies, updatedAt: new Date().toISOString() },
    { merge: true },
  );

  return NextResponse.json({ ranThisCall: doneThisRun, nextDex, done, processed, enriched, anomalyCount: anomalies.length, batch });
}
