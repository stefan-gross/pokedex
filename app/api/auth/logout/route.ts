import { NextResponse } from 'next/server'
import { SESSION_COOKIE, COOKIE_DOMAIN } from '@/lib/auth'

export async function POST() {
  const response = NextResponse.json({ success: true })
  response.cookies.set({ name: SESSION_COOKIE, value: '', maxAge: 0, domain: COOKIE_DOMAIN, path: '/' })
  return response
}
