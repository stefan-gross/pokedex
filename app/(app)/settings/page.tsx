'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, Sun, Moon, Smartphone, RefreshCw,
  Database, CheckCircle, Clock, AlertCircle, RotateCcw,
} from 'lucide-react';
import Link from 'next/link';
import type { SyncMeta } from '@/lib/firestore/catalog';

const THEMES = [
  { value: 'system', label: 'System', icon: Smartphone },
  { value: 'light',  label: 'Hell',   icon: Sun },
  { value: 'dark',   label: 'Dunkel', icon: Moon },
] as const;

interface SyncStatus extends SyncMeta { newCards: number }

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncLoading, setSyncLoading] = useState(true);
  const [syncing, setSyncing]         = useState(false);
  const [syncResult, setSyncResult]   = useState<string | null>(null);
  const [runningAll,  setRunningAll]  = useState(false);
  const [allProgress, setAllProgress] = useState<string | null>(null);

  useEffect(() => { setMounted(true); loadSyncStatus(); }, []);

  async function loadSyncStatus() {
    try {
      const res = await fetch('/api/admin/trigger-sync');
      if (res.ok) {
        const data = await res.json();
        setSyncStatus({ ...data, newCards: (data.currentTotal ?? 0) - (data.syncedTotal ?? 0) });
      }
    } catch { /* ignore */ } finally {
      setSyncLoading(false);
    }
  }

  async function runSync(mode: 'auto' | 'update') {
    setSyncing(true);
    setSyncResult(null);
    const poller = setInterval(() => loadSyncStatus(), 2000);
    let retries = 0;
    try {
      while (true) {
        let res: Response, text: string;
        try {
          res  = await fetch(`/api/admin/trigger-sync?mode=${mode}`, { method: 'POST' });
          text = await res.text();
        } catch {
          if (++retries > 5) { setSyncResult(`Netzwerkfehler. Bitte erneut versuchen.`); break; }
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        if (!res.ok) {
          if (++retries > 5) { setSyncResult(`Server-Fehler (${res.status}). Bitte erneut versuchen.`); break; }
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        retries = 0;
        let data: { done?: boolean; status?: string; message?: string; error?: string } = {};
        try { data = JSON.parse(text); } catch { /* ignore */ }
        if (mode === 'update' || data.done || data.status === 'complete' || data.status === 'up-to-date') {
          setSyncResult(data.message ?? '✅ Fertig');
          break;
        }
        if (data.status === 'error' || data.error) { setSyncResult(data.error ?? data.message ?? 'Fehler'); break; }
        await new Promise(r => setTimeout(r, 300));
      }
      await loadSyncStatus();
    } finally {
      clearInterval(poller);
      setSyncing(false);
    }
  }

  async function runAllSteps(withReset: boolean) {
    if (withReset) {
      if (!confirm('Catalog zurücksetzen und alle Schritte komplett neu ausführen?\nDas kann mehrere Minuten dauern.')) return;
    }
    setRunningAll(true);
    setSyncing(true);
    const step = (msg: string) => setAllProgress(msg);
    step(withReset ? '↺ Catalog wird zurückgesetzt…' : '▶ Starte…');

    try {
      // 1. Catalog-Sync
      if (withReset) {
        await fetch('/api/admin/trigger-sync?mode=reset', { method: 'POST' });
        await loadSyncStatus();
      }
      step('📥 (1/5) Catalog wird synchronisiert…');
      const poller = setInterval(loadSyncStatus, 2000);
      let retries = 0;
      while (true) {
        let res: Response, text: string;
        try {
          res  = await fetch('/api/admin/trigger-sync?mode=auto', { method: 'POST' });
          text = await res.text();
        } catch {
          if (++retries > 5) break;
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        retries = 0;
        let d: { done?: boolean; status?: string } = {};
        try { d = JSON.parse(text); } catch { /* ignore */ }
        if (d.done || d.status === 'complete' || d.status === 'up-to-date') break;
        if (d.status === 'error') break;
        await new Promise(r => setTimeout(r, 300));
      }
      clearInterval(poller);
      await loadSyncStatus();

      // 2. Evolutionsdaten
      step('🧬 (2/5) Evolutionsdaten werden angereichert…');
      let evoTotal = 0;
      while (true) {
        const res  = await fetch('/api/admin/enrich-evolution', { method: 'POST' });
        const data = await res.json();
        evoTotal += data.enriched ?? 0;
        step(`🧬 (2/5) Evolutionsdaten: ${evoTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 3. Deutsche Namen
      step('🇩🇪 (3/5) Deutsche Namen werden angereichert…');
      let deTotal = 0;
      while (true) {
        const res  = await fetch('/api/admin/enrich-german-names', { method: 'POST' });
        const data = await res.json();
        deTotal += data.enriched ?? 0;
        step(`🇩🇪 (3/5) Deutsche Namen: ${deTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 4. Sets
      step('🗂️ (4/5) Sets werden synchronisiert…');
      await fetch('/api/admin/sync-sets', { method: 'POST' });

      // 5. Set-Kürzel
      step('🏷️ (5/5) Set-Kürzel werden geschrieben…');
      const bfRes  = await fetch('/api/admin/backfill-set-codes', { method: 'POST' });
      const bfData = await bfRes.json();

      step(`✅ Fertig — ${deTotal} DE-Namen · ${evoTotal} Evo-Daten · ${bfData.updated ?? 0} Set-Kürzel`);
    } catch (e) {
      step(`Fehler: ${e}`);
    } finally {
      setRunningAll(false);
      setSyncing(false);
      await loadSyncStatus();
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const pct        = syncStatus ? Math.round(((syncStatus.syncedTotal ?? 0) / (syncStatus.currentTotal || 1)) * 100) : 0;
  const isComplete = pct >= 100;
  const hasNew     = (syncStatus?.newCards ?? 0) > 0;
  const busy       = runningAll || syncing;

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

        {/* Karten-Catalog */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Karten-Catalog</p>
          <div className="bg-card border border-border rounded-xl overflow-hidden">

            {syncLoading ? (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Status */}
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database size={16} className="text-muted-foreground shrink-0" />
                    <p className="text-sm font-medium">Sync-Status</p>
                  </div>
                  {isComplete
                    ? <span className="flex items-center gap-1 text-xs text-green-500"><CheckCircle size={12} /> Aktuell</span>
                    : hasNew
                      ? <span className="flex items-center gap-1 text-xs text-yellow-500"><Clock size={12} /> Update verfügbar</span>
                      : (syncStatus?.syncedTotal ?? 0) === 0
                        ? <span className="text-xs text-muted-foreground">Noch nicht gestartet</span>
                        : <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--pokedex-red)' }}><Clock size={12} /> Unvollständig</span>
                  }
                </div>

                {/* Fortschrittsbalken */}
                <div className="px-4 py-3 space-y-2 border-b border-border">
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: isComplete ? '#48bb78' : 'var(--pokedex-red)' }} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{(syncStatus?.syncedTotal ?? 0).toLocaleString('de-DE')} gecacht</span>
                    <span>{pct}% · {(syncStatus?.currentTotal ?? 0).toLocaleString('de-DE')} gesamt</span>
                  </div>
                  {syncStatus?.lastSynced && (
                    <p className="text-xs text-muted-foreground">
                      Letzter Sync: {new Date(syncStatus.lastSynced).toLocaleString('de-DE')}
                    </p>
                  )}
                  {hasNew && (
                    <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-yellow-500/10 text-yellow-600">
                      <AlertCircle size={12} />
                      {syncStatus!.newCards.toLocaleString('de-DE')} neue Karten verfügbar
                    </div>
                  )}
                </div>

                {/* Fortschritt kombinierter Lauf */}
                {allProgress && (
                  <div
                    className="px-4 py-2.5 border-b border-border text-xs font-medium"
                    style={{ color: allProgress.startsWith('✅') ? '#48bb78' : allProgress.startsWith('Fehler') ? 'var(--pokedex-red)' : 'var(--foreground)' }}
                  >
                    {allProgress}
                  </div>
                )}

                {/* Ergebnis letzter Einzel-Sync */}
                {syncResult && !runningAll && (
                  <div className="px-4 py-2.5 border-b border-border text-xs text-muted-foreground">
                    {syncResult}
                  </div>
                )}

                {/* Auf neue Karten prüfen */}
                <button
                  onClick={() => runSync('update')}
                  disabled={busy || (isComplete && !hasNew)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left border-b border-border transition-colors active:bg-secondary disabled:opacity-40"
                >
                  <RefreshCw size={18} className={`text-muted-foreground shrink-0 ${syncing && !runningAll ? 'animate-spin' : ''}`} />
                  <div>
                    <p className="text-sm font-medium">
                      {hasNew ? `${syncStatus!.newCards.toLocaleString('de-DE')} neue Karten holen` : 'Auf neue Karten prüfen'}
                    </p>
                    <p className="text-xs text-muted-foreground">Wöchentlich automatisch um Mo. 3:00 Uhr</p>
                  </div>
                </button>

                {/* Alles auf einmal */}
                <button
                  onClick={() => runAllSteps(false)}
                  disabled={busy}
                  className="w-full flex items-center gap-3 px-4 py-4 text-left border-b border-border transition-colors active:bg-secondary disabled:opacity-40"
                  style={{ background: runningAll ? 'color-mix(in srgb, var(--pokedex-red) 6%, transparent)' : undefined }}
                >
                  {runningAll
                    ? <RefreshCw size={20} className="shrink-0 animate-spin" style={{ color: 'var(--pokedex-red)' }} />
                    : <span className="text-xl shrink-0">⚡</span>
                  }
                  <div>
                    <p className="text-[15px] font-bold" style={{ color: 'var(--pokedex-red)' }}>
                      {runningAll ? 'Läuft…' : 'Alles auf einmal ausführen'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Evo · DE-Namen · Sets · Kürzel — alle Schritte nacheinander
                    </p>
                  </div>
                </button>

                {/* Catalog neu aufbauen */}
                <button
                  onClick={() => runAllSteps(true)}
                  disabled={busy}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-secondary disabled:opacity-40"
                >
                  <RotateCcw size={18} className="text-orange-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-orange-500">Catalog komplett neu aufbauen</p>
                    <p className="text-xs text-muted-foreground">Reset + alle 5 Schritte · z.B. nach Datenbank-Update</p>
                  </div>
                </button>
              </>
            )}
          </div>
        </section>

        {/* App */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">App</p>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
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
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-secondary transition-colors"
            >
              <div className="text-sm font-medium text-red-500">Abmelden</div>
            </button>
          </div>
        </section>

      </div>
    </div>
  );
}
