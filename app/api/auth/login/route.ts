import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, COOKIE_DOMAIN, verifySessionToken } from '@/lib/auth'
import { getAdminAuth } from '@/lib/firebase/admin'

const ONE_HOUR = 60 * 60
const FOURTEEN_DAYS = 14 * 24 * 60 * 60

export async function POST(request: NextRequest) {
  try {
    const { idToken } = await request.json()
    if (!idToken) return NextResponse.json({ error: 'Token fehlt' }, { status: 400 })

    // Eingehenden ID-Token verifizieren (bleibt ein ID-Token, egal welcher
    // Cookie-Typ danach gesetzt wird).
    const payload = await verifySessionToken(idToken)
    if (!payload) return NextResponse.json({ error: 'Ungültiges Token' }, { status: 401 })

    // Session-Cookie (14 Tage, revozierbar) NUR wenn per Env-Flag aktiviert UND
    // das Admin-SDK verfügbar ist (Admin-Env-Vars gesetzt). Sonst Fallback auf
    // den bisherigen rohen ID-Token (1 h). So ändert sich ohne Flag nichts, und
    // wo Admin-Credentials fehlen (z.B. Vercel bis zum Setzen), läuft es weiter.
    let cookieValue = idToken
    let maxAge = ONE_HOUR
    if (process.env.SESSION_COOKIE_ENABLED === '1') {
      try {
        cookieValue = await getAdminAuth().createSessionCookie(idToken, { expiresIn: FOURTEEN_DAYS * 1000 })
        maxAge = FOURTEEN_DAYS
      } catch (e) {
        console.warn('[auth] createSessionCookie nicht verfügbar → Fallback ID-Token (1h)', e)
      }
    }

    const response = NextResponse.json({ success: true })
    response.cookies.set({
      name: SESSION_COOKIE, value: cookieValue,
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', domain: COOKIE_DOMAIN,
      maxAge, path: '/',
    })
    return response
  } catch {
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 })
  }
}
