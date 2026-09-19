import { NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { getRpID } from '@/lib/webauthn'
import { saveChallenge } from '@/lib/firestore/webauthn'

/** Schritt 1 des Passkey-Logins: Challenge erzeugen. Öffentlich (noch niemand
 *  eingeloggt). Bewusst OHNE allowCredentials → discoverable: das Gerät zeigt
 *  selbst den Konto-Auswähler (Multi-User auf geteiltem Gerät). */
export async function POST() {
  const options = await generateAuthenticationOptions({
    rpID: getRpID(),
    userVerification: 'required',
  })

  const flowId = await saveChallenge(options.challenge, 'authentication')
  return NextResponse.json({ options, flowId })
}
