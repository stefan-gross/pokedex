'use client'

import { useEffect } from 'react'
import { onIdTokenChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { getSyncMeta } from '@/lib/firestore/catalog'

/** Erneuert den Session-Cookie mit einem frischen ID-Token. `getIdToken()`
 *  liefert den gecachten Token bzw. erneuert ihn automatisch, wenn er
 *  abgelaufen/kurz davor ist (über das lang lebende Refresh-Token in
 *  IndexedDB) — so bekommt der Cookie auch nach längerer Hintergrundzeit
 *  wieder 1 h Gültigkeit, OHNE dass man sich neu einloggen muss. */
async function refreshSessionCookie() {
  const user = auth.currentUser
  if (!user) return
  try {
    const idToken = await user.getIdToken()
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })
  } catch (e) {
    console.warn('[auth] Session-Cookie-Refresh fehlgeschlagen', e)
  }
}

/**
 * Hält den Session-Cookie frisch. Firebase erneuert den ID-Token automatisch
 * (~alle 55 min → `onIdTokenChanged`). ZUSÄTZLICH bei Rückkehr in den
 * Vordergrund/Fokus: während die App im Hintergrund war (App gewechselt, Kamera
 * aktiv, iOS-PWA-Reload) kann der 1h-Cookie ablaufen — dann würde die nächste
 * Navigation von `proxy.ts` auf /login geworfen (sieht aus wie „Splash beim
 * Scannen"). Der Vordergrund-Refresh erneuert den Cookie, BEVOR das passiert.
 *
 * Zusätzlich: Firestore-Cold-Start aufwärmen (siehe getSyncMeta unten).
 */
export default function AuthRefresh() {
  useEffect(() => {
    // Sofortiger Warm-up: Firestore-Cold-Start (WebSocket-Handshake) braucht
    // ~30s. Frühe Verbindung steht bereit, wenn die erste echte User-Query feuert.
    getSyncMeta().catch(() => {})

    const unsubscribe = onIdTokenChanged(auth, (user) => { if (user) refreshSessionCookie() })

    const onForeground = () => {
      if (document.visibilityState === 'visible') refreshSessionCookie()
    }
    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('focus', onForeground)

    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('focus', onForeground)
    }
  }, [])

  return null
}
