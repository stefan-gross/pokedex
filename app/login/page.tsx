'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { GlassBackground } from '@/components/GlassBackground'
import { Button } from '@/components/ui/button'

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
    <div className="relative min-h-screen flex">
      <GlassBackground />

      {/* Left panel — desktop only, sitzt direkt auf dem Verlauf */}
      <div className="hidden lg:flex w-2/5 flex-col justify-between p-14">
        <div className="flex flex-col gap-2">
          <span className="text-8xl">🎴</span>
          <span className="text-glass font-bold text-6xl leading-none mt-2 dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.25)]">Pokédex</span>
        </div>
        <div>
          <h1 className="text-4xl font-semibold text-glass leading-snug mb-5 dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.2)]">
            Deine Sammlung.<br />Immer dabei.
          </h1>
          <p className="text-glass-muted text-base leading-relaxed">
            Karten scannen, in Mappen verwalten,<br />Marktpreise im Blick.
          </p>
          <div className="mt-10 flex flex-col gap-4">
            {[
              'Karten per Kamera scannen',
              'Mappen & Boxen verwalten',
              'Marktpreise & Wunschlisten',
            ].map(f => (
              <div key={f} className="flex items-center gap-3 text-base text-[#3a3d42] dark:text-white/85">
                <div className="w-6 h-6 rounded-full bg-[rgba(30,40,80,0.08)] dark:bg-white/20 flex items-center justify-center flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-[#1E2024] dark:bg-white" />
                </div>
                {f}
              </div>
            ))}
          </div>
        </div>
        <a href="https://hub.smartfamilyzone.de" className="text-glass-muted hover:text-[#1E2024] dark:text-white/60 dark:hover:text-white/85 text-sm transition-colors">
          ← Smart Family Zone
        </a>
      </div>

      {/* Right panel / Login form — Glas-Karte auf dem Verlauf */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="glass w-full max-w-sm rounded-[28px] p-8">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <span className="text-3xl">🎴</span>
            <span className="font-semibold text-glass text-lg">Pokédex</span>
          </div>

          <h2 className="text-role-h1 text-glass mb-2 dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.2)]">Willkommen zurück</h2>
          <p className="text-role-body text-glass-muted mb-8">Melde dich mit deinem Familienkonto an.</p>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-role-label text-glass-muted mb-2">E-Mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="name@beispiel.de"
                className="w-full px-4 py-3 rounded-xl text-role-body glass-inner text-glass placeholder:text-glass-muted focus:outline-none focus:ring-1 focus:ring-ring transition"
              />
            </div>
            <div>
              <label className="block text-role-label text-glass-muted mb-2">Passwort</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl text-role-body glass-inner text-glass placeholder:text-glass-muted focus:outline-none focus:ring-1 focus:ring-ring transition"
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
