import { initializeApp, getApps } from 'firebase/app'
import { getAuth, onIdTokenChanged } from 'firebase/auth'
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

// uid für owner-gescopte READS: direkt nach dem Login/Seitenladen ist
// `auth.currentUser` oft noch `null` (Session-Restore aus IndexedDB läuft
// async). Ein sofortiges `currentUid()` → undefined → Reads liefern `[]`
// („0 Sammlungen", lädt endlos). `waitForUid` wartet auf den ersten echten
// User (oder bis Timeout wirklich ausgeloggt) — analog zu `waitForAuthUser`
// in rest-shared.ts. Ein `null`-Ergebnis wird NICHT gecacht, damit ein
// späterer Read einen inzwischen wiederhergestellten Login aufgreift.
const UID_WAIT_MS = 5000
let uidReadyPromise: Promise<string | null> | null = null
export function waitForUid(): Promise<string | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser.uid)
  if (!uidReadyPromise) {
    uidReadyPromise = new Promise<string | null>(resolve => {
      let settled = false
      const finish = (u: string | null) => {
        if (settled) return
        settled = true
        unsubscribe()
        resolve(u)
      }
      const unsubscribe = onIdTokenChanged(auth, user => { if (user) finish(user.uid) })
      setTimeout(() => finish(auth.currentUser?.uid ?? null), UID_WAIT_MS)
    })
    uidReadyPromise.then(u => { if (!u) uidReadyPromise = null })
  }
  return uidReadyPromise
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
