import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth'

const PUBLIC_PATHS = ['/login', '/api/auth', '/api/scan-public']

export async function middleware(request: NextRequest) {
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

  const payload = await verifySessionToken(token)
  if (!payload) {
    const loginUrl = new URL('/login', request.url)
    const response = NextResponse.redirect(loginUrl)
    response.cookies.delete(SESSION_COOKIE)
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.html$).*)'],
}
