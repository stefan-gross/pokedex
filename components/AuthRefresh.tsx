'use client'

import { useEffect } from 'react'
import { onIdTokenChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { getSyncMeta } from '@/lib/firestore/catalog'

/**
 * Lauscht auf Firebase Token-Erneuerungen und aktualisiert den Session-Cookie.
 * Firebase erneuert den Token automatisch alle ~55 Minuten.
 *
 * Zusätzlich: Firestore-Cold-Start aufwärmen. Erste Query in einer frischen
 * PWA-Session braucht ~30s für WebSocket+Metadaten-Sync; ohne Warm-up wird
 * jeder erste echte Lookup (Scan, Suche, Set-Liste) gleich lang hängen.
 * Das SDK queued spätere Queries auf dieselbe Verbindung — Warm-up blockt
 * nichts, sondern beschleunigt parallele User-Queries auf demselben Handshake.
 */
export default function AuthRefresh() {
  useEffect(() => {
    // Fire-and-forget Warm-up. tcg_catalog_meta hat public-read-Rule, kein Auth nötig.
    getSyncMeta().catch(() => {})

    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      if (user) {
        const idToken = await user.getIdToken()
        await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        })
      }
    })
    return () => unsubscribe()
  }, [])

  return null
}
