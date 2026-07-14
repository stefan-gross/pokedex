import { ensureEvenPages } from '@/lib/binder-sheets';
import { resolveTemplateSlots } from './resolve';
import { resolveSlotWinners } from './slot-winner';
import type { BinderDoc, BinderPage, WishlistItem, CardDoc } from '@/types';

/** Ein Slot, dessen Gewinner sich durch diesen Sync-Lauf geändert hat —
 *  `event: 'filled'` wenn die Position vorher leer war, `'replaced'` wenn
 *  dort vorher eine andere (jetzt verlierende) Karte lag. Reiner Vorher-/
 *  Nachher-Vergleich der Pages, keine zusätzlichen Queries nötig — wird
 *  genutzt, um dem Nutzer beim Hinzufügen einer Karte genau zu sagen, was
 *  in der automatischen Sammlung passiert ist (Lücke gefüllt vs. Variante
 *  ersetzt vs. gar keine Änderung bei reinen Duplikaten). */
export interface SlotChangeEvent {
  cardId: string;
  event: 'filled' | 'replaced';
  previousCardId?: string;
}

export interface BinderSyncPlan {
  pages: BinderPage[];
  pagesChanged: boolean;
  winnerCardIds: string[];
  loserCardIds: string[];
  wishlistItems: WishlistItem[];
  changedCardEvents: SlotChangeEvent[];
}

/** Baut das Seiten-Layout eines Vorlagen-Binders direkt aus der geordneten
 *  Gewinner-Liste (inkl. `null` für fehlende Slots AN DER RICHTIGEN
 *  POSITION) — bewusst NICHT über `cardIdsToPages` (das ist für den
 *  Legacy-Flat-Fall ohne Lücken gedacht und würde besessene Karten einfach
 *  vorne zusammenschieben statt Lücken an Ort und Stelle zu lassen). */
function buildPages(orderedSlotIds: (string | null)[], size: number): BinderPage[] {
  const pages: BinderPage[] = [];
  for (let i = 0; i < orderedSlotIds.length; i += size) {
    const slice = orderedSlotIds.slice(i, i + size);
    while (slice.length < size) slice.push(null);
    pages.push({ slots: slice });
  }
  if (pages.length === 0) pages.push({ slots: Array(size).fill(null) });
  return ensureEvenPages(pages, size);
}

/** Reine Berechnung (bis auf den einen Katalog-Read in `resolveTemplateSlots`,
 *  der gegen die offene `tcg_catalog`-Collection läuft und daher sowohl mit
 *  Client- als auch Admin-Kontext funktioniert) — geteilt zwischen dem
 *  Client-seitigen Sync (`sync.ts`, Firebase Client SDK, läuft in
 *  Mutations-Flows im Browser) und dem Admin-seitigen Sync (`sync-admin.ts`,
 *  Firebase Admin SDK, läuft im Cron-Job) — `binders`/`cards`/`wishlists`
 *  verlangen `request.auth != null` und können daher serverseitig nicht
 *  über die Client-SDK-Funktionen in `lib/firestore/*.ts` gelesen/
 *  geschrieben werden. Diese Funktion kennt nur die reine Logik, keine
 *  Firestore-Schreibvorgänge — der jeweilige Aufrufer übernimmt das I/O. */
export async function computeBinderSyncPlan(
  binder: BinderDoc,
  ownedCards: CardDoc[],
  existingWishlistItems: WishlistItem[],
): Promise<BinderSyncPlan> {
  if (!binder.template) throw new Error('computeBinderSyncPlan: Binder hat keine Vorlage');

  const slots = await resolveTemplateSlots(binder.template);
  // Nur "pokedex" gruppiert mehrere mögliche Drucke in EINEN Slot (Dex-
  // Nummer) — "pokemon" hat wie "artist"/"masterSet" schon einen Slot pro
  // exakter Karte, da greift die Sprach-Fallback-Frage nicht.
  const languageAware = binder.template.type === 'pokedex';
  const resolutions = resolveSlotWinners(slots, ownedCards, { languageAware }).sort((a, b) => a.order - b.order);

  const size = binder.size ?? 9;
  const pages = buildPages(resolutions.map(r => r.winnerCardId), size);
  const pagesChanged = JSON.stringify(pages) !== JSON.stringify(binder.pages ?? []);

  const winnerCardIds = resolutions
    .map(r => r.winnerCardId)
    .filter((id): id is string => id !== null);
  const loserCardIds = resolutions.flatMap(r => r.loserCardIds);

  const existingByTcgId = new Map(existingWishlistItems.map(i => [i.tcgId, i]));
  const wishlistItems: WishlistItem[] = resolutions
    .filter(r => r.winnerCardId === null && r.missingCatalog)
    .map(r => {
      const cc = r.missingCatalog!;
      return existingByTcgId.get(cc.id) ?? {
        id: crypto.randomUUID(),
        tcgId: cc.id,
        name: cc.nameDe ?? cc.name,
        setName: cc.setName,
        setId: cc.setId,
        number: cc.number,
        tcgImageUrl: cc.imgSmallDe || cc.imgSmall,
        priority: 2,
        acquired: false,
      };
    });

  // Vorher/Nachher-Vergleich pro Slot-Position — deckt sowohl neue Sheets
  // (alte Position existiert nicht → wie leer behandelt) als auch
  // geschrumpfte/gewachsene Vorlagen ab.
  const oldFlat = (binder.pages ?? []).flatMap(p => p.slots);
  const newFlat = pages.flatMap(p => p.slots);
  const changedCardEvents: SlotChangeEvent[] = [];
  newFlat.forEach((cardId, i) => {
    if (!cardId) return;
    const previous = oldFlat[i] ?? null;
    if (previous === cardId) return;
    changedCardEvents.push({
      cardId,
      event: previous === null ? 'filled' : 'replaced',
      previousCardId: previous ?? undefined,
    });
  });

  return { pages, pagesChanged, winnerCardIds, loserCardIds, wishlistItems, changedCardEvents };
}
