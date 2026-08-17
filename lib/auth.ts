import { createRemoteJWKSet, jwtVerify, importX509, decodeProtectedHeader } from 'jose'

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)

/** Verifiziert einen Firebase **ID-Token** (issuer securetoken.google.com).
 *  Das ist der bisherige Session-Cookie-Typ (roher ID-Token, 1h). */
export async function verifySessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer:   `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    })
    return payload
  } catch {
    return null
  }
}

// Firebase **Session-Cookies** (Admin-SDK createSessionCookie, bis 14 Tage)
// sind JWTs mit anderem Issuer, signiert mit X.509-Zertifikaten unter dem
// identitytoolkit-Endpoint (nicht dem JWK-Endpoint der ID-Token). jose kann sie
// per importX509 auch in der Edge-Runtime verifizieren (kein Admin-SDK nötig).
const SESSION_CERTS_URL = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/publicKeys'
let certCache: { certs: Record<string, string>; exp: number } | null = null

async function getSessionCerts(): Promise<Record<string, string>> {
  const now = Date.now()
  if (certCache && certCache.exp > now) return certCache.certs
  const res = await fetch(SESSION_CERTS_URL)
  const certs = (await res.json()) as Record<string, string>
  const cc = res.headers.get('cache-control') ?? ''
  const m = cc.match(/max-age=(\d+)/)
  const ttl = (m ? parseInt(m[1], 10) : 3600) * 1000
  certCache = { certs, exp: now + ttl }
  return certs
}

/** Verifiziert einen Firebase **Session-Cookie** (issuer session.firebase.google.com). */
export async function verifySessionCookieToken(cookie: string) {
  try {
    const { kid } = decodeProtectedHeader(cookie)
    if (!kid) return null
    const pem = (await getSessionCerts())[kid]
    if (!pem) return null
    const key = await importX509(pem, 'RS256')
    const { payload } = await jwtVerify(cookie, key, {
      issuer:   `https://session.firebase.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    })
    return payload
  } catch {
    return null
  }
}

/** Akzeptiert BEIDE Cookie-Typen (ID-Token ODER Session-Cookie) — so bleiben
 *  bestehende ID-Token-Cookies gültig, während neue Logins Session-Cookies
 *  setzen. Genutzt von proxy.ts und den Admin-Routen. */
export async function verifySession(token: string) {
  return (await verifySessionToken(token)) ?? (await verifySessionCookieToken(token))
}

export const SESSION_COOKIE = '__session'
export const COOKIE_DOMAIN  =
  process.env.NODE_ENV === 'production'
    ? `.${process.env.NEXT_PUBLIC_DOMAIN}`
    : undefined
