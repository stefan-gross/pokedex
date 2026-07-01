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
// ignoreUndefinedProperties: Felder mit Wert undefined werden stillschweigend weggelassen
export const db = isNew
  ? initializeFirestore(app, { ignoreUndefinedProperties: true })
  : getFirestore(app)
export default app
