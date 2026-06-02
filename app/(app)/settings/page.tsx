'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, Sun, Moon, Smartphone, RefreshCw,
  Database, CheckCircle, Clock, AlertCircle, RotateCcw, GitBranch,
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

  /* ── Sync state ─────────────────────────────────── */
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncLoading, setSyncLoading] = useState(true);
  const [syncing, setSyncing]         = useState(false);
  const [syncResult, setSyncResult]   = useState<string | null>(null);
  const [enriching, setEnriching]           = useState(false);
  const [enrichResult, setEnrichResult]     = useState<string | null>(null);
  const [enrichingDe, setEnrichingDe]       = useState(false);
  const [enrichResultDe, setEnrichResultDe] = useState<string | null>(null);

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

  async function enrichEvolution() {
    setEnriching(true);
    setEnrichResult(null);
    try {
      let total = 0;
      while (true) {
        const res = await fetch('/api/admin/enrich-evolution', { method: 'POST' });
        const data = await res.json();
        total += data.enriched ?? 0;
        setEnrichResult(`📥 ${total} Karten angereichert…`);
        if (data.status !== 'in-progress') {
          setEnrichResult(data.status === 'complete'
            ? `✅ ${total} Karten mit Evolutionsdaten angereichert`
            : data.message);
          break;
        }
      }
    } catch (e) {
      setEnrichResult(`Fehler: ${e}`);
    } finally {
      setEnriching(false);
    }
  }

  async function enrichGermanNames() {
    setEnrichingDe(true);
    setEnrichResultDe(null);
    try {
      let total = 0;
      while (true) {
        const res  = await fetch('/api/admin/enrich-german-names', { method: 'POST' });
        const data = await res.json();
        total += data.enriched ?? 0;
        setEnrichResultDe(`📥 ${total} Karten angereichert…`);
        if (data.status !== 'in-progress') {
          setEnrichResultDe(data.status === 'complete'
            ? `✅ ${total} Karten mit deutschen Namen angereichert`
            : data.message);
          break;
        }
      }
    } catch (e) {
      setEnrichResultDe(`Fehler: ${e}`);
    } finally {
      setEnrichingDe(false);
    }
  }

  async function resetAndResync() {
    if (!confirm('Catalog zurücksetzen und alle Karten neu laden?\nDas überschreibt alle vorhandenen Catalog-Daten und kann einige Minuten dauern.')) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      // Schritt 1: Meta zurücksetzen
      await fetch('/api/admin/trigger-sync?mode=reset', { method: 'POST' });
      await loadSyncStatus();
      // Schritt 2: normaler Auto-Sync (läuft durch bis fertig)
      await runSync('auto');
    } finally {
      setSyncing(false);
    }
  }

  async function runSync(mode: 'auto' | 'update') {
    setSyncing(true);
    setSyncResult(null);

    // Alle 2 Sek. Status aus Firestore lesen → Live-Fortschritt im UI
    const poller = setInterval(() => loadSyncStatus(), 2000);

    let retries = 0;
    const MAX_RETRIES = 5;

    try {
      while (true) {
        let res: Response;
        let text: string;
        try {
          res  = await fetch(`/api/admin/trigger-sync?mode=${mode}`, { method: 'POST' });
          text = await res.text();
        } catch (networkErr) {
          // Netzwerkfehler (z.B. Vercel Timeout) → kurz warten, nochmal versuchen
          retries++;
          if (retries > MAX_RETRIES) {
            setSyncResult(`Netzwerkfehler nach ${MAX_RETRIES} Versuchen. Bitte "Fortsetzen" klicken.`);
            break;
          }
          setSyncResult(`Verbindungsfehler – Versuch ${retries}/${MAX_RETRIES}…`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        if (!res.ok) {
          // Vercel Timeout (504) oder anderer Server-Fehler → retry
          retries++;
          if (retries > MAX_RETRIES) {
            setSyncResult(`Server-Fehler (${res.status}) nach ${MAX_RETRIES} Versuchen. Bitte "Fortsetzen" klicken.`);
            break;
          }
          setSyncResult(`Server-Fehler ${res.status} – Versuch ${retries}/${MAX_RETRIES}…`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        retries = 0; // Erfolgreicher Request → Zähler zurücksetzen
        let data: { done?: boolean; status?: string; message?: string; error?: string } = {};
        try { data = JSON.parse(text); } catch { /* ignore */ }

        if (mode === 'update' || data.done || data.status === 'complete' || data.status === 'up-to-date') {
          setSyncResult(data.message ?? '✅ Fertig');
          break;
        }
        if (data.status === 'error' || data.error) {
          setSyncResult(data.error ?? data.message ?? 'Unbekannter Fehler');
          break;
        }
        await new Promise(r => setTimeout(r, 300));
      }
      await loadSyncStatus();
    } catch (err) {
      setSyncResult('Netzwerk-Fehler: ' + String(err));
    } finally {
      clearInterval(poller);
      setSyncing(false);
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
                {/* Status-Zeile */}
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

                {/* Fortschritt */}
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

                {/* Ergebnis letzter Sync */}
                {syncResult && (
                  <div className="px-4 py-2.5 border-b border-border text-xs text-muted-foreground">
                    {syncResult}
                  </div>
                )}

                {/* Aktions-Buttons */}
                <button
                  onClick={() => runSync('update')}
                  disabled={syncing || (isComplete && !hasNew)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-secondary disabled:opacity-40"
                >
                  <RefreshCw size={18} className={`text-muted-foreground shrink-0 ${syncing ? 'animate-spin' : ''}`} />
                  <div>
                    <p className="text-sm font-medium">
                      {hasNew ? `${syncStatus!.newCards.toLocaleString('de-DE')} neue Karten holen` : 'Auf neue Karten prüfen'}
                    </p>
                    <p className="text-xs text-muted-foreground">Wöchentlich automatisch um Mo. 3:00 Uhr</p>
                  </div>
                </button>

                {!isComplete && (
                  <button
                    onClick={() => runSync('auto')}
                    disabled={syncing}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left border-t border-border transition-colors active:bg-secondary disabled:opacity-40"
                  >
                    <Database size={18} className={`text-muted-foreground shrink-0 ${syncing ? 'animate-pulse' : ''}`} />
                    <div>
                      <p className="text-sm font-medium">
                        {syncing
                          ? `Synchronisiert… ${(syncStatus?.syncedTotal ?? 0).toLocaleString('de-DE')} / ${(syncStatus?.currentTotal ?? 0).toLocaleString('de-DE')} Karten`
                          : 'Initialen Sync fortsetzen'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {syncing ? `${pct}% abgeschlossen` : 'Nächste Karten in Firestore laden'}
                      </p>
                    </div>
                  </button>
                )}

                {/* Evolutionsdaten anreichern */}
                <button
                  onClick={enrichEvolution}
                  disabled={enriching || syncing}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left border-t border-border transition-colors active:bg-secondary disabled:opacity-40"
                >
                  {enriching
                    ? <RefreshCw size={18} className="text-blue-500 shrink-0 animate-spin" />
                    : <GitBranch size={18} className="text-blue-500 shrink-0" />
                  }
                  <div>
                    <p className="text-sm font-medium text-blue-500">Evolutionsdaten anreichern</p>
                    <p className="text-xs text-muted-foreground">
                      {enrichResult ?? 'Evolutionslinien in alle Karten schreiben · einmalig nötig'}
                    </p>
                  </div>
                </button>

                {/* Deutsche Namen anreichern */}
                <button
                  onClick={enrichGermanNames}
                  disabled={enrichingDe || syncing}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left border-t border-border transition-colors active:bg-secondary disabled:opacity-40"
                >
                  {enrichingDe
                    ? <RefreshCw size={18} className="text-green-500 shrink-0 animate-spin" />
                    : <span className="text-base shrink-0">🇩🇪</span>
                  }
                  <div>
                    <p className="text-sm font-medium text-green-600 dark:text-green-400">Deutsche Namen anreichern</p>
                    <p className="text-xs text-muted-foreground">
                      {enrichResultDe ?? 'nameDe + nameDeLower aus TCGdex befüllen · einmalig nötig'}
                    </p>
                  </div>
                </button>

                {/* Catalog komplett neu aufbauen (z.B. nach Schema-Änderung) */}
                <button
                  onClick={resetAndResync}
                  disabled={syncing}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left border-t border-border transition-colors active:bg-secondary disabled:opacity-40"
                >
                  <RotateCcw size={18} className="text-orange-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-orange-500">Catalog komplett neu aufbauen</p>
                    <p className="text-xs text-muted-foreground">Alle Karten neu laden · z.B. nach Datenbank-Update</p>
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
