'use client';

import { useEffect, useMemo, useState } from 'react';
import { getCatalogCardsByIds } from '@/lib/firestore/catalog';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';

/**
 * Löst eine Liste von tcgIds zu einer `Map<tcgId, CardInfo>` aus dem Katalog auf
 * (DE-Namen/-Bilder). Kapselt das vorher an mehreren Stellen (Dashboard,
 * Binder-Detail, BinderSlotPicker) wortgleich duplizierte
 * getCatalogCardsByIds→Map-Muster inkl. Dedupe/Cancellation. Stabiler `key`
 * (sortierte, deduplizierte IDs) → kein Re-Fetch bei gleicher Menge.
 */
export function useCatalogInfoMap(tcgIds: (string | null | undefined)[]): Map<string, CardInfo> {
  const [map, setMap] = useState<Map<string, CardInfo>>(new Map());
  const key = useMemo(
    () => [...new Set(tcgIds.filter((x): x is string => !!x))].sort().join(','),
    [tcgIds],
  );
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) { setMap(new Map()); return; }
    let alive = true;
    getCatalogCardsByIds(ids)
      .then(ccs => { if (alive) setMap(new Map(ccs.map(cc => [cc.id, catalogCardToInfo(cc)]))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [key]);
  return map;
}
