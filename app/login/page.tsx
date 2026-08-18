'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { PokemonWall } from '@/components/PokemonWall'
import { PokedexWordmark } from '@/components/PokedexWordmark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
      if (!res.ok) throw new Error('session')
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
    <div className="relative min-h-screen flex items-center justify-center p-6 bg-[#f4f6fb] dark:bg-[#0f1117]">
      <PokemonWall />

      <div className="relative w-full max-w-sm flex flex-col items-center">
        {/* Schriftzug + Tagline über der Login-Karte */}
        <PokedexWordmark className="text-6xl mb-2" />
        <p className="text-black/60 dark:text-white/70 text-role-body mb-8">Deine Sammlung. Immer dabei.</p>

        <div className="glass w-full rounded-[28px] p-8">
          <h2 className="text-role-h1 text-glass mb-2 dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.2)]">Willkommen zurück</h2>
          <p className="text-role-body text-glass-muted mb-8">Melde dich mit deinem Familienkonto an.</p>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-role-label text-glass-muted mb-2">E-Mail</label>
              <Input
                type="email"
                value={email}
                onChange={setEmail}
                required
                name="email"
                autoComplete="email"
                placeholder="name@beispiel.de"
                size="lg"
              />
            </div>
            <div>
              <label className="block text-role-label text-glass-muted mb-2">Passwort</label>
              <Input
                type="password"
                value={password}
                onChange={setPassword}
                required
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
                size="lg"
              />
            </div>

            {error && (
              <div className="text-role-body text-[#7a1414] dark:text-white px-4 py-3 rounded-xl" style={{ background: 'rgba(220,38,38,0.16)', border: '1px solid rgba(220,38,38,0.3)' }}>
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? (
                <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Anmelden…</>
              ) : 'Anmelden'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
