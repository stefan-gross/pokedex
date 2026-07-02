import { useEffect, useState } from 'react';
import { getSetById } from '@/lib/firestore/sets';

export interface SetMeta {
  nameDe: string;
  logoUrl: string;
  symbolUrl?: string;
  /** Aufgedruckte Kartenanzahl (z.B. "111/172") — das steht auf der Karte. */
  printedTotal: number;
  /** Gesamtzahl inkl. Secret Rares (z.B. 186 bei Brilliant Stars, printedTotal=172).
   *  Größer als printedTotal nur wenn das Set tatsächlich Secret Rares hat. */
  total: number;
}

/**
 * Lädt Set-Metadaten (DE-Name, Logo, Symbol, gedruckte Gesamtzahl) aus der
 * `tcg_sets`-Firestore-Collection — kein externer API-Call. Wenn `preloaded`
 * übergeben wird (z.B. vom Set-Detail-Screen, der die Metadaten bereits geladen
 * hat), wird kein Fetch ausgelöst.
 */
export function useSetMeta(
  setId: string | undefined,
  preloaded: SetMeta | undefined,
  fallbackName: string | undefined,
): SetMeta | undefined {
  const [meta, setMeta] = useState<SetMeta | undefined>(preloaded);

  useEffect(() => {
    if (preloaded) { setMeta(preloaded); return; }
    if (!setId) { setMeta(undefined); return; }
    let cancelled = false;
    getSetById(setId).then(setDoc => {
      if (cancelled) return;
      setMeta({
        nameDe: setDoc?.nameDe ?? setDoc?.name ?? fallbackName ?? setId,
        logoUrl: setDoc?.logoUrl ?? `https://images.pokemontcg.io/${setId}/logo.png`,
        symbolUrl: setDoc?.symbolUrl,
        printedTotal: setDoc?.printedTotal ?? 0,
        total: setDoc?.total ?? 0,
      });
    }).catch(() => {
      if (!cancelled) {
        setMeta({
          nameDe: fallbackName ?? setId,
          logoUrl: `https://images.pokemontcg.io/${setId}/logo.png`,
          printedTotal: 0,
          total: 0,
        });
      }
    });
    return () => { cancelled = true; };
  }, [setId, preloaded, fallbackName]);

  return meta;
}
