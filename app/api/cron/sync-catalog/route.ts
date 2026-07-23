import { NextRequest, NextResponse } from 'next/server';
import { runSync, getSyncStatus } from '@/lib/sync-catalog';

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const status = await getSyncStatus();
  // `auto` (Seiten-Cursor) NUR solange der einmalige Bootstrap noch nicht
  // durchgelaufen ist — danach `update` (holt gezielt anhand der aktuellen
  // Gesamtzahl genau die fehlenden Karten, unabhängig von einer evtl.
  // verschobenen Seitenaufteilung). Vorher stand das hier invertiert: bei
  // syncedTotal < currentTotal (also GENAU dann, wenn neue Karten fehlen)
  // griff fälschlich `auto`, das aber nach einem einmal abgeschlossenen
  // Bootstrap nie mehr etwas Neues erkannte — neue Sets kamen dadurch nie an.
  const mode = status.bootstrapped ? 'update' : 'auto';
  const result = await runSync(mode);
  console.log(`[cron] sync-catalog (${mode}):`, result.message);
  return NextResponse.json({ mode, ...result });
}
