'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get('return') || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { user } = await signInWithEmailAndPassword(auth, email, password)
      const idToken = await user.getIdToken()
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      if (!res.ok) throw new Error('Session konnte nicht erstellt werden')
      router.push(returnTo)
      router.refresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
        setError('E-Mail oder Passwort falsch.')
      } else if (msg.includes('too-many-requests')) {
        setError('Zu viele Versuche. Bitte kurz warten.')
      } else {
        setError('Anmeldung fehlgeschlagen. Bitte erneut versuchen.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">E-Mail</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          placeholder="name@beispiel.de"
          className="w-full h-11 px-4 rounded-xl bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Passwort</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className="w-full h-11 px-4 rounded-xl bg-secondary border border-border text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
        />
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full h-11 rounded-xl font-semibold text-sm text-white disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity"
        style={{ background: 'var(--pokedex-red)' }}
      >
        {loading ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Anmelden…
          </>
        ) : 'Anmelden'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-12">
      {/* Logo / Titel */}
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">🎴</div>
        <h1 className="text-2xl font-bold">Pokédex</h1>
        <p className="text-sm text-muted-foreground mt-1">Deine Kartensammlung</p>
      </div>

      {/* Login Card */}
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-lg">
        <h2 className="font-semibold text-base mb-5">Anmelden</h2>
        <Suspense fallback={<div className="h-48" />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
