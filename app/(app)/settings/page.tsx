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

/** Beschrifteter Fortschrittsbalken. Konvention: LINKS die Anzahl (mit Label),
 *  RECHTS der Prozentwert (ggf. Zusatzwerte in Klammern). Ampel-Farbe. */
function StatBar({ label, value, total, extra }: { label: string; value: number; total: number; extra?: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-role-label">
        <span className="text-glass tabular-nums"><span className="text-glass-muted">{label} </span>{value.toLocaleString('de-DE')}</span>
        <span className="text-glass tabular-nums">{pct} %{extra ? <span className="text-glass-muted"> {extra}</span> : null}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[rgba(30,40,80,0.10)] dark:bg-white/25 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor(pct) }} />
      </div>
    </div>
  );
}

/** Geschichteter Balken: Basis = Karten mit IRGENDEINEM Bild (Ampel-Farbe),
 *  Overlay (höherer z-Index) = Karten mit deutschem Bild (blauer Akzent).
 *  LINKS Anzahl (irgendein Bild), RECHTS % + in Klammern die Anzahl DE-Bilder. */
function StatBarImages({ any, de, total }: { any: number; de: number; total: number }) {
  const anyPct = total > 0 ? Math.round((any / total) * 100) : 0;
  const dePct  = total > 0 ? Math.round((de  / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-role-label">
        <span className="text-glass tabular-nums">
          <span className="text-glass-muted">Bilder </span>{any.toLocaleString('de-DE')}
          <span className="text-glass-muted"> ({de.toLocaleString('de-DE')})</span>
        </span>
        <span className="text-glass tabular-nums">
          {anyPct} %<span className="text-glass-muted"> ({dePct} %)</span>
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
  const [runPct,      setRunPct]      = useState(0);

  // Zusammenfassung + Zeitpunkt des letzten „Daten aktualisieren"-Laufs,
  // in `localStorage` gehalten (der Lauf wird komplett clientseitig orchestriert).
  const [lastDataRun, setLastDataRun] = useState<{ at: string; diff: string } | null>(null);

  const LAST_RUN_KEY = 'pokedex-last-data-run';

  useEffect(() => {
    setMounted(true);
    loadSyncStatus();
    try {
      const raw = localStorage.getItem(LAST_RUN_KEY);
      if (raw) setLastDataRun(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  async function loadSyncStatus(): Promise<SyncStatus | null> {
    try {
      const res = await fetch('/api/admin/trigger-sync');
      if (res.ok) {
        const data = await res.json();
        // newCards kommt phantom-bereinigt vom Server — NICHT hier neu rechnen.
        const next = { ...data, newCards: data.newCards ?? 0 } as SyncStatus;
        setSyncStatus(next);
        return next;
      }
    } catch { /* ignore */ } finally {
      setSyncLoading(false);
    }
    return null;
  }

  async function runAllSteps() {
    setRunningAll(true);
    setSyncing(true);
    setSyncResult(null);
    // step(msg, pct?): Text immer setzen; pct nur bei Phasenwechsel (Balken).
    const step = (msg: string, pct?: number) => { setAllProgress(msg); if (pct != null) setRunPct(pct); };
    step('▶ Starte…', 2);

    // Vorher-Stand für die Diff-Anzeige (was hat der Lauf NETTO verändert?).
    const before = await loadSyncStatus();

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
      step('🗂️ (1/6) Sets werden synchronisiert…', 8);
      const setsRes  = await fetch('/api/admin/sync-sets', { method: 'POST' });
      const setsData = await setsRes.json().catch(() => ({}));

      // 2. Neue/fehlende Karten gezielt nachziehen (Delta-Sync, günstig).
      step('📥 (2/6) Neue Karten werden geholt…', 22);
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
      step('🇩🇪 (3/6) Deutsche Namen & Bilder werden ergänzt…', 42);
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
      step('🧬 (4/6) Evolutionsdaten werden angereichert…', 60);
      let evoTotal = 0;
      while (true) {
        const res  = await fetch('/api/admin/enrich-evolution', { method: 'POST' });
        const data = await res.json();
        evoTotal += data.enriched ?? 0;
        step(`🧬 (4/6) Evolutionsdaten: ${evoTotal} Karten…`);
        if (data.status !== 'in-progress') break;
      }

      // 5. Pokémon-Artdaten (PokéAPI)
      step('📖 (5/6) Pokémon-Artdaten werden angereichert…', 74);
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
      step('💶 (6/6) Preise werden aktualisiert…', 88);
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
      step('🔗 Vorläufige Karten werden geprüft…', 96);
      const { linked } = await reconcilePendingCards().catch(() => ({ linked: 0, checked: 0 }));

      // Nachher-Stand → NETTO-Diff. Nur die TATSÄCHLICH geänderten Werte auflisten.
      const after = await loadSyncStatus();
      const d = (k: keyof SyncStatus) => (after?.[k] as number ?? 0) - (before?.[k] as number ?? 0);
      const parts: string[] = [];
      const add = (label: string, n: number) => { if (n !== 0) parts.push(`${label} ${n > 0 ? '+' : ''}${n.toLocaleString('de-DE')}`); };
      add('Karten', d('totalCards'));
      add('Bilder', d('withImage'));
      add('DE-Bilder', d('withDeImage'));
      add('DE-Namen', d('withDeName'));
      add('Preise', d('withPrice'));
      if (linked > 0) parts.push(`${linked} verknüpft`);
      const changed = parts.length > 0;
      const diff = parts.join(' · '); // leer, wenn nichts geändert → Block wird ausgeblendet

      // Lauf-Ende serverseitig stempeln: „Zuletzt geprüft" immer, „Zuletzt
      // geändert" nur bei echten Änderungen → Statuszeilen matchen den Lauf.
      await fetch('/api/admin/touch-meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changed }),
      }).catch(() => {});
      step('✅ Fertig', 100);

      const run = { at: new Date().toISOString(), diff };
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

  // EINE Gesamtzahl für ALLE Balken = tatsächliche Kartenanzahl im Katalog
  // (inkl. der vorläufigen/manuell gepflegten Karten ohne Set). Alle Prozentwerte
  // beziehen sich hierauf.
  const catTotal   = syncStatus?.totalCards ?? syncStatus?.syncedTotal ?? 0;
  const hasNew     = (syncStatus?.newCards ?? 0) > 0;
  // „Aktuell" = keine neuen Karten mehr offen (phantom-bereinigt).
  const isComplete = !hasNew && (syncStatus?.syncedTotal ?? 0) > 0;
  // Katalog-Balken: Anteil der gecachten an der Gesamtzahl, gedeckelt auf 100 %
  // (gecacht kann durch manuelle Karten nie ÜBER die Gesamtzahl liegen).
  const pct        = catTotal > 0 ? Math.min(100, Math.round(((syncStatus?.syncedTotal ?? 0) / catTotal) * 100)) : 0;
  const busy       = runningAll || syncing;

  // „Letzter Lauf"-Diff: 0-Werte auch aus ALTEN localStorage-Einträgen entfernen
  // (z.B. „Karten 0"), sodass nur echte Änderungen erscheinen.
  const lastRunDiff = (lastDataRun?.diff ?? '')
    .split(' · ').map(s => s.trim()).filter(p => p && !/ 0$/.test(p)).join(' · ');

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
                  <div className="flex justify-between text-role-label">
                    <span className="text-glass tabular-nums"><span className="text-glass-muted">Karten </span>{catTotal.toLocaleString('de-DE')}</span>
                    <span className="text-glass tabular-nums">{pct} %{hasNew ? <span className="text-glass-muted"> · {syncStatus!.newCards.toLocaleString('de-DE')} neu</span> : null}</span>
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
                      Zuletzt geändert: {new Date(syncStatus.lastSynced).toLocaleString('de-DE')}
                    </p>
                  )}
                  {/* „Zuletzt geprüft" nur, wenn es sich von „Zuletzt geändert"
                      unterscheidet (letzte Prüfung ergab keine Änderung). Sind sie
                      gleich, wäre die Zeile redundant. */}
                  {syncStatus?.lastChecked && syncStatus.lastChecked !== syncStatus.lastSynced && (
                    <p className="text-role-label text-glass-muted">
                      Zuletzt geprüft: {new Date(syncStatus.lastChecked).toLocaleString('de-DE')}
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

            {/* Laufender Fortschritt: Balken + aktueller Schritt */}
            {runningAll && (
              <div className="px-4 py-3 space-y-2 bg-[rgba(30,40,80,0.06)] dark:bg-white/10 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14]">
                <div className="h-1.5 rounded-full bg-[rgba(30,40,80,0.10)] dark:bg-white/25 overflow-hidden">
                  <div className="h-full rounded-full bg-[#3182ce] transition-all duration-500" style={{ width: `${runPct}%` }} />
                </div>
                <p className="text-xs font-medium text-glass">{allProgress}</p>
              </div>
            )}

            {/* Letzter Daten-Lauf: nur die tatsächlich geänderten Werte (ohne
                Datum — das steht bei „Zuletzt geändert/geprüft"). Nichts geändert
                → kein Block. */}
            {!runningAll && lastRunDiff && (
              <div className="px-4 py-3 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14]">
                <p className="text-role-label text-glass"><span className="text-glass-muted">Letzter Lauf: </span>{lastRunDiff}</p>
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
