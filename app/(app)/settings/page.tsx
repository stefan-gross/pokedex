'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, Sun, Moon, Smartphone, RefreshCw,
  Database, CheckCircle, Clock, AlertCircle, Trash2, LogOut,
} from 'lucide-react';
import type { SyncMeta } from '@/lib/firestore/catalog';
import { getCards, deleteCard } from '@/lib/firestore/cards';
import { reconcilePendingCards } from '@/lib/scan/reconcile-pending';
import { getBinders, deleteBinder } from '@/lib/firestore/binders';
import { getWishlists, deleteWishlist } from '@/lib/firestore/wishlists';
import { ButtonGroup } from '@/components/ui/button-group';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useScannerDebug, setScannerDebug } from '@/lib/scanner/debug-flags';
import { useUpdateAvailable } from '@/lib/hooks/use-update-available';
import { auth } from '@/lib/firebase/client';
import { onAuthStateChanged } from 'firebase/auth';

const THEMES = [
  { value: 'system', label: 'System', icon: Smartphone },
  { value: 'light',  label: 'Hell',   icon: Sun },
  { value: 'dark',   label: 'Dunkel', icon: Moon },
] as const;

interface SyncStatus extends SyncMeta {
  newCards: number;
  totalCards?: number;
  totalSets?: number;
  withImage?: number;
  withAnyImage?: number;
  withDeImage?: number;
  withDeName?: number;
  withPrice?: number;
}

/** Ampel-Farbe für einen Abdeckungs-Balken: <60 % rot, <90 % gelb, ≥90 % grün. */
function barColor(pct: number): string {
  if (pct >= 90) return '#48bb78';                 // grün
  if (pct >= 60) return 'var(--pokedex-yellow, #d69e2e)'; // gelb
  return '#e53e3e';                                 // rot
}

/** Beschrifteter Fortschrittsbalken (Label · Anzahl · %) mit Ampel-Farbe. */
function StatBar({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-role-label">
        <span className="text-glass-muted">{label}</span>
        <span className="text-glass tabular-nums">{value.toLocaleString('de-DE')} · {pct} %</span>
      </div>
      <div className="h-1.5 rounded-full bg-[rgba(30,40,80,0.10)] dark:bg-white/25 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor(pct) }} />
      </div>
    </div>
  );
}

/** Geschichteter Balken: Basis = Karten mit IRGENDEINEM Bild (Ampel-Farbe),
 *  Overlay (höherer z-Index) = Karten mit deutschem Bild (blauer Akzent).
 *  Label: Anzahl · % (gesamt), in Klammern die Anzahl deutscher Bilder. */
