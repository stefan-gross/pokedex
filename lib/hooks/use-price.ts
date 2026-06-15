'use client';

import { useEffect, useState } from 'react';
import type { PriceResult } from '@/lib/prices/types';

/** In-Memory-Cache pro Session — dedupliziert Fetches für die gleiche tcgId. */
const cache = new Map<string, { data: PriceResult | null; ts: number }>();
/** Laufende Fetches, damit parallele Mounts derselben tcgId nicht doppelt feuern. */
const pending = new Map<string, Promise<PriceResult | null>>();

/** Session-Cache-TTL: nach 30 Min wird neu vom Server geholt (der wiederum
 *  seinen eigenen 24-h-Cache hat). */
const SESSION_TTL_MS = 30 * 60 * 1000;

async function fetchPrice(tcgId: string): Promise<PriceResult | null> {
  if (pending.has(tcgId)) return pending.get(tcgId)!;
  const p = (async () => {
    try {
      const res = await fetch(`/api/prices?tcgId=${encodeURIComponent(tcgId)}`);
      if (!res.ok) return null;
      return await res.json() as PriceResult;
    } catch {
      return null;
    }
  })();
  pending.set(tcgId, p);
  try {
    const data = await p;
    cache.set(tcgId, { data, ts: Date.now() });
    return data;
  } finally {
    pending.delete(tcgId);
  }
}

export interface UsePriceState {
  data: PriceResult | null;
  loading: boolean;
}

export function usePrice(tcgId: string | undefined): UsePriceState {
  const [data, setData] = useState<PriceResult | null>(() => {
    if (!tcgId) return null;
    const c = cache.get(tcgId);
    return c && Date.now() - c.ts < SESSION_TTL_MS ? c.data : null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!tcgId) return false;
    const c = cache.get(tcgId);
    return !(c && Date.now() - c.ts < SESSION_TTL_MS);
  });

  useEffect(() => {
    if (!tcgId) { setData(null); setLoading(false); return; }
    const c = cache.get(tcgId);
    if (c && Date.now() - c.ts < SESSION_TTL_MS) {
      setData(c.data);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    fetchPrice(tcgId).then(d => {
      if (!alive) return;
      setData(d);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [tcgId]);

  return { data, loading };
}
