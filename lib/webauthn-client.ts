import { startRegistration, startAuthentication } from '@simplewebauthn/browser'
import { signInWithCustomToken } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

/** Ist Passkey-Login auf diesem Gerät grundsätzlich möglich?
 *  (WebAuthn vorhanden UND ein Plattform-Authenticator wie Face ID / Touch ID). */
export async function isPasskeySupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

/** Kurzer Gerätename aus dem User-Agent (nur zur Anzeige in der Geräteliste). */
function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android-Gerät'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows-PC'
  return 'Dieses Gerät'
}

export interface PasskeyInfo {
  id: string
  deviceLabel: string
  createdAt: number
  lastUsedAt: number
}

/** Registrierte Passkeys des eingeloggten Nutzers laden (Geräteliste). */
export async function listPasskeys(): Promise<PasskeyInfo[]> {
  const res = await fetch('/api/auth/webauthn/credentials')
  if (!res.ok) return []
  const { credentials } = await res.json()
  return credentials as PasskeyInfo[]
}

/** Einen Passkey entfernen. */
export async function removePasskey(credentialId: string): Promise<void> {
  const res = await fetch('/api/auth/webauthn/credentials', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentialId }),
  })
  if (!res.ok) throw new Error('delete')
}

/** Passkey für den aktuell eingeloggten Nutzer registrieren („Biometrie aktivieren"). */
export async function registerPasskey(): Promise<void> {
  const optRes = await fetch('/api/auth/webauthn/register/options', { method: 'POST' })
  if (!optRes.ok) throw new Error('options')
  const { options, flowId } = await optRes.json()

  const attResp = await startRegistration({ optionsJSON: options })

  const verifyRes = await fetch('/api/auth/webauthn/register/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: attResp, flowId, deviceLabel: deviceLabel() }),
  })
  if (!verifyRes.ok) throw new Error('verify')
}

/** Mit Passkey anmelden (Face ID / Touch ID / Fingerabdruck).
 *  Setzt am Ende das __session-Cookie über den bestehenden /api/auth/login-Flow. */
export async function signInWithPasskey(): Promise<void> {
  const optRes = await fetch('/api/auth/webauthn/authenticate/options', { method: 'POST' })
  if (!optRes.ok) throw new Error('options')
  const { options, flowId } = await optRes.json()

  const asseResp = await startAuthentication({ optionsJSON: options })

  const verifyRes = await fetch('/api/auth/webauthn/authenticate/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: asseResp, flowId }),
  })
  if (!verifyRes.ok) throw new Error('verify')
  const { customToken } = await verifyRes.json()

  // Custom Token → Firebase-Login → ID-Token → __session-Cookie (bestehender Flow).
  const cred = await signInWithCustomToken(auth, customToken)
  const idToken = await cred.user.getIdToken()
  const loginRes = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })
  if (!loginRes.ok) throw new Error('session')
}
