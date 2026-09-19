import { NextRequest, NextResponse } from 'next/server'
import { getSessionUid } from '@/lib/webauthn'
import { getCredentialsForUid, removeCredential } from '@/lib/firestore/webauthn'

/** Registrierte Passkeys des eingeloggten Nutzers auflisten (für die Geräteliste
 *  in den Einstellungen). Public Keys werden NICHT ausgeliefert. */
export async function GET(req: NextRequest) {
  const uid = await getSessionUid(req)
  if (!uid) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })

  const creds = await getCredentialsForUid(uid)
  return NextResponse.json({
    credentials: creds.map(c => ({
      id: c.id,
      deviceLabel: c.deviceLabel,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
    })),
  })
}

/** Einen Passkey entfernen. */
export async function DELETE(req: NextRequest) {
  const uid = await getSessionUid(req)
  if (!uid) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })

  const { credentialId } = await req.json()
  if (!credentialId) return NextResponse.json({ error: 'credentialId fehlt' }, { status: 400 })

  await removeCredential(uid, credentialId)
  return NextResponse.json({ success: true })
}
