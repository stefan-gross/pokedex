import { createRemoteJWKSet, jwtVerify } from 'jose'

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
)

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

export const SESSION_COOKIE = '__session'
export const COOKIE_DOMAIN  =
  process.env.NODE_ENV === 'production'
    ? `.${process.env.NEXT_PUBLIC_DOMAIN}`
    : undefined
