'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, Sun, Moon, Smartphone, RefreshCw,
  Database, CheckCircle, Clock, AlertCircle, RotateCcw, Trash2,
} from 'lucide-react';
import Link from 'next/link';
import type { SyncMeta } from '@/lib/firestore/catalog';
import { getCards, deleteCard } from '@/lib/firestore/cards';
import { getBinders, updateBinder } from '@/lib/firestore/binders';

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

  async function runAllSteps(withReset: boolean) {
    if (withReset) {
      if (!confirm('Catalog zurücksetzen und alle Schritte komplett neu ausführen?\nDas kann mehrere Minuten dauern.')) return;
    }
    setRunningAll(true);
    setSyncing(true);
    setSyncResult(null);
    const step = (msg: string) => setAllProgress(msg);
    step(withReset ? '↺ Catalog wird zurückgesetzt…' : '▶ Starte…');

    try {
      // 1. Catalog-Sync
      if (withReset) {
        await fetch('/api/admin/trigger-sync?mode=reset', { method: 'POST' });
        await loadSyncStatus();
      }
      step('📥 (1/8) Catalog wird synchronisiert…');
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
      step('🧬 (2/8) Evolutionsdaten werden angereichert…');
      let evoTotal = 0;
      while (true) {
        const res  = await fetch('/api/admin/enrich-evolution', { method: 'POST' });
        const data = await res.json();
        evoTotal += data.enriched ?? 0;
        step(`🧬 (2/8) Evolutionsdaten: ${evoTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 3. Deutsche Namen
      step('🇩🇪 (3/8) Deutsche Namen werden angereichert…');
      let deTotal = 0;
      while (true) {
        const res  = await fetch('/api/admin/enrich-german-names', { method: 'POST' });
        const data = await res.json();
        deTotal += data.enriched ?? 0;
        step(`🇩🇪 (3/8) Deutsche Namen: ${deTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 4. Sets
      step('🗂️ (4/8) Sets werden synchronisiert…');
      await fetch('/api/admin/sync-sets', { method: 'POST' });

      // 5. Set-Kürzel
      step('🏷️ (5/8) Set-Kürzel werden geschrieben…');
      const bfRes  = await fetch('/api/admin/backfill-set-codes', { method: 'POST' });
      const bfData = await bfRes.json();

      // 6. Deutsche Karten-Bilder
      step('🖼️ (6/8) Deutsche Karten-Bilder werden angereichert…');
      let imgTotal = 0;
      let imgFirst = true;
      while (true) {
        const res  = await fetch('/api/admin/enrich-de-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: imgFirst }) });
        imgFirst = false;
        const data = await res.json();
        imgTotal += data.enriched ?? 0;
        step(`🖼️ (6/8) DE-Bilder: ${imgTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 7. Pokémon-Artdaten
      step('🧬 (7/8) Pokémon-Artdaten werden angereichert…');
      let speciesTotal = 0;
      while (true) {
        const res  = await fetch('/api/admin/enrich-species', { method: 'POST' });
        const data = await res.json();
        speciesTotal += data.enriched ?? 0;
        step(`🧬 (7/8) Artdaten: ${speciesTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 8. Varianten aus TCGdex (überschreibt Heuristik-Defaults für Common/Uncommon/Rare etc.)
      step('🃏 (8/8) Varianten werden angereichert…');
      let variantsTotal = 0;
      let variantsFirst = true;
      while (true) {
        const res  = await fetch('/api/admin/enrich-variants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reset: variantsFirst }),
        });
        variantsFirst = false;
        const data = await res.json();
        variantsTotal += data.enriched ?? 0;
        step(`🃏 (8/8) Varianten: ${variantsTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      step(`✅ Fertig — ${deTotal} DE-Namen · ${evoTotal} Evo-Daten · ${bfData.updated ?? 0} Set-Kürzel · ${imgTotal} DE-Bilder · ${speciesTotal} Artdaten · ${variantsTotal} Varianten`);
    } catch (e) {
      step(`Fehler: ${e}`);
    } finally {
      setRunningAll(false);
      setSyncing(false);
      await loadSyncStatus();
    }
  }

  // ── Sammlung zurücksetzen ──────────────────────────────────────────────
  // Löscht alle `cards`-Docs und leert die `cardIds`-Arrays aller Binder.
  // Binder selbst bleiben erhalten (Struktur soll überleben).
  const [resetting, setResetting] = useState(false);
  const [confirmStage, setConfirmStage] = useState<0 | 1>(0);
  const [resetProgress, setResetProgress] = useState<string | null>(null);
  async function handleResetCollection() {
    if (confirmStage === 0) { setConfirmStage(1); return; }
    setResetting(true);
    setResetProgress(null);
    try {
      const cards = await getCards();
      setResetProgress(`Lösche ${cards.length} Karten…`);
      let done = 0;
      for (const c of cards) {
        await deleteCard(c.id);
        done++;
        if (done % 5 === 0) setResetProgress(`${done}/${cards.length} gelöscht…`);
      }
      // Binder-cardIds leeren (Binder bleiben bestehen)
      const binders = await getBinders();
      setResetProgress(`Räume ${binders.length} Sammlungen auf…`);
      for (const b of binders) {
        if ((b.cardIds?.length ?? 0) > 0) {
          await updateBinder(b.id, { cardIds: [] });
        }
      }
      setResetProgress(`Fertig — ${done} Karten gelöscht.`);
    } catch (e) {
      setResetProgress(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResetting(false);
      setConfirmStage(0);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  async function handleAppUpdate() {
    // iOS-PWA cached den App-Shell aggressiv — normales reload() reicht nicht.
    // Service-Worker-Caches leeren, dann Hard-Navigation mit Query-Parameter.
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch { /* ignorieren */ }
    window.location.href = '/?updated=' + Date.now();
  }

  const pct        = syncStatus ? Math.round(((syncStatus.syncedTotal ?? 0) / (syncStatus.currentTotal || 1)) * 100) : 0;
  const isComplete = pct >= 100;
  const hasNew     = (syncStatus?.newCards ?? 0) > 0;
  const busy       = runningAll || syncing;

  return (
    <div className="min-h-screen pb-16">
      <div className="sticky top-safe z-20 bg-background shadow-header px-4 pt-4 pb-3 flex items-center gap-3">
        <Link href="/" className="text-muted-foreground">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="font-semibold text-base">Einstellungen</h1>
      </div>

      <div className="px-4 py-5 space-y-6">

        {/* 1. App */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">App</p>
          <div className="bg-card shadow-card rounded-2xl overflow-hidden">
            <button
              onClick={handleAppUpdate}
              className="w-full flex items-center gap-3 px-4 py-4 text-left active:bg-secondary transition-colors"
            >
              <RefreshCw size={18} className="text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">App aktualisieren</p>
                <p className="text-xs text-muted-foreground">Lädt die neueste Version — Cache wird geleert</p>
              </div>
            </button>
          </div>
        </section>

        {/* 2. Karten-Catalog */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Karten-Catalog</p>
          <div className="bg-card shadow-card rounded-2xl overflow-hidden">

            {syncLoading ? (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Status */}
                <div className="px-4 py-3 flex items-center justify-between">
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
                <div className="px-4 pb-3 space-y-2">
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
                    className="px-4 py-2.5 text-xs font-medium"
                    style={{
                      color: allProgress.startsWith('✅') ? '#48bb78' : allProgress.startsWith('Fehler') ? 'var(--pokedex-red)' : 'var(--foreground)',
                      background: 'color-mix(in srgb, var(--foreground) 4%, transparent)',
                    }}
                  >
                    {allProgress}
                  </div>
                )}

                {/* Ergebnis letzter Sync */}
                {syncResult && !runningAll && (
                  <div className="px-4 py-2.5 text-xs text-muted-foreground">
                    {syncResult}
                  </div>
                )}

                {/* Daten aktualisieren */}
                <button
                  onClick={() => runAllSteps(false)}
                  disabled={busy}
                  className="w-full flex items-center gap-3 px-4 py-4 text-left transition-colors active:bg-secondary disabled:opacity-40"
                  style={{ background: runningAll ? 'color-mix(in srgb, var(--pokedex-red) 6%, transparent)' : undefined }}
                >
                  <RefreshCw
                    size={18}
                    className={`shrink-0 ${runningAll ? 'animate-spin' : ''}`}
                    style={{ color: 'var(--pokedex-red)' }}
                  />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--pokedex-red)' }}>
                      {runningAll ? 'Läuft…' : 'Daten aktualisieren'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Neue Karten holen und alle Felder anreichern
                    </p>
                  </div>
                </button>

                {/* Daten neu aufbauen */}
                <button
                  onClick={() => runAllSteps(true)}
                  disabled={busy}
                  className="w-full flex items-center gap-3 px-4 py-4 text-left transition-colors active:bg-secondary disabled:opacity-40"
                >
                  <RotateCcw size={18} className="text-orange-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-orange-500">Daten neu aufbauen</p>
                    <p className="text-xs text-muted-foreground">Reset + alle Schritte komplett neu — z. B. nach Schema-Änderung</p>
                  </div>
                </button>
              </>
            )}
          </div>
        </section>

        {/* 3. Erscheinungsbild */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Erscheinungsbild</p>
          <div className="bg-card shadow-card rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Farbschema</p>
            {mounted && (
              <div
                className="flex rounded-full p-0.5"
                style={{ background: 'var(--secondary)' }}
              >
                {THEMES.map(({ value, label, icon: Icon }) => {
                  const active = theme === value;
                  return (
                    <button
                      key={value}
                      onClick={() => setTheme(value)}
                      aria-label={label}
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                      style={{
                        background: active ? 'var(--background)' : 'transparent',
                        color: active ? 'var(--pokedex-red)' : 'var(--muted-foreground)',
                        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : undefined,
                      }}
                    >
                      <Icon size={18} strokeWidth={active ? 2.5 : 1.8} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* 4. Gefahren-Zone */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Gefahren-Zone</p>
          <div className="bg-card shadow-card rounded-2xl overflow-hidden">
            <button
              onClick={handleResetCollection}
              disabled={resetting}
              className="w-full flex items-center gap-3 px-4 py-4 text-left active:bg-secondary transition-colors disabled:opacity-50"
            >
              <Trash2 size={18} className="text-red-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-500">
                  {confirmStage === 0
                    ? 'Sammlung zurücksetzen'
                    : resetting
                      ? 'Wird gelöscht…'
                      : 'Wirklich? Tippe nochmal zum Bestätigen'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Löscht alle Karten aus deiner Sammlung. Sammlungs-/Binder-Struktur bleibt erhalten.
                </p>
                {resetProgress && (
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{resetProgress}</p>
                )}
              </div>
            </button>
            {confirmStage === 1 && !resetting && (
              <button
                onClick={() => setConfirmStage(0)}
                className="w-full px-4 py-3 text-sm text-muted-foreground border-t border-border active:bg-secondary"
              >
                Abbrechen
              </button>
            )}
          </div>
        </section>

        {/* 5. Account */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Account</p>
          <div className="bg-card shadow-card rounded-2xl overflow-hidden">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-4 text-left active:bg-secondary transition-colors"
            >
              <div className="text-sm font-medium text-red-500">Abmelden</div>
            </button>
          </div>
        </section>

      </div>
    </div>
  );
}
