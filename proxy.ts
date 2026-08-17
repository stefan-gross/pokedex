import { NextRequest, NextResponse } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/auth'

// /api/cron/* prüft selbst CRON_SECRET — Middleware muss durchlassen,
// damit Vercel-Cron-Jobs (kein Session-Cookie) den Handler erreichen.
const PUBLIC_PATHS = ['/login', '/api/auth', '/api/cron']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value

  if (!token) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('return', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const payload = await verifySession(token)
  if (!payload) {
    const loginUrl = new URL('/login', request.url)
    const response = NextResponse.redirect(loginUrl)
    response.cookies.delete(SESSION_COOKIE)
    return response
  }

  return NextResponse.next()
}

export const config = {
  // Statische Assets (Bilder, Fonts, mockup.html) NICHT durch die Auth-
  // Weiterleitung schicken — sonst bekommen z.B. die Login-Wand-Sprites
  // (`/wall/*.webp`) und die Pokémon-Font (`/fonts/*.ttf`) für nicht
  // eingeloggte Besucher einen 307 auf /login und laden nicht.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|webp|svg|jpg|jpeg|gif|ico|woff2?|ttf)$|.*\\.html$).*)'],
}
