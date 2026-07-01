import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, COOKIE_DOMAIN, verifySessionToken } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { idToken } = await request.json()
    if (!idToken) return NextResponse.json({ error: 'Token fehlt' }, { status: 400 })

    const payload = await verifySessionToken(idToken)
    if (!payload) return NextResponse.json({ error: 'Ungültiges Token' }, { status: 401 })

    const response = NextResponse.json({ success: true })
    response.cookies.set({
      name: SESSION_COOKIE, value: idToken,
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', domain: COOKIE_DOMAIN,
      maxAge: 60 * 60, path: '/',
    })
    return response
  } catch {
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 })
  }
}
