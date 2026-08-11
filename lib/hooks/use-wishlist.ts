'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import type { CardInfo } from '@/lib/card-info';
import type { WishlistDoc, BinderDoc } from '@/types';
import { getWishlists, addWishlist, addItemToWishlist, removeItemFromWishlist } from '@/lib/firestore/wishlists';
import { getBinders } from '@/lib/firestore/binders';

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
  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [l, b] = await Promise.all([getWishlists(), getBinders()]);
      setLists(l);
      setBinders(b);
    } finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getWishlists(), getBinders()])
      .then(([l, b]) => { if (!cancelled) { setLists(l); setBinders(b); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const manualLists = useMemo(
    () => lists.filter(l => !l.templateBinderId).map(l => ({ id: l.id, name: l.name, icon: l.icon, color: l.color })),
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

  // tcgId → automatische Listen, auf denen die Karte liegt (nur lesbar im
  // Drawer). Name/Icon/Farbe werden von der Vorlagen-Sammlung geerbt (die
  // Auto-Liste selbst speichert sie nicht), Fallback: eigene Felder/Name.
  const binderById = useMemo(() => new Map(binders.map(b => [b.id, b])), [binders]);
  const autoMembership = useMemo(() => {
    const m = new Map<string, { id: string; name: string; icon?: string; color?: string }[]>();
    for (const l of lists) if (l.templateBinderId) {
      const b = binderById.get(l.templateBinderId);
      const meta = { id: l.id, name: b?.name ?? l.name, icon: b?.icon ?? l.icon, color: b?.color ?? l.color };
      for (const it of l.items) if (it.tcgId) {
        const arr = m.get(it.tcgId) ?? [];
        arr.push(meta);
        m.set(it.tcgId, arr);
      }
    }
    return m;
  }, [lists, binderById]);
  const autoListsFor = useCallback(
    (tcgId: string) => autoMembership.get(tcgId) ?? [],
    [autoMembership],
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

  /** Neue manuelle Liste anlegen (Name/Icon/Farbe), optional Karte direkt aufnehmen. */
  const createList = useCallback(async (meta: { name: string; icon?: string; color?: string }, card?: CardInfo): Promise<string> => {
    const id = await addWishlist(meta.name.trim() || 'Wunschliste', { icon: meta.icon, color: meta.color });
    if (card) await addItemToWishlist(id, toItemInput(card));
    await reload();
    return id;
  }, [reload]);

  return { loaded, manualIds, autoIds, manualLists, memberManualListIds, autoListsFor, toggleOnList, createList, reload };
}
