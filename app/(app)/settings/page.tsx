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
import { ButtonGroup } from '@/components/ui/button-group';

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
      step('📥 (1/9) Catalog wird synchronisiert…');
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
      step('🧬 (2/9) Evolutionsdaten werden angereichert…');
      let evoTotal = 0;
      while (true) {
        const res  = await fetch('/api/admin/enrich-evolution', { method: 'POST' });
        const data = await res.json();
        evoTotal += data.enriched ?? 0;
        step(`🧬 (2/9) Evolutionsdaten: ${evoTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 3. Deutsche Namen
      step('🇩🇪 (3/9) Deutsche Namen werden angereichert…');
      let deTotal = 0;
      while (true) {
        const res  = await fetch('/api/admin/enrich-german-names', { method: 'POST' });
        const data = await res.json();
        deTotal += data.enriched ?? 0;
        step(`🇩🇪 (3/9) Deutsche Namen: ${deTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 4. Sets
      step('🗂️ (4/9) Sets werden synchronisiert…');
      await fetch('/api/admin/sync-sets', { method: 'POST' });

      // 5. Set-Kürzel + Illustrator-Suchwörter (beides reine Firestore-Backfills, kein API-Call)
      step('🏷️ (5/9) Set-Kürzel werden geschrieben…');
      const bfRes  = await fetch('/api/admin/backfill-set-codes', { method: 'POST' });
      const bfData = await bfRes.json();
      const atRes  = await fetch('/api/admin/backfill-artist-tokens', { method: 'POST' });
      const atData = await atRes.json();

      // 6. Deutsche Karten-Bilder
      step('🖼️ (6/9) Deutsche Karten-Bilder werden angereichert…');
      let imgTotal = 0;
      let imgFirst = true;
      while (true) {
        const res  = await fetch('/api/admin/enrich-de-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: imgFirst }) });
        imgFirst = false;
        const data = await res.json();
        imgTotal += data.enriched ?? 0;
        step(`🖼️ (6/9) DE-Bilder: ${imgTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 7. Pokémon-Artdaten
      step('🧬 (7/9) Pokémon-Artdaten werden angereichert…');
      let speciesTotal = 0;
      while (true) {
        const res  = await fetch('/api/admin/enrich-species', { method: 'POST' });
        const data = await res.json();
        speciesTotal += data.enriched ?? 0;
        step(`🧬 (7/9) Artdaten: ${speciesTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 8. Varianten aus TCGdex (überschreibt Heuristik-Defaults für Common/Uncommon/Rare etc.)
      step('🃏 (8/9) Varianten werden angereichert…');
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
        step(`🃏 (8/9) Varianten: ${variantsTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 9. Illustrator-Fallback über TCGdex (pokemontcg.io liefert bei manchen
      // Karten artist: null, obwohl der Name auf dem Kartenbild steht)
      step('🎨 (9/9) Illustrator-Credits werden ergänzt…');
      let artistTotal = 0;
      while (true) {
        const res  = await fetch('/api/admin/enrich-artist', { method: 'POST' });
        const data = await res.json();
        artistTotal += data.enriched ?? 0;
        step(`🎨 (9/9) Illustrator-Credits: ${artistTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      step(`✅ Fertig — ${deTotal} DE-Namen · ${evoTotal} Evo-Daten · ${bfData.updated ?? 0} Set-Kürzel · ${atData.updated ?? 0} Illustrator-Tokens · ${imgTotal} DE-Bilder · ${speciesTotal} Artdaten · ${variantsTotal} Varianten · ${artistTotal} Illustrator-Credits`);
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

  // ── Preise jetzt aktualisieren ─────────────────────────────────────────
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [refreshPricesResult, setRefreshPricesResult] = useState<string | null>(null);
  async function handleRefreshPrices() {
    if (refreshingPrices) return;
    setRefreshingPrices(true);
    setRefreshPricesResult(null);
    try {
      const res = await fetch('/api/settings/refresh-prices', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json() as { refreshed: number; upgraded: number; errored: number; total: number };
      const msg = j.upgraded > 0
        ? `${j.refreshed}/${j.total} aktualisiert, ${j.upgraded} auf Cardmarket umgestiegen.`
        : `${j.refreshed}/${j.total} aktualisiert.`;
      setRefreshPricesResult(j.errored > 0 ? `${msg} ${j.errored} Fehler.` : msg);
    } catch (e) {
      setRefreshPricesResult(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRefreshingPrices(false);
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
    <div className="relative min-h-screen pb-16">
      <div className="sticky top-safe z-20 px-4 pt-4 pb-3 flex items-center gap-3">
        <Link href="/" className="text-glass">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.2)]">Einstellungen</h1>
      </div>

      <div className="px-4 py-5 space-y-6">

        {/* 1. App */}
        <section>
          <p className="text-xs font-semibold text-glass-muted uppercase tracking-wide mb-3">App</p>
          <div className="glass rounded-[20px] overflow-hidden">
            <button
              onClick={handleAppUpdate}
              className="w-full flex items-center gap-3 px-4 py-4 text-left transition-colors"
            >
              <RefreshCw size={18} className="text-glass-muted shrink-0" />
              <div>
                <p className="text-role-title text-glass">App aktualisieren</p>
                <p className="text-role-label text-glass-muted">Lädt die neueste Version — Cache wird geleert</p>
              </div>
            </button>
          </div>
        </section>

        {/* 2. Karten-Catalog */}
        <section>
          <p className="text-xs font-semibold text-glass-muted uppercase tracking-wide mb-3">Karten-Catalog</p>
          <div className="glass rounded-[20px] overflow-hidden">

            {syncLoading ? (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 border-2 border-[rgba(30,40,80,0.3)] dark:border-white/70 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Status */}
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database size={16} className="text-glass-muted shrink-0" />
                    <p className="text-role-title text-glass">Sync-Status</p>
                  </div>
                  {isComplete
                    ? <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-300"><CheckCircle size={12} /> Aktuell</span>
                    : hasNew
                      ? <span className="flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-300"><Clock size={12} /> Update verfügbar</span>
                      : (syncStatus?.syncedTotal ?? 0) === 0
                        ? <span className="text-role-label text-glass-muted">Noch nicht gestartet</span>
                        : <span className="flex items-center gap-1 text-xs text-orange-700 dark:text-orange-200"><Clock size={12} /> Unvollständig</span>
                  }
                </div>

                {/* Fortschrittsbalken */}
                <div className="px-4 pb-3 space-y-2">
                  <div className="h-1.5 rounded-full bg-[rgba(30,40,80,0.10)] dark:bg-white/25 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isComplete ? '' : 'bg-[#e53e3e] dark:bg-white'}`}
                      style={{ width: `${pct}%`, ...(isComplete ? { background: '#48bb78' } : {}) }}
                    />
                  </div>
                  <div className="flex justify-between text-role-label text-glass-muted">
                    <span>{(syncStatus?.syncedTotal ?? 0).toLocaleString('de-DE')} gecacht</span>
                    <span>{pct}% · {(syncStatus?.currentTotal ?? 0).toLocaleString('de-DE')} gesamt</span>
                  </div>
                  {syncStatus?.lastSynced && (
                    <p className="text-role-label text-glass-muted">
                      Letzter Sync: {new Date(syncStatus.lastSynced).toLocaleString('de-DE')}
                    </p>
                  )}
                  {hasNew && (
                    <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg text-yellow-800 dark:text-yellow-100 bg-[rgba(30,40,80,0.06)] dark:bg-white/12">
                      <AlertCircle size={12} />
                      {syncStatus!.newCards.toLocaleString('de-DE')} neue Karten verfügbar
                    </div>
                  )}
                </div>

                {/* Fortschritt kombinierter Lauf */}
                {allProgress && (
                  <div
                    className="px-4 py-2.5 text-xs font-medium text-glass bg-[rgba(30,40,80,0.06)] dark:bg-white/10"
                  >
                    {allProgress}
                  </div>
                )}

                {/* Ergebnis letzter Sync */}
                {syncResult && !runningAll && (
                  <div className="px-4 py-2.5 text-role-label text-glass-muted">
                    {syncResult}
                  </div>
                )}

                {/* Daten aktualisieren */}
                <button
                  onClick={() => runAllSteps(false)}
                  disabled={busy}
                  className={`w-full flex items-center gap-3 px-4 py-4 text-left transition-colors disabled:opacity-40 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14] ${runningAll ? 'bg-[rgba(30,40,80,0.06)] dark:bg-white/10' : ''}`}
                >
                  <RefreshCw
                    size={18}
                    className={`shrink-0 text-glass ${runningAll ? 'animate-spin' : ''}`}
                  />
                  <div>
                    <p className="text-role-title text-glass">
                      {runningAll ? 'Läuft…' : 'Daten aktualisieren'}
                    </p>
                    <p className="text-role-label text-glass-muted">
                      Neue Karten holen und alle Felder anreichern
                    </p>
                  </div>
                </button>

                {/* Daten neu aufbauen */}
                <button
                  onClick={() => runAllSteps(true)}
                  disabled={busy}
                  className="w-full flex items-center gap-3 px-4 py-4 text-left transition-colors disabled:opacity-40 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14]"
                >
                  <RotateCcw size={18} className="text-orange-700 dark:text-orange-200 shrink-0" />
                  <div>
                    <p className="text-role-title text-orange-700 dark:text-orange-200">Daten neu aufbauen</p>
                    <p className="text-role-label text-glass-muted">Reset + alle Schritte komplett neu — z. B. nach Schema-Änderung</p>
                  </div>
                </button>

                {/* Preise jetzt aktualisieren */}
                <button
                  onClick={handleRefreshPrices}
                  disabled={refreshingPrices}
                  className="w-full flex items-center gap-3 px-4 py-4 text-left transition-colors disabled:opacity-40 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14]"
                >
                  <RefreshCw size={18} className={`shrink-0 text-blue-700 dark:text-blue-200 ${refreshingPrices ? 'animate-spin' : ''}`} />
                  <div className="flex-1">
                    <p className="text-role-title text-blue-700 dark:text-blue-200">
                      {refreshingPrices ? 'Preise werden aktualisiert…' : 'Preise jetzt aktualisieren'}
                    </p>
                    <p className="text-role-label text-glass-muted">
                      Holt aktuelle Cardmarket/TCGplayer-Preise für deine Sammlung
                    </p>
                    {refreshPricesResult && (
                      <p className="text-role-label text-glass-muted mt-1 font-mono">{refreshPricesResult}</p>
                    )}
                  </div>
                </button>
              </>
            )}
          </div>
        </section>

        {/* 3. Erscheinungsbild */}
        <section>
          <p className="text-xs font-semibold text-glass-muted uppercase tracking-wide mb-3">Erscheinungsbild</p>
          <div className="glass rounded-[20px] px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-role-title text-glass">Farbschema</p>
            {mounted && (
              <ButtonGroup
                iconOnly
                value={(theme ?? 'system') as 'system' | 'light' | 'dark'}
                onChange={setTheme}
                options={THEMES.map(({ value, label, icon: Icon }) => ({
                  value,
                  ariaLabel: label,
                  label: <Icon size={18} strokeWidth={theme === value ? 2.5 : 1.8} style={{ color: theme === value ? 'var(--pokedex-red)' : undefined }} />,
                }))}
              />
            )}
          </div>
        </section>

        {/* 4. Gefahren-Zone */}
        <section>
          <p className="text-xs font-semibold text-glass-muted uppercase tracking-wide mb-3">Gefahren-Zone</p>
          <div className="glass rounded-[20px] overflow-hidden">
            <button
              onClick={handleResetCollection}
              disabled={resetting}
              className="w-full flex items-center gap-3 px-4 py-4 text-left transition-colors disabled:opacity-50"
            >
              <Trash2 size={18} className="text-red-600 dark:text-red-300 shrink-0" />
              <div className="flex-1">
                <p className="text-role-title text-red-600 dark:text-red-300">
                  {confirmStage === 0
                    ? 'Sammlung zurücksetzen'
                    : resetting
                      ? 'Wird gelöscht…'
                      : 'Wirklich? Tippe nochmal zum Bestätigen'}
                </p>
                <p className="text-role-label text-glass-muted">
                  Löscht alle Karten aus deiner Sammlung. Sammlungs-/Binder-Struktur bleibt erhalten.
                </p>
                {resetProgress && (
                  <p className="text-role-label text-glass-muted mt-1 font-mono">{resetProgress}</p>
                )}
              </div>
            </button>
            {confirmStage === 1 && !resetting && (
              <button
                onClick={() => setConfirmStage(0)}
                className="w-full px-4 py-3 text-sm text-glass-muted border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14]"
              >
                Abbrechen
              </button>
            )}
          </div>
        </section>

        {/* 5. Account */}
        <section>
          <p className="text-xs font-semibold text-glass-muted uppercase tracking-wide mb-3">Account</p>
          <div className="glass rounded-[20px] overflow-hidden">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-4 text-left transition-colors"
            >
              <div className="text-role-title text-red-600 dark:text-red-300">Abmelden</div>
            </button>
          </div>
        </section>

      </div>
    </div>
  );
}
