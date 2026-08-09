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

// Modulweiter Cache: Set-Metadaten ändern sich innerhalb einer Session nicht.
// Ohne Cache löste JEDER Set-Logo-Binder (und jedes erneute Öffnen) einen
// eigenen `getSetById`-Read aus → langsamer Aufbau + „me02"-Flash, bis der
// Read zurückkommt. Nur erfolgreiche Ergebnisse cachen (Fehler nicht, damit ein
// späterer Aufruf neu versucht).
const metaCache = new Map<string, SetMeta>();

/**
 * Lädt Set-Metadaten (DE-Name, Logo, Symbol, gedruckte Gesamtzahl) aus der
 * `tcg_sets`-Firestore-Collection — kein externer API-Call. Wenn `preloaded`
 * übergeben wird (z.B. vom Set-Detail-Screen, der die Metadaten bereits geladen
 * hat), wird kein Fetch ausgelöst. Ergebnisse werden modulweit gecacht.
 */
export function useSetMeta(
  setId: string | undefined,
  preloaded: SetMeta | undefined,
  fallbackName: string | undefined,
): SetMeta | undefined {
  const [meta, setMeta] = useState<SetMeta | undefined>(
    preloaded ?? (setId ? metaCache.get(setId) : undefined),
  );

  useEffect(() => {
    if (preloaded) { setMeta(preloaded); return; }
    if (!setId) { setMeta(undefined); return; }
    const cached = metaCache.get(setId);
    if (cached) { setMeta(cached); return; }   // sofort, kein Read
    let cancelled = false;
    getSetById(setId).then(setDoc => {
      if (cancelled) return;
      const m: SetMeta = {
        nameDe: setDoc?.nameDe ?? setDoc?.name ?? fallbackName ?? setId,
        logoUrl: setDoc?.logoUrl ?? "",
        symbolUrl: setDoc?.symbolUrl,
        printedTotal: setDoc?.printedTotal ?? 0,
        total: setDoc?.total ?? 0,
      };
      metaCache.set(setId, m);
      setMeta(m);
    }).catch(() => {
      if (!cancelled) {
        setMeta({
          nameDe: fallbackName ?? setId,
          logoUrl: '',
          printedTotal: 0,
          total: 0,
        });
      }
    });
    return () => { cancelled = true; };
  }, [setId, preloaded, fallbackName]);

  return meta;
}
