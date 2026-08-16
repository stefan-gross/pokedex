import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  orderBy, query, Timestamp, writeBatch, arrayUnion, runTransaction,
} from 'firebase/firestore';
import { db } from '../firebase/client';
import type { WishlistDoc, WishlistItem } from '@/types';

const COL = 'wishlists';

export async function getWishlists(): Promise<WishlistDoc[]> {
  const snap = await getDocs(query(collection(db, COL), orderBy('createdAt', 'desc')));
  const lists = snap.docs.map(d => ({ id: d.id, ...d.data() } as WishlistDoc));
  // Manuelle Listen zuerst (nach nutzerdefinierter sortOrder, Altbestand ohne
  // sortOrder ans Ende), automatische (Vorlagen-)Listen danach. `orderBy` auf
  // sortOrder ginge nicht (Firestore würde Docs ohne das Feld ausschließen),
  // daher clientseitig sortiert.
  return lists.sort((a, b) => {
    const at = a.templateBinderId ? 1 : 0;
    const bt = b.templateBinderId ? 1 : 0;
    if (at !== bt) return at - bt;
    const as = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bs = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (as !== bs) return as - bs;
    return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
  });
}

export async function getWishlist(id: string): Promise<WishlistDoc | null> {
  const snap = await getDoc(doc(db, COL, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as WishlistDoc) : null;
}

export async function addWishlist(
  name: string,
  opts?: { description?: string; icon?: string; color?: string; sortOrder?: number },
): Promise<string> {
  const ref = await addDoc(collection(db, COL), {
    name,
    description: opts?.description ?? '',
    items: [],
    sortOrder: opts?.sortOrder ?? Date.now(),
    ...(opts?.icon ? { icon: opts.icon } : {}),
    ...(opts?.color ? { color: opts.color } : {}),
    createdAt: Timestamp.now(),
  });
  return ref.id;
}

/** Einzelne freie Standard-Wishlist — analog zu `ensureDefaultBinder`.
 *  Explizit die erste NICHT an einen Vorlagen-Binder gekoppelte Liste
 *  (`!templateBinderId`) — sonst würde z.B. „Auf Wunschliste setzen" im
 *  Kartendetail eine automatisch verwaltete Vorlagen-Wunschliste treffen,
 *  falls die zufällig neuer/zuerst in der Sortierung ist. */
export async function ensureDefaultWishlist(): Promise<WishlistDoc> {
  const lists = await getWishlists();
  const free = lists.find(l => !l.templateBinderId);
  if (free) return free;
  const id = await addWishlist('Wunschliste');
  return { id, name: 'Wunschliste', description: '', items: [], createdAt: Timestamp.now() };
}

export async function updateWishlist(id: string, data: Partial<WishlistDoc>): Promise<void> {
  await updateDoc(doc(db, COL, id), data);
}

export async function deleteWishlist(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}

/** Löscht die automatische Wunschliste(n), die an einen bestimmten
 *  Vorlagen-Binder gekoppelt sind — aufgerufen beim Löschen der Sammlung
 *  (`deleteBinderCascade`), damit keine verwaiste Auto-Wunschliste zurückbleibt.
 *  `known` erspart einen erneuten Read, wenn die Listen schon geladen sind. */
export async function deleteWishlistsForBinder(binderId: string, known?: WishlistDoc[]): Promise<void> {
  const lists = known ?? await getWishlists();
  for (const w of lists) {
    if (w.templateBinderId === binderId) await deleteDoc(doc(db, COL, w.id));
  }
}

/** Räumt verwaiste automatische Wunschlisten auf: solche mit `templateBinderId`,
 *  deren Vorlagen-Sammlung nicht mehr existiert oder keine Vorlage mehr ist
 *  (z.B. Sammlung gelöscht/umbenannt). Erwartet die bereits geladenen Listen
 *  UND Binder (kein zusätzlicher Read, keine Race), löscht die Waisen und gibt
 *  die überlebenden Listen zurück. */
export async function pruneOrphanTemplateWishlists(
  lists: WishlistDoc[],
  binders: { id: string; template?: unknown }[],
): Promise<WishlistDoc[]> {
  // Schutz vor dem Auth-Token-Race (private Reads liefern kurzzeitig []):
  // NIE anhand einer leeren Binder-Liste löschen — sonst würden alle
  // Auto-Wunschlisten fälschlich als Waisen gelöscht. Wer Auto-Listen hat,
  // hat auch Vorlagen-Sammlungen; ein leeres `binders` heißt „nicht geladen".
  if (binders.length === 0) return lists;
  const templateIds = new Set(binders.filter(b => b.template != null).map(b => b.id));
  const orphans = lists.filter(l => l.templateBinderId && !templateIds.has(l.templateBinderId));
  for (const o of orphans) {
    try { await deleteDoc(doc(db, COL, o.id)); }
    catch (e) { console.error('[wishlists] prune orphan error', o.id, e); }
  }
  if (orphans.length === 0) return lists;
  const removed = new Set(orphans.map(o => o.id));
  return lists.filter(l => !removed.has(l.id));
}

/** Schreibt die neue Reihenfolge der (manuellen) Wunschlisten: `sortOrder`
 *  = Position 0..n-1 in einem Batch-Write (gespiegelt von `reorderBinders`).
 *  Automatische Listen werden NICHT übergeben und bleiben durch die
 *  `getWishlists`-Sortierung hinter den manuellen. */
export async function reorderWishlists(orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const batch = writeBatch(db);
  orderedIds.forEach((id, i) => batch.update(doc(db, COL, id), { sortOrder: i }));
  await batch.commit();
}

// Alle drei Mutationen sind atomar, damit parallele Toggles (schnelles
// Herz-Tippen über mehrere Listen) sich nicht per Read-Modify-Write des ganzen
// `items`-Arrays gegenseitig überschreiben (Lost-Update). Hinzufügen nutzt
// `arrayUnion` (neue UUID → eindeutig), Ändern/Entfernen eine Transaction.
export async function addItemToWishlist(wishlistId: string, item: Omit<WishlistItem, 'id'>): Promise<WishlistItem | null> {
  const ref = doc(db, COL, wishlistId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const newItem: WishlistItem = { ...item, id: crypto.randomUUID() };
  await updateDoc(ref, { items: arrayUnion(newItem) });
  return newItem;
}

export async function updateWishlistItem(wishlistId: string, itemId: string, data: Partial<WishlistItem>): Promise<void> {
  const ref = doc(db, COL, wishlistId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const items = ((snap.data().items ?? []) as WishlistItem[]).map(i => i.id === itemId ? { ...i, ...data } : i);
    tx.update(ref, { items });
  });
}

export async function removeItemFromWishlist(wishlistId: string, itemId: string): Promise<void> {
  const ref = doc(db, COL, wishlistId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const items = ((snap.data().items ?? []) as WishlistItem[]).filter(i => i.id !== itemId);
    tx.update(ref, { items });
  });
}
