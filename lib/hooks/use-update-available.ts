'use client';

import { useEffect, useState } from 'react';

/**
 * Vergleicht die ins Client-Bundle eingebackene Build-SHA mit der Laufzeit-SHA
 * des aktuell deployten Servers (`/api/version`). Weichen sie ab, läuft eine
 * ältere (gecachte PWA-)Version als der neueste Deploy → Update verfügbar.
 */
export interface UpdateInfo {
  buildSha: string;
  buildTime: string | undefined;
  serverSha: string | null;
  /** Server hat definitiv eine andere (neuere) SHA als das geladene Bundle. */
  updateAvailable: boolean;
  /** Bestätigt aktuell (Server-SHA == geladene SHA). Nur dann sperren. */
  confirmedCurrent: boolean;
}

export function useUpdateAvailable(): UpdateInfo {
  const buildSha = process.env.NEXT_PUBLIC_BUILD_SHA ?? 'dev';
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME;
  const [serverSha, setServerSha] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetch('/api/version', { cache: 'no-store' })
        .then(r => r.json())
        .then((d: { sha?: string }) => { if (!cancelled) setServerSha(d.sha ?? null); })
        .catch(() => { /* offline / egal — serverSha bleibt, Button nicht gesperrt */ });
    };
    check();
    // Regelmäßig prüfen, damit ein neuer Deploy ohne Reload bemerkt wird — 2 Min
    // reicht: der häufige Fall (App-Rückkehr) ist durch Focus/Visibility unten
    // ohnehin sofort abgedeckt; ein kürzeres Intervall wäre nur unnötige Netz-/
    // Batterie-Last im Leerlauf.
    const id = setInterval(check, 120_000);
    // … und sofort bei Rückkehr in die App (App-Fokus / Tab sichtbar).
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  const updateAvailable =
    serverSha != null && buildSha !== 'dev' && serverSha !== 'dev' && serverSha !== buildSha;
  // „aktuell" nur, wenn der Server dieselbe SHA meldet — bei unbekannt (null,
  // z.B. Prüfung fehlgeschlagen) NICHT sperren, damit man nie festhängt.
  const confirmedCurrent = serverSha != null && serverSha === buildSha;

  return { buildSha, buildTime, serverSha, updateAvailable, confirmedCurrent };
}
