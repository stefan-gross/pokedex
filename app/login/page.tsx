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
    <div className="min-h-screen bg-[#0f1117] flex">
      {/* Left panel — desktop only */}
      <div className="hidden lg:flex w-2/5 flex-col justify-between p-14">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🎴</span>
          <span className="text-white font-semibold text-lg">Pokédex</span>
        </div>
        <div>
          <h1 className="text-4xl font-semibold text-white leading-snug mb-5">
            Deine Sammlung.<br />Immer dabei.
          </h1>
          <p className="text-white/40 text-base leading-relaxed">
            Karten scannen, in Mappen verwalten,<br />Marktpreise im Blick.
          </p>
          <div className="mt-10 flex flex-col gap-4">
            {[
              'Karten per Kamera scannen',
              'Mappen & Boxen verwalten',
              'Marktpreise & Wunschlisten',
            ].map(f => (
              <div key={f} className="flex items-center gap-3 text-base text-white/60">
                <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                </div>
                {f}
              </div>
            ))}
          </div>
        </div>
        <a href="https://hub.smartfamilyzone.de" className="text-white/30 hover:text-white/50 text-sm transition-colors">
          ← Smart Family Zone
        </a>
      </div>

      {/* Right panel / Login form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white lg:rounded-l-3xl">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <span className="text-3xl">🎴</span>
            <span className="font-semibold text-gray-900 text-lg">Pokédex</span>
          </div>

          <h2 className="text-2xl md:text-3xl font-semibold text-gray-900 mb-2">Willkommen zurück</h2>
          <p className="text-base text-gray-400 mb-8">Melde dich mit deinem Familienkonto an.</p>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">E-Mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="name@beispiel.de"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Passwort</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent transition"
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white font-semibold py-3.5 rounded-xl text-base transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Anmelden…</>
              ) : 'Anmelden'}
            </button>
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
