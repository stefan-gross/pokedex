'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, Sun, Moon, Smartphone, RefreshCw,
  Database, CheckCircle, Clock, AlertCircle, RotateCcw, Trash2, LogOut, Coins,
} from 'lucide-react';
import type { SyncMeta } from '@/lib/firestore/catalog';
import { getCards, deleteCard } from '@/lib/firestore/cards';
import { getBinders, updateBinder } from '@/lib/firestore/binders';
import { getOwnedPriceStatus, type OwnedPriceStatus } from '@/lib/prices/owned-status';
import { ButtonGroup } from '@/components/ui/button-group';
import { Button } from '@/components/ui/button';

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

  // Passiver Preis-Status der Sammlung (Abdeckung + letzte Aktualisierung),
  // rein aus gecachten Katalog-Preisen berechnet (kein Live-Refresh).
  const [priceStatus, setPriceStatus] = useState<OwnedPriceStatus | null>(null);
  // Zusammenfassung + Zeitpunkt des letzten „Daten aktualisieren"-Laufs,
  // in `localStorage` gehalten (der Lauf wird komplett clientseitig orchestriert).
  const [lastDataRun, setLastDataRun] = useState<{ at: string; summary: string } | null>(null);

  const LAST_RUN_KEY = 'pokedex-last-data-run';

  useEffect(() => {
    setMounted(true);
    loadSyncStatus();
    getOwnedPriceStatus().then(setPriceStatus).catch(() => {});
    try {
      const raw = localStorage.getItem(LAST_RUN_KEY);
      if (raw) setLastDataRun(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

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
      // `auto` (seitenweiser Cursor) nur solange der einmalige Bootstrap
      // noch nicht durchgelaufen ist — danach `update` (holt anhand der
      // aktuellen Gesamtzahl gezielt genau die fehlenden neuen Karten, statt
      // sich auf einen möglicherweise inzwischen verschobenen Seiten-Cursor
      // zu verlassen). Ohne diese Unterscheidung erkannte der Katalog-Sync
      // nach dem ersten Vollsync nie mehr neu erschienene Sets.
      let bootstrapDoneStatus: { bootstrapped?: boolean } = {};
      try {
        const statusRes = await fetch('/api/admin/trigger-sync');
        if (statusRes.ok) bootstrapDoneStatus = await statusRes.json();
      } catch { /* ignore — fällt unten auf `auto` zurück, sicherer Default */ }
      const catalogMode = bootstrapDoneStatus.bootstrapped ? 'update' : 'auto';
      let retries = 0;
      while (true) {
        let res: Response, text: string;
        try {
          res  = await fetch(`/api/admin/trigger-sync?mode=${catalogMode}`, { method: 'POST' });
          text = await res.text();
        } catch {
          if (++retries > 5) break;
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        retries = 0;
        let d: { done?: boolean; status?: string } = {};
        try { d = JSON.parse(text); } catch { /* ignore */ }
        if (d.done || d.status === 'complete' || d.status === 'up-to-date' || d.status === 'updated') break;
        if (d.status === 'error') break;
        if (catalogMode === 'update') break; // `update` erledigt alles in einem Aufruf
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

      const summary = `${deTotal} DE-Namen · ${evoTotal} Evo-Daten · ${bfData.updated ?? 0} Set-Kürzel · ${atData.updated ?? 0} Illustrator-Tokens · ${imgTotal} DE-Bilder · ${speciesTotal} Artdaten · ${variantsTotal} Varianten · ${artistTotal} Illustrator-Credits`;
      step(`✅ Fertig — ${summary}`);
      // Zusammenfassung dauerhaft merken (überlebt Reload), damit „Letzter
      // Daten-Lauf" auch später noch sichtbar ist.
      const run = { at: new Date().toISOString(), summary };
      setLastDataRun(run);
      try { localStorage.setItem(LAST_RUN_KEY, JSON.stringify(run)); } catch { /* ignore */ }
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
      const j = await res.json() as { refreshed: number; upgraded: number; errored: number; total: number; capped?: boolean };
      let msg = `${j.refreshed}/${j.total} aktualisiert.`;
      if (j.upgraded > 0) msg = `${j.refreshed}/${j.total} aktualisiert, ${j.upgraded} auf Cardmarket umgestiegen.`;
      if (j.errored > 0) msg += ` ${j.errored} vorübergehend nicht erreichbar.`;
      if (j.capped) msg += ' Rest beim nächsten Mal.';
      setRefreshPricesResult(msg);
      // Preis-Abdeckung/-Datum neu berechnen (Cache wurde gerade aktualisiert).
      getOwnedPriceStatus().then(setPriceStatus).catch(() => {});
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
        <Button variant="ghost" href="/" icon={<ChevronLeft size={22} />} aria-label="Zurück" />
        <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.2)] flex-1">Einstellungen</h1>
        {/* Farbschema — kompakt oben rechts */}
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

      <div className="px-4 py-5 space-y-6">

        {/* 1. App */}
        <section className="space-y-1.5">
          <p className="text-xs font-semibold text-glass-muted uppercase tracking-wide mb-2">App</p>
          <Button variant="secondary" size="lg" className="w-full justify-start" icon={<RefreshCw size={18} />} onClick={handleAppUpdate}>
            App aktualisieren
          </Button>
          <p className="text-role-label text-glass-muted px-1">Lädt die neueste Version — Cache wird geleert</p>
        </section>

        {/* 2. Karten-Catalog — ein Panel: Status + Preis-Status + letzter Lauf + Aktionen */}
        <section>
          <p className="text-xs font-semibold text-glass-muted uppercase tracking-wide mb-3">Karten-Catalog</p>
          <div className="glass rounded-[20px] overflow-hidden">

            {/* Katalog-Sync-Status (dauerhaft, nicht nur während des Syncs) */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Database size={16} className="text-glass-muted shrink-0" />
                  <p className="text-role-title text-glass">Katalog</p>
                </div>
                {syncLoading
                  ? <span className="w-4 h-4 border-2 border-[rgba(30,40,80,0.3)] dark:border-white/70 border-t-transparent rounded-full animate-spin" />
                  : isComplete
                    ? <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-300"><CheckCircle size={12} /> Aktuell</span>
                    : hasNew
                      ? <span className="flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-300"><Clock size={12} /> Update verfügbar</span>
                      : (syncStatus?.syncedTotal ?? 0) === 0
                        ? <span className="text-role-label text-glass-muted">Noch nicht gestartet</span>
                        : <span className="flex items-center gap-1 text-xs text-orange-700 dark:text-orange-200"><Clock size={12} /> Unvollständig</span>
                }
              </div>

              {!syncLoading && (
                <div className="space-y-2">
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
              )}
            </div>

            {/* Preis-Status der eigenen Sammlung */}
            <div className="px-4 py-3 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14]">
              <div className="flex items-center gap-2 mb-1">
                <Coins size={16} className="text-glass-muted shrink-0" />
                <p className="text-role-title text-glass">Preise</p>
              </div>
              {priceStatus ? (
                <>
                  <p className="text-role-label text-glass-muted">
                    Preise für {priceStatus.withPrice.toLocaleString('de-DE')} von {priceStatus.total.toLocaleString('de-DE')} Karten deiner Sammlung
                  </p>
                  {priceStatus.lastRefresh && (
                    <p className="text-role-label text-glass-muted">
                      Zuletzt aktualisiert: {priceStatus.lastRefresh.toLocaleString('de-DE')}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-role-label text-glass-muted">Wird berechnet…</p>
              )}
            </div>

            {/* Letzter Daten-Lauf (überlebt Reload via localStorage) */}
            {lastDataRun && (
              <div className="px-4 py-3 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14]">
                <p className="text-role-title text-glass mb-1">Letzter Daten-Lauf</p>
                <p className="text-role-label text-glass-muted">{new Date(lastDataRun.at).toLocaleString('de-DE')}</p>
                <p className="text-role-label text-glass-muted font-mono mt-1">{lastDataRun.summary}</p>
              </div>
            )}

            {/* Laufender Fortschritt / letztes Ergebnis */}
            {allProgress && (
              <div className="px-4 py-2.5 text-xs font-medium text-glass bg-[rgba(30,40,80,0.06)] dark:bg-white/10 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14]">
                {allProgress}
              </div>
            )}
            {syncResult && !runningAll && (
              <div className="px-4 py-2.5 text-role-label text-glass-muted border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14]">
                {syncResult}
              </div>
            )}

            {/* Aktionen */}
            <div className="p-3 space-y-2 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14]">
              <Button
                variant="secondary" size="lg" className="w-full justify-start"
                icon={<RefreshCw size={18} className={runningAll ? 'animate-spin' : ''} />}
                onClick={() => runAllSteps(false)} disabled={busy}
              >
                {runningAll ? 'Läuft…' : 'Daten aktualisieren'}
              </Button>
              <p className="text-role-label text-glass-muted px-1">Neue Karten holen und alle Felder anreichern</p>

              <Button
                variant="secondary" size="lg" className="w-full justify-start"
                icon={<RotateCcw size={18} className="text-orange-600 dark:text-orange-300" />}
                onClick={() => runAllSteps(true)} disabled={busy}
              >
                Daten neu aufbauen
              </Button>
              <p className="text-role-label text-glass-muted px-1">Reset + alle Schritte komplett neu — z. B. nach Schema-Änderung</p>

              <Button
                variant="secondary" size="lg" className="w-full justify-start"
                icon={<RefreshCw size={18} className={refreshingPrices ? 'animate-spin text-blue-600 dark:text-blue-300' : 'text-blue-600 dark:text-blue-300'} />}
                onClick={handleRefreshPrices} disabled={refreshingPrices}
              >
                {refreshingPrices ? 'Preise werden aktualisiert…' : 'Preise jetzt aktualisieren'}
              </Button>
              <p className="text-role-label text-glass-muted px-1">Holt aktuelle Cardmarket/TCGplayer-Preise für deine Sammlung</p>
              {refreshPricesResult && (
                <p className="text-role-label text-glass-muted px-1 font-mono">{refreshPricesResult}</p>
              )}
            </div>
          </div>
        </section>

        {/* 3. Gefahren-Zone */}
        <section className="space-y-1.5">
          <p className="text-xs font-semibold text-glass-muted uppercase tracking-wide mb-2">Gefahren-Zone</p>
          <Button
            variant="secondary" size="lg" className="w-full justify-start"
            icon={<Trash2 size={18} className="text-red-600 dark:text-red-300" />}
            onClick={handleResetCollection} disabled={resetting}
          >
            {confirmStage === 0
              ? 'Sammlung zurücksetzen'
              : resetting
                ? 'Wird gelöscht…'
                : 'Wirklich? Tippe nochmal zum Bestätigen'}
          </Button>
          <p className="text-role-label text-glass-muted px-1">Löscht alle Karten aus deiner Sammlung. Sammlungs-/Binder-Struktur bleibt erhalten.</p>
          {resetProgress && (
            <p className="text-role-label text-glass-muted px-1 font-mono">{resetProgress}</p>
          )}
          {confirmStage === 1 && !resetting && (
            <Button variant="ghost" size="sm" className="px-0" onClick={() => setConfirmStage(0)}>Abbrechen</Button>
          )}
        </section>

        {/* 4. Account */}
        <section className="space-y-1.5">
          <p className="text-xs font-semibold text-glass-muted uppercase tracking-wide mb-2">Account</p>
          <Button
            variant="secondary" size="lg" className="w-full justify-start"
            icon={<LogOut size={18} className="text-red-600 dark:text-red-300" />}
            onClick={handleLogout}
          >
            Abmelden
          </Button>
        </section>

      </div>
    </div>
  );
}
