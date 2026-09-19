import { getAdminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Firestore-Ablage für Passkeys (WebAuthn). Läuft ausschließlich serverseitig
 * über das Admin-SDK (die API-Routes), nie über das Client-SDK.
 *
 * Datenmodell:
 *  - `webauthn_credentials/<uid>` → { credentials: StoredCredential[] }
 *        Mehrere Passkeys pro Nutzer (ein Eintrag je Gerät). → Multi-Device.
 *  - `webauthn_by_credential/<credentialId>` → { uid }
 *        Rückwärts-Lookup beim Login: die Assertion liefert nur die
 *        Credential-ID, daraus muss der Server die uid auflösen. → Multi-User
 *        (discoverable Login ohne vorherige uid).
 *  - `webauthn_challenges/<flowId>` → { challenge, type, uid?, createdAt }
 *        Kurzlebige, einmalige Challenges (Registrierung + Login).
 */

const CREDENTIALS = 'webauthn_credentials'
const BY_CREDENTIAL = 'webauthn_by_credential'
const CHALLENGES = 'webauthn_challenges'

/** Gültigkeitsdauer einer Challenge (5 min) — danach abgelaufen. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000

export interface StoredCredential {
  /** Credential-ID (Base64URL) — eindeutig je Passkey. */
  id: string
  /** Public Key (Base64URL-kodierte COSE-Bytes). */
  publicKey: string
  /** Signatur-Zähler (Replay-Schutz). */
  counter: number
  /** Transports (z.B. 'internal', 'hybrid') für bessere UX bei Folge-Logins. */
  transports?: string[]
  /** Anzeigename des Geräts (vom Nutzer/aus dem UA abgeleitet). */
  deviceLabel: string
  createdAt: number
  lastUsedAt: number
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export async function getCredentialsForUid(uid: string): Promise<StoredCredential[]> {
  const snap = await getAdminDb().collection(CREDENTIALS).doc(uid).get()
  if (!snap.exists) return []
  return (snap.data()?.credentials as StoredCredential[] | undefined) ?? []
}

/** Löst eine Credential-ID → uid auf (Login-Pfad, discoverable). */
export async function getUidByCredentialId(credentialId: string): Promise<string | null> {
  const snap = await getAdminDb().collection(BY_CREDENTIAL).doc(credentialId).get()
  return snap.exists ? ((snap.data()?.uid as string | undefined) ?? null) : null
}

export async function findCredential(
  uid: string,
  credentialId: string,
): Promise<StoredCredential | null> {
  const creds = await getCredentialsForUid(uid)
  return creds.find(c => c.id === credentialId) ?? null
}

/** Neuen Passkey ablegen (Credential-Liste + Rückwärts-Lookup). */
export async function addCredential(uid: string, cred: StoredCredential): Promise<void> {
  const db = getAdminDb()
  await db.collection(CREDENTIALS).doc(uid).set(
    { credentials: FieldValue.arrayUnion(cred) },
    { merge: true },
  )
  await db.collection(BY_CREDENTIAL).doc(cred.id).set({ uid, createdAt: cred.createdAt })
}

/** Zähler + lastUsedAt nach erfolgreichem Login fortschreiben. */
export async function updateCredentialCounter(
  uid: string,
  credentialId: string,
  newCounter: number,
): Promise<void> {
  const db = getAdminDb()
  const ref = db.collection(CREDENTIALS).doc(uid)
  const snap = await ref.get()
  const creds = (snap.data()?.credentials as StoredCredential[] | undefined) ?? []
  const next = creds.map(c =>
    c.id === credentialId ? { ...c, counter: newCounter, lastUsedAt: Date.now() } : c,
  )
  await ref.update({ credentials: next })
}

/** Passkey entfernen (aus Liste + Rückwärts-Lookup). */
export async function removeCredential(uid: string, credentialId: string): Promise<void> {
  const db = getAdminDb()
  const ref = db.collection(CREDENTIALS).doc(uid)
  const snap = await ref.get()
  const creds = (snap.data()?.credentials as StoredCredential[] | undefined) ?? []
  await ref.update({ credentials: creds.filter(c => c.id !== credentialId) })
  await db.collection(BY_CREDENTIAL).doc(credentialId).delete()
}

// ---------------------------------------------------------------------------
// Challenges (einmalig, kurzlebig)
// ---------------------------------------------------------------------------

export type ChallengeType = 'registration' | 'authentication'

/** Challenge ablegen, gibt die flowId (Doc-ID) zurück. */
export async function saveChallenge(
  challenge: string,
  type: ChallengeType,
  uid?: string,
): Promise<string> {
  const flowId = crypto.randomUUID()
  await getAdminDb().collection(CHALLENGES).doc(flowId).set({
    challenge,
    type,
    uid: uid ?? null,
    createdAt: Date.now(),
  })
  return flowId
}

/** Challenge einmalig einlösen: liest + löscht sie und prüft die TTL.
 *  Gibt null zurück, wenn unbekannt, abgelaufen oder Typ-fremd. */
export async function consumeChallenge(
  flowId: string,
  type: ChallengeType,
): Promise<{ challenge: string; uid: string | null } | null> {
  const ref = getAdminDb().collection(CHALLENGES).doc(flowId)
  const snap = await ref.get()
  if (!snap.exists) return null
  await ref.delete() // einmalig — sofort verbrauchen
  const data = snap.data()!
  if (data.type !== type) return null
  if (Date.now() - (data.createdAt as number) > CHALLENGE_TTL_MS) return null
  return { challenge: data.challenge as string, uid: (data.uid as string | null) ?? null }
}
