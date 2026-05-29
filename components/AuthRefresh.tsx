'use client'

import { useEffect } from 'react'
import { onIdTokenChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

/**
 * Lauscht auf Firebase Token-Erneuerungen und aktualisiert den Session-Cookie.
 * Firebase erneuert den Token automatisch alle ~55 Minuten.
 */
export default function AuthRefresh() {
  useEffect(() => {
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
