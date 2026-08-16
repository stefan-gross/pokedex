import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { initializeFirestore, getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
}

const isNew = getApps().length === 0
const app   = isNew ? initializeApp(firebaseConfig) : getApps()[0]

export const auth = getAuth(app)

/** Firebase-uid des aktuell eingeloggten Nutzers (oder undefined). Wird beim
 *  Anlegen von Nutzer-Dokumenten als `ownerUid` gesetzt (IDOR-Härtung: Daten
 *  gehören einem Nutzer, nicht „irgendeiner Session"). Dank
 *  `ignoreUndefinedProperties` ist ein undefined-Wert beim Write unkritisch. */
export function currentUid(): string | undefined {
  return auth.currentUser?.uid ?? undefined
}
// ignoreUndefinedProperties: Felder mit Wert undefined werden stillschweigend weggelassen
// experimentalAutoDetectLongPolling: der Firestore-Client nutzt sonst WebChannel-
// Streaming; wird das vom Netz/Proxy (z.B. Mobilfunk, iOS-PWA) blockiert, HÄNGT
// die ERSTE Abfrage je Session ~30s, bevor sie auf Long-Polling zurückfällt —
// das war die Ursache für ~30s „lookup" beim ersten Scan. Auto-Detect erkennt
// das sofort und wählt gleich den funktionierenden Transport.
export const db = isNew
  ? initializeFirestore(app, { ignoreUndefinedProperties: true, experimentalAutoDetectLongPolling: true })
  : getFirestore(app)
export default app
