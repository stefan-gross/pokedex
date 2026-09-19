import type { NextRequest } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/auth'

/**
 * Zentrale WebAuthn-/Passkey-Konfiguration (nur serverseitig genutzt).
 *
 * RP-ID = die Domain, an die ein Passkey gebunden ist (ohne Schema/Port).
 * Origin = die vollständige Herkunft, die der Browser meldet. Beide MÜSSEN in
 * Produktion exakt stimmen, sonst schlägt die Verifikation fehl.
 *
 * In Produktion via Env setzen:
 *   WEBAUTHN_RP_ID=pokedex.smartfamilyzone.de
 *   WEBAUTHN_ORIGIN=https://pokedex.smartfamilyzone.de
 * Ohne Env greift der Dev-Fallback (localhost:3000) — RP-ID/Origin bewusst NICHT
 * aus dem (fälschbaren) Host-Header ableiten.
 */
export const RP_NAME = 'Pokédex'

export function getRpID(): string {
  return process.env.WEBAUTHN_RP_ID || 'localhost'
}

export function getExpectedOrigin(): string {
  return process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000'
}

/** uid des aktuell eingeloggten Nutzers aus dem __session-Cookie (oder null).
 *  Für die Registrierungs-Routes: einen Passkey darf nur anlegen, wer bereits
 *  regulär eingeloggt ist. */
export async function getSessionUid(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token) return null
  const payload = await verifySession(token)
  if (!payload) return null
  return (payload.sub as string | undefined) ?? (payload.user_id as string | undefined) ?? null
}
