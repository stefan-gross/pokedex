import { NextRequest, NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { getRpID, RP_NAME, getSessionUid } from '@/lib/webauthn'
import { getCredentialsForUid, saveChallenge } from '@/lib/firestore/webauthn'

/** Schritt 1 der Passkey-Registrierung: Challenge + Optionen erzeugen.
 *  Nur für bereits regulär eingeloggte Nutzer (Session-Cookie nötig). */
export async function POST(req: NextRequest) {
  const uid = await getSessionUid(req)
  if (!uid) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })

  const existing = await getCredentialsForUid(uid)

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpID(),
    userID: new TextEncoder().encode(uid),
    userName: uid,
    // Bereits registrierte Passkeys ausschließen (kein Doppel-Anlegen auf demselben Gerät).
    excludeCredentials: existing.map(c => ({ id: c.id, transports: c.transports as never })),
    authenticatorSelection: {
      // residentKey/discoverable = Passkey trägt die uid → Login ohne E-Mail-Eingabe (Multi-User).
      residentKey: 'required',
      userVerification: 'required',
    },
  })

  const flowId = await saveChallenge(options.challenge, 'registration', uid)
  return NextResponse.json({ options, flowId })
}
