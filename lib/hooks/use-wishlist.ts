'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import type { CardInfo } from '@/lib/card-info';
import type { WishlistDoc } from '@/types';
import { getWishlists, addWishlist, addItemToWishlist, removeItemFromWishlist } from '@/lib/firestore/wishlists';

/**
 * Lädt einmal alle Wunschlisten und liefert getrennte Status-Lookups für viele
 * Karten-Kacheln gleichzeitig:
 *  - `manualIds` / `autoIds`: tcgId ist auf mind. einer MANUELLEN bzw. einer
 *    AUTOMATISCHEN (Vorlagen-)Wunschliste — Union über ALLE Listen des Typs
 *    (nicht nur eine bestimmte Sammlung). Steuert die Herz-Farbe (rot/weiß/
 *    geteilt/leer).
 *  - `manualLists` + `memberManualListIds(tcgId)`: für den Auswahl-Drawer
 *    (welche manuellen Listen gibt es, auf welchen liegt die Karte).
 *  - `toggleOnList` / `createList`: Schreibpfade für den Drawer.
 */
function toItemInput(card: CardInfo) {
  return {
    tcgId: card.id,
    name: card.name,
    setName: card.setName,
    setId: card.setId,
    number: card.number,
    tcgImageUrl: card.imgLargeDe || card.imgLarge || card.imgSmall,
    priority: 2 as const,
    acquired: false,
  };
}

export function useWishlist() {
  const [lists, setLists] = useState<WishlistDoc[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try { setLists(await getWishlists()); } finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getWishlists()
      .then(l => { if (!cancelled) { setLists(l); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const manualLists = useMemo(
    () => lists.filter(l => !l.templateBinderId).map(l => ({ id: l.id, name: l.name })),
    [lists],
  );

  const manualIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of lists) if (!l.templateBinderId) for (const it of l.items) if (it.tcgId) s.add(it.tcgId);
    return s;
  }, [lists]);

  const autoIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of lists) if (l.templateBinderId) for (const it of l.items) if (it.tcgId) s.add(it.tcgId);
    return s;
  }, [lists]);

  // tcgId → Set<listId> (nur manuelle Listen) — Häkchen im Drawer.
  const manualMembership = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of lists) if (!l.templateBinderId) for (const it of l.items) if (it.tcgId) {
      const set = m.get(it.tcgId) ?? new Set<string>();
      set.add(l.id);
      m.set(it.tcgId, set);
    }
    return m;
  }, [lists]);
  const memberManualListIds = useCallback(
    (tcgId: string) => manualMembership.get(tcgId) ?? new Set<string>(),
    [manualMembership],
  );

  /** Karte auf einer bestimmten manuellen Liste an-/abwählen. */
  const toggleOnList = useCallback(async (card: CardInfo, listId: string) => {
    const list = lists.find(l => l.id === listId);
    if (!list) return;
    const existing = list.items.find(i => i.tcgId === card.id);
    if (existing) await removeItemFromWishlist(listId, existing.id);
    else await addItemToWishlist(listId, toItemInput(card));
    await reload();
  }, [lists, reload]);

  /** Neue manuelle Liste anlegen (optional Karte direkt aufnehmen). */
  const createList = useCallback(async (name: string, card?: CardInfo): Promise<string> => {
    const id = await addWishlist(name.trim() || 'Wunschliste');
    if (card) await addItemToWishlist(id, toItemInput(card));
    await reload();
    return id;
  }, [reload]);

  return { loaded, manualIds, autoIds, manualLists, memberManualListIds, toggleOnList, createList, reload };
}
