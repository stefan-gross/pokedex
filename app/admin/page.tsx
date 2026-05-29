'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Database, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { getSyncMeta } from '@/lib/firestore/catalog';
import type { SyncMeta } from '@/lib/firestore/catalog';

interface SyncStatus extends SyncMeta {
  newCards: number;
}

export default function AdminPage() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      const meta = await getSyncMeta();
      if (meta) {
        // Hole aktuellen Total von der API
        const res = await fetch(`/api/admin/sync?secret=${process.env.NEXT_PUBLIC_CRON_SECRET ?? ''}`, {
          headers: { 'x-cron-secret': '' },
        });
        // Zeige einfach die Meta-Daten ohne API-Aufruf (kein Secret nötig für Status-Anzeige)
        setStatus({
          ...meta,
          newCards: (meta.currentTotal ?? 0) - (meta.syncedTotal ?? 0),
        });
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);

  const runSync = async (mode: 'auto' | 'update') => {
    setSyncing(true);
    setLastResult(null);
    try {
      const secret = 'sfz-cron-2026-pokedex';
      const res = await fetch(`/api/admin/sync?mode=${mode}`, {
        method: 'POST',
        headers: { 'x-cron-secret': secret },
      });
      const data = await res.json();
      setLastResult(data.message ?? data.error ?? 'Fertig');
      await loadStatus();
    } catch (err) {
      setLastResult('Fehler: ' + String(err));
    } finally {
      setSyncing(false);
    }
  };

  const pct = status ? Math.round((status.syncedTotal / (status.currentTotal || 1)) * 100) : 0;
  const isComplete = pct >= 100;
  const hasNew = (status?.newCards ?? 0) > 0;

  return (
    <div className="min-h-screen px-4 pt-12 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <Database size={22} />
        <h1 className="text-xl font-bold">Karten-Catalog</h1>
      </div>

      {loading ? (
        <div className="flex justify-center pt-12">
          <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Status Tile */}
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Sync-Status</span>
              {isComplete
                ? <span className="flex items-center gap-1 text-xs text-green-500"><CheckCircle size={13} /> Aktuell</span>
                : hasNew
                  ? <span className="flex items-center gap-1 text-xs text-yellow-500"><Clock size={13} /> Update verfügbar</span>
                  : <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock size={13} /> Läuft…</span>
              }
            </div>

            {/* Fortschrittsbalken */}
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                <span>{(status?.syncedTotal ?? 0).toLocaleString()} gecacht</span>
                <span>{(status?.currentTotal ?? 0).toLocaleString()} gesamt</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: isComplete ? '#48bb78' : 'var(--pokedex-red)' }}
                />
              </div>
              <div className="text-xs text-muted-foreground mt-1">{pct}% synchronisiert</div>
            </div>

            {status?.lastSynced && (
              <div className="text-xs text-muted-foreground">
                Letzter Sync: {new Date(status.lastSynced).toLocaleString('de-DE')}
              </div>
            )}

            {hasNew && (
              <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-yellow-500/10 text-yellow-600">
                <AlertCircle size={13} />
                {status!.newCards} neue Karten verfügbar
              </div>
            )}
          </div>

          {/* Letztes Ergebnis */}
          {lastResult && (
            <div className="px-4 py-3 rounded-xl bg-secondary border border-border text-sm">
              {lastResult}
            </div>
          )}

          {/* Buttons */}
          <div className="space-y-2">
            {/* Neue Karten holen (nur Delta) */}
            <button
              onClick={() => runSync('update')}
              disabled={syncing || (!hasNew && isComplete)}
              className="w-full h-11 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ background: 'var(--pokedex-red)' }}
            >
              {syncing ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Synchronisiert…</>
              ) : (
                <><RefreshCw size={15} /> {hasNew ? `${status!.newCards} neue Karten holen` : 'Auf neue Karten prüfen'}</>
              )}
            </button>

            {/* Initialen Sync fortsetzen (falls nicht fertig) */}
            {!isComplete && (
              <button
                onClick={() => runSync('auto')}
                disabled={syncing}
                className="w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40 bg-secondary border border-border"
              >
                {syncing ? (
                  <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Lädt…</>
                ) : (
                  <>⬇ Nächste 19.000 Karten laden</>
                )}
              </button>
            )}
          </div>

          {/* Hinweis */}
          <p className="text-xs text-muted-foreground text-center px-2">
            Der tägliche Cron-Job (3:00 Uhr) holt automatisch neue Karten.
            Hier kannst du es auch manuell anstoßen.
          </p>
        </div>
      )}
    </div>
  );
}
