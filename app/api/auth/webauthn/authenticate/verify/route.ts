import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { getRpID, getExpectedOrigin } from '@/lib/webauthn'
import { getAdminAuth } from '@/lib/firebase/admin'
import {
  consumeChallenge,
  findCredential,
  getUidByCredentialId,
  updateCredentialCounter,
} from '@/lib/firestore/webauthn'

/** Schritt 2 des Passkey-Logins: Assertion prüfen und bei Erfolg einen Firebase
 *  Custom Token zurückgeben. Der Client tauscht ihn via signInWithCustomToken in
 *  einen ID-Token → /api/auth/login setzt daraus das __session-Cookie. */
export async function POST(req: NextRequest) {
  const { response, flowId } = await req.json()
  if (!response?.id || !flowId) {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 })
  }

  const stored = await consumeChallenge(flowId, 'authentication')
  if (!stored) return NextResponse.json({ error: 'Challenge abgelaufen' }, { status: 400 })

  // Credential-ID → uid auflösen (discoverable Login liefert nur die ID).
  const credentialId = response.id as string
  const uid = await getUidByCredentialId(credentialId)
  if (!uid) return NextResponse.json({ error: 'Passkey unbekannt' }, { status: 401 })

  const cred = await findCredential(uid, credentialId)
  if (!cred) return NextResponse.json({ error: 'Passkey unbekannt' }, { status: 401 })

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: getExpectedOrigin(),
      expectedRPID: getRpID(),
      requireUserVerification: true,
      credential: {
        id: cred.id,
        publicKey: isoBase64URL.toBuffer(cred.publicKey),
        counter: cred.counter,
        transports: cred.transports as never,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Verifikation fehlgeschlagen' }, { status: 400 })
  }

  if (!verification.verified) {
    return NextResponse.json({ error: 'Nicht verifiziert' }, { status: 401 })
  }

  // Replay-Schutz: neuen Signatur-Zähler persistieren.
  await updateCredentialCounter(uid, credentialId, verification.authenticationInfo.newCounter)

  // Firebase Custom Token → Client-seitiger signInWithCustomToken.
  let customToken: string
  try {
    customToken = await getAdminAuth().createCustomToken(uid)
  } catch (e) {
    console.error('[webauthn] createCustomToken fehlgeschlagen', e)
    return NextResponse.json({ error: 'Serverfehler' }, { status: 500 })
  }

  return NextResponse.json({ customToken })
}
