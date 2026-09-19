import { NextRequest, NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { getRpID, getExpectedOrigin, getSessionUid } from '@/lib/webauthn'
import { addCredential, consumeChallenge, type StoredCredential } from '@/lib/firestore/webauthn'

/** Schritt 2 der Passkey-Registrierung: Antwort des Authenticators prüfen und
 *  den neuen Passkey (Public Key) speichern. */
export async function POST(req: NextRequest) {
  const uid = await getSessionUid(req)
  if (!uid) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })

  const { response, flowId, deviceLabel } = await req.json()
  if (!response || !flowId) {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 })
  }

  const stored = await consumeChallenge(flowId, 'registration')
  // Challenge muss existieren, gültig und an DIESEN Nutzer gebunden sein.
  if (!stored || stored.uid !== uid) {
    return NextResponse.json({ error: 'Challenge abgelaufen' }, { status: 400 })
  }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: getExpectedOrigin(),
      expectedRPID: getRpID(),
      requireUserVerification: true,
    })
  } catch {
    return NextResponse.json({ error: 'Verifikation fehlgeschlagen' }, { status: 400 })
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'Nicht verifiziert' }, { status: 400 })
  }

  const { credential } = verification.registrationInfo
  const now = Date.now()
  const cred: StoredCredential = {
    id: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
    deviceLabel: typeof deviceLabel === 'string' && deviceLabel.trim() ? deviceLabel.trim() : 'Unbekanntes Gerät',
    createdAt: now,
    lastUsedAt: now,
  }
  await addCredential(uid, cred)

  return NextResponse.json({ verified: true })
}
