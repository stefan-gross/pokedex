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
  updateAvailable: boolean;
}

export function useUpdateAvailable(): UpdateInfo {
  const buildSha = process.env.NEXT_PUBLIC_BUILD_SHA ?? 'dev';
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME;
  const [serverSha, setServerSha] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/version', { cache: 'no-store' })
      .then(r => r.json())
      .then((d: { sha?: string }) => { if (!cancelled) setServerSha(d.sha ?? null); })
      .catch(() => { /* offline / egal */ });
    return () => { cancelled = true; };
  }, []);

  const updateAvailable =
    serverSha != null && buildSha !== 'dev' && serverSha !== 'dev' && serverSha !== buildSha;

  return { buildSha, buildTime, serverSha, updateAvailable };
}
