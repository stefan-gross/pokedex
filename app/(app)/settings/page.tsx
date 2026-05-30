'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Sun, Moon, Smartphone, RefreshCw } from 'lucide-react';
import Link from 'next/link';

const THEMES = [
  { value: 'system', label: 'System', icon: Smartphone },
  { value: 'light',  label: 'Hell',   icon: Sun },
  { value: 'dark',   label: 'Dunkel', icon: Moon },
] as const;

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => setMounted(true), []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <div className="sticky top-safe z-20 bg-background border-b border-border px-4 pt-4 pb-3 flex items-center gap-3">
        <Link href="/" className="text-muted-foreground">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="font-semibold text-base">Einstellungen</h1>
      </div>

      <div className="px-4 py-5 space-y-6">

        {/* Erscheinungsbild */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Erscheinungsbild</p>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-sm font-medium">Farbschema</p>
              <p className="text-xs text-muted-foreground mt-0.5">Hell, dunkel oder wie dein System</p>
            </div>
            {mounted && (
              <div className="flex divide-x divide-border">
                {THEMES.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    className="flex-1 flex flex-col items-center gap-1.5 py-4 text-xs font-medium transition-colors"
                    style={{
                      color: theme === value ? 'var(--pokedex-red)' : 'var(--muted-foreground)',
                      background: theme === value ? 'color-mix(in srgb, var(--pokedex-red) 8%, transparent)' : undefined,
                    }}
                  >
                    <Icon size={20} strokeWidth={theme === value ? 2.5 : 1.8} />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* App */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">App</p>
          <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            <button
              onClick={() => window.location.reload()}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-secondary transition-colors"
            >
              <RefreshCw size={18} className="text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">App neu laden</p>
                <p className="text-xs text-muted-foreground">Aktualisiert die App auf die neueste Version</p>
              </div>
            </button>
          </div>
        </section>

        {/* Account */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Account</p>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-secondary transition-colors text-red-500"
            >
              <div className="text-sm font-medium">Abmelden</div>
            </button>
          </div>
        </section>

      </div>
    </div>
  );
}