function StatBarImages({ any, de, total }: { any: number; de: number; total: number }) {
  const anyPct = total > 0 ? Math.round((any / total) * 100) : 0;
  const dePct  = total > 0 ? Math.round((de  / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-role-label">
        <span className="text-glass-muted">Bilder</span>
        <span className="text-glass tabular-nums">
          {any.toLocaleString('de-DE')} · {anyPct} %
          <span className="text-glass-muted"> (DE: {de.toLocaleString('de-DE')})</span>
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-[rgba(30,40,80,0.10)] dark:bg-white/25 overflow-hidden">
        {/* Basis: irgendein Bild */}
        <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${anyPct}%`, background: barColor(anyPct) }} />
        {/* Overlay: deutsche Bilder (⊆ Basis) */}
        <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${dePct}%`, background: '#2b6cb0' }} />
      </div>
      <div className="flex gap-3 text-[10px] text-glass-muted">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: barColor(anyPct) }} /> irgendein Bild</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: '#2b6cb0' }} /> deutsches Bild</span>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  // Scanner-Debug-Modi (mehrstufig): Scannen / KI / Daten
  const scannerDebug = useScannerDebug();

  // „Neue Version verfügbar" (geteilter Hook, auch im Dashboard).
  const { updateAvailable, confirmedCurrent, buildSha, buildTime } = useUpdateAvailable();

  // Aktuell angemeldetes Konto (Karten hängen am Konto, nicht am Gerät).
  const [userEmail, setUserEmail] = useState<string | null>(null);
  useEffect(() => onAuthStateChanged(auth, u => setUserEmail(u?.email ?? null)), []);

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncLoading, setSyncLoading] = useState(true);
  const [syncing, setSyncing]         = useState(false);
  const [syncResult, setSyncResult]   = useState<string | null>(null);
  const [runningAll,  setRunningAll]  = useState(false);
  const [allProgress, setAllProgress] = useState<string | null>(null);

  // Zusammenfassung + Zeitpunkt des letzten „Daten aktualisieren"-Laufs,
  // in `localStorage` gehalten (der Lauf wird komplett clientseitig orchestriert).
  const [lastDataRun, setLastDataRun] = useState<{ at: string; summary: string } | null>(null);

  const LAST_RUN_KEY = 'pokedex-last-data-run';

  useEffect(() => {
    setMounted(true);
    loadSyncStatus();
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
        // newCards kommt phantom-bereinigt vom Server — NICHT hier neu rechnen.
        setSyncStatus({ ...data, newCards: data.newCards ?? 0 });
      }
    } catch { /* ignore */ } finally {
      setSyncLoading(false);
    }
  }

  async function runAllSteps() {
    setRunningAll(true);
    setSyncing(true);
    setSyncResult(null);
    const step = (msg: string) => setAllProgress(msg);
    step('▶ Starte…');

    // Über den GESAMTEN Lauf pollen → die Status-Balken (Bilder/DE/Preise/…)
    // füllen sich live mit, während die Schritte durchlaufen.
    const poller = setInterval(loadSyncStatus, 3000);
    try {
      // Reihenfolge: Sets ZUERST (Karten-Sync liest series/setCode aus tcg_sets),
      // dann neue Karten (Delta), dann DE-Backfill + PokéAPI-Anreicherungen, dann
      // Preise. DE-Namen/-Bilder/Varianten/Illustrator kommen bei NEUEN Karten
      // nativ aus dem Katalog-Sync; der DE-Schritt trägt sie für BESTEHENDE
      // Karten nach.

      // 1. Sets
      step('🗂️ (1/6) Sets werden synchronisiert…');
      const setsRes  = await fetch('/api/admin/sync-sets', { method: 'POST' });
      const setsData = await setsRes.json().catch(() => ({}));

      // 2. Neue/fehlende Karten gezielt nachziehen (Delta-Sync, günstig).
      step('📥 (2/6) Neue Karten werden geholt…');
      let addedTotal = 0, retries = 0;
      while (true) {
        let d: { done?: boolean; status?: string; added?: number } = {};
        try {
          const res = await fetch('/api/admin/sync-new', { method: 'POST' });
          d = await res.json();
        } catch {
          if (++retries > 5) break;
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        retries = 0;
        addedTotal += d.added ?? 0;
        step(`📥 (2/6) Neue Karten: ${addedTotal}…`);
        if (d.done || d.status === 'complete' || d.status === 'error') break;
        await new Promise(r => setTimeout(r, 300));
      }
      await loadSyncStatus();

      // 3. Deutsche Namen/Bilder für bestehende Karten nachtragen (set-weise).
      step('🇩🇪 (3/6) Deutsche Namen & Bilder werden ergänzt…');
      let deTotal = 0;
      while (true) {
        let data: { status?: string; enriched?: number } = {};
        try {
          const res = await fetch('/api/admin/enrich-de', { method: 'POST' });
          data = await res.json();
        } catch { break; }
        deTotal += data.enriched ?? 0;
        step(`🇩🇪 (3/6) Deutsche Daten: ${deTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 4. Evolutionsdaten (PokéAPI)
      step('🧬 (4/6) Evolutionsdaten werden angereichert…');
      let evoTotal = 0;
      while (true) {
        const res  = await fetch('/api/admin/enrich-evolution', { method: 'POST' });
        const data = await res.json();
        evoTotal += data.enriched ?? 0;
        step(`🧬 (4/6) Evolutionsdaten: ${evoTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 5. Pokémon-Artdaten (PokéAPI)
      step('📖 (5/6) Pokémon-Artdaten werden angereichert…');
      let speciesTotal = 0;
      while (true) {
        const res  = await fetch('/api/admin/enrich-species', { method: 'POST' });
        const data = await res.json();
        speciesTotal += data.enriched ?? 0;
        step(`📖 (5/6) Artdaten: ${speciesTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 6. Preise: Sammlung + rollierender Katalog-Preis-Sweep (zeitbudgetiert
      //    im Server). Ein Aufruf pro Lauf; die Erstbefüllung „mind. ein Preis
      //    pro Karte" läuft über mehrere Läufe / den nächtlichen Cron weiter.
      step('💶 (6/6) Preise werden aktualisiert…');
      let priceRefreshed = 0, sweptSets = 0;
      try {
        const res = await fetch('/api/admin/refresh-prices', { method: 'POST' });
        const j = await res.json() as { refreshed?: number; sweptSets?: number };
        priceRefreshed = j.refreshed ?? 0;
        sweptSets = j.sweptSets ?? 0;
        step(`💶 (6/6) Preise: ${priceRefreshed} aktualisiert (${sweptSets} Sets)…`);
      } catch { /* Preise best-effort */ }

      // Vorläufige (nicht katalogisierte) Karten gegen den frischen Katalog
      // prüfen und eindeutige Treffer verknüpfen.
      step('🔗 Vorläufige Karten werden geprüft…');
      const { linked } = await reconcilePendingCards().catch(() => ({ linked: 0, checked: 0 }));

      const summary = `${setsData.synced ?? 0} Sets · ${addedTotal} neue Karten · ${deTotal} DE-Daten · ${evoTotal} Evo · ${speciesTotal} Artdaten · ${priceRefreshed} Preise · ${linked} verknüpft`;
      step(`✅ Fertig — ${summary}`);
      // Zusammenfassung dauerhaft merken (überlebt Reload), damit „Letzter
      // Daten-Lauf" auch später noch sichtbar ist.
      const run = { at: new Date().toISOString(), summary };
      setLastDataRun(run);
      try { localStorage.setItem(LAST_RUN_KEY, JSON.stringify(run)); } catch { /* ignore */ }
    } catch (e) {
      step(`Fehler: ${e}`);
    } finally {
      clearInterval(poller);
      setRunningAll(false);
      setSyncing(false);
      await loadSyncStatus();
    }
  }

  // ── Meine Daten löschen ────────────────────────────────────────────────
  // Löscht ALLE eigenen Karten + ALLE Mappen/Sammlungen + ALLE Wunschlisten.
  // Der Karten-Katalog (tcg_catalog/tcg_sets) bleibt unberührt.
  const [resetting, setResetting] = useState(false);
  const [confirmStage, setConfirmStage] = useState<0 | 1>(0);
  const [resetProgress, setResetProgress] = useState<string | null>(null);
  async function handleWipeMyData() {
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
        if (done % 5 === 0) setResetProgress(`${done}/${cards.length} Karten gelöscht…`);
      }

      const binders = await getBinders();
      setResetProgress(`Lösche ${binders.length} Sammlungen…`);
      for (const b of binders) await deleteBinder(b.id);

      const wishlists = await getWishlists();
      setResetProgress(`Lösche ${wishlists.length} Wunschlisten…`);
      for (const w of wishlists) await deleteWishlist(w.id);

      setResetProgress(`Fertig — ${done} Karten, ${binders.length} Sammlungen, ${wishlists.length} Wunschlisten gelöscht.`);
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
  const hasNew     = (syncStatus?.newCards ?? 0) > 0;
  // „Aktuell" = keine neuen Karten mehr offen (phantom-bereinigt), nicht pct===100.
  const isComplete = !hasNew && (syncStatus?.syncedTotal ?? 0) > 0;
  const busy       = runningAll || syncing;

  // Abdeckungs-Kennzahlen (Basis = Gesamtzahl Katalogkarten).
  const catTotal = syncStatus?.totalCards ?? syncStatus?.syncedTotal ?? 0;

  return (
    <div className="relative min-h-screen pb-16">
      {/* Header (nicht sticky, kein Panel) — Zurück „Dashboard" · Titel · Theme */}
      <div className="px-4 pt-4 pb-1 space-y-1">
        <Button variant="ghost" href="/" icon={<ChevronLeft size={18} />} className="px-0 -ml-1">
          Dashboard
        </Button>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.18)]">Einstellungen</h1>
          {/* Farbschema */}
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
      </div>

      <div className="px-4 py-5 space-y-6">

        {/* 1. App */}
        <section className="space-y-1.5">
          <p className="text-xs font-semibold text-glass-muted uppercase tracking-wide mb-2">App</p>
          <Button
            variant="secondary" size="lg" className="w-full" icon={<RefreshCw size={18} />}
            onClick={handleAppUpdate} disabled={confirmedCurrent}
          >
            <span className="flex-1 text-left">App aktualisieren</span>
            {updateAvailable ? (
              <span className="flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-300 shrink-0">
                <Clock size={12} /> Update verfügbar
              </span>
            ) : (
              <span className="text-[11px] text-glass-muted font-mono shrink-0">
                {buildSha}{buildTime ? ` · ${new Date(buildTime).toLocaleDateString('de-DE', { dateStyle: 'short' })}` : ''}
              </span>
            )}
          </Button>
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
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: barColor(pct) }}
                    />
                  </div>
                  <div className="flex justify-between text-role-label text-glass-muted">
                    <span>{(syncStatus?.syncedTotal ?? 0).toLocaleString('de-DE')} gecacht</span>
                    <span>{pct}% · {(syncStatus?.currentTotal ?? 0).toLocaleString('de-DE')} gesamt</span>
                  </div>
                  {/* Sets: reine Anzahl (keine Quote) */}
                  <div className="flex justify-between text-role-label pt-1">
                    <span className="text-glass-muted">Sets</span>
                    <span className="text-glass tabular-nums">{(syncStatus?.totalSets ?? 0).toLocaleString('de-DE')}</span>
                  </div>

                  {/* Abdeckungs-Balken (Ampel-Farbe: rot → gelb → grün ab 90 %) */}
                  <StatBarImages any={syncStatus?.withAnyImage ?? syncStatus?.withImage ?? 0} de={syncStatus?.withDeImage ?? 0} total={catTotal} />
                  <StatBar label="Deutsche Namen"  value={syncStatus?.withDeName  ?? 0} total={catTotal} />
                  <StatBar label="Preise"          value={syncStatus?.withPrice   ?? 0} total={catTotal} />

                  {syncStatus?.lastSynced && (
                    <p className="text-role-label text-glass-muted pt-1">
                      Letzte Aktualisierung: {new Date(syncStatus.lastSynced).toLocaleString('de-DE')}
                    </p>
                  )}
                  {syncStatus?.lastChecked && (
                    <p className="text-role-label text-glass-muted">
                      Letzte Prüfung: {new Date(syncStatus.lastChecked).toLocaleString('de-DE')}
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
                onClick={() => runAllSteps()} disabled={busy}
              >
                {runningAll ? 'Läuft…' : 'Daten aktualisieren'}
              </Button>
              <p className="text-role-label text-glass-muted px-1">Neue Karten holen, deutsche Namen/Bilder ergänzen, anreichern und Preise aktualisieren — alles in einem Schritt.</p>
            </div>
          </div>
        </section>

        {/* 3. Scanner-Debug (mehrstufig) */}
        <section className="space-y-1.5">
          <p className="text-xs font-semibold text-glass-muted uppercase tracking-wide mb-2">Scanner-Debug</p>
          <div className="shadow-card rounded-2xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-role-body font-medium">Scannen</p>
                <p className="text-role-label text-glass-muted">Live-Erkennung + Qualitäts-Ampel (Rahmen/Hinweis/Metriken). Löst KEIN Foto aus, sendet nichts an die KI.</p>
              </div>
              <Switch checked={scannerDebug.scan} onChange={v => setScannerDebug('scan', v)} accentColor="#3182ce" />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-role-body font-medium">KI</p>
                <p className="text-role-label text-glass-muted">Gemini-Rohantwort, erkannte Werte und Latenz einblenden/mitloggen.</p>
              </div>
              <Switch checked={scannerDebug.ai} onChange={v => setScannerDebug('ai', v)} accentColor="#3182ce" />
            </div>
          </div>
        </section>

        {/* 4. Gefahren-Zone */}
        <section className="space-y-1.5">
          <p className="text-xs font-semibold text-glass-muted uppercase tracking-wide mb-2">Gefahren-Zone</p>
          <Button
            variant="secondary" size="lg" className="w-full justify-start"
            icon={<Trash2 size={18} className="text-red-600 dark:text-red-300" />}
            onClick={handleWipeMyData} disabled={resetting}
          >
            {confirmStage === 0
              ? 'Meine Daten löschen'
              : resetting
                ? 'Wird gelöscht…'
                : 'Wirklich? Tippe nochmal zum Bestätigen'}
          </Button>
          <p className="text-role-label text-glass-muted px-1">Löscht alle eigenen Karten, Mappen &amp; Wunschlisten. Der Karten-Katalog bleibt erhalten.</p>
          {resetProgress && (
            <p className="text-role-label text-glass-muted px-1 font-mono">{resetProgress}</p>
          )}
          {confirmStage === 1 && !resetting && (
            <Button variant="ghost" size="sm" className="px-0" onClick={() => setConfirmStage(0)}>Abbrechen</Button>
          )}
        </section>

        {/* 5. Account */}
        <section className="space-y-1.5">
          <p className="text-xs font-semibold text-glass-muted uppercase tracking-wide mb-2">Account</p>
          {userEmail && (
            <p className="text-role-label text-glass-muted px-1">
              Angemeldet als <span className="font-medium text-glass">{userEmail}</span>
            </p>
          )}
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
