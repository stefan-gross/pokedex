import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth';

/** Erlaubte Admin-uids (Firebase `sub`) aus `ADMIN_UIDS` (kommagetrennt). */
function adminUids(): string[] {
  return (process.env.ADMIN_UIDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Zugriffsschutz für Admin-/Sync-Routen. Erlaubt NUR:
 *  1. Server-zu-Server via `x-cron-secret`-**Header** == `CRON_SECRET`
 *     (bewusst KEIN Query-Param mehr — der landete in Logs/History), ODER
 *  2. eine gültige Session, deren uid in `ADMIN_UIDS` steht.
 *
 * „Irgendeine gültige Session" reicht bewusst NICHT mehr: das Firebase-Projekt
 * + `__session`-Cookie sind per SSO mit anderen Apps geteilt, jeder dortige
 * Nutzer wäre sonst Admin (konnte u.a. `reset-catalog?scope=all` auslösen).
 * Ist `ADMIN_UIDS` nicht gesetzt, wird der Session-Weg sicher verweigert.
 */
export async function isAdminRequest(req: NextRequest): Promise<boolean> {
  const secret = req.headers.get('x-cron-secret');
  if (secret && process.env.CRON_SECRET && secret === process.env.CRON_SECRET) return true;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const payload = await verifySessionToken(token);
  if (!payload) return false;
  const uid = (payload.sub as string | undefined) ?? (payload.user_id as string | undefined) ?? '';
  const allow = adminUids();
  return allow.length > 0 && allow.includes(uid);
}

/** Bequemer Guard: liefert eine 401-Response, wenn kein Admin — sonst null. */
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  return (await isAdminRequest(req))
    ? null
    : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
