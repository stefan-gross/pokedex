import { getCards, updateCard } from '@/lib/firestore/cards';
import { resolveScannedCard, type ResolveDeps } from '@/lib/scan/resolve-card';
import {
  getCardBySetCodeAndNumberRest,
  getCardBySetAndNumberRest,
  getCardsByDexNumberRest,
  getCardsByNameAndNumberRest,
} from '@/lib/firestore/catalog-rest';
import { getSetById, getSetIdsByPrintedTotal } from '@/lib/firestore/sets';
import { catalogCardToInfo } from '@/lib/card-info';
import type { CardDoc } from '@/types';

export interface ReconcileResult {
  /** Wie viele vorläufige Karten geprüft wurden. */
  checked: number;
  /** Wie viele eindeutig verknüpft (nicht mehr vorläufig) wurden. */
  linked: number;
}

/**
 * Prüft alle vorläufigen (nicht katalogisierten) Karten gegen den AKTUELLEN
 * Katalog und verknüpft eindeutige Treffer: setzt `tcgId`/Katalogfelder + echtes
 * Bild und entfernt das `pendingCatalog`-Flag. Nutzt dieselbe Regel-Leiter wie
 * der Scanner (`resolveScannedCard`) — konservativ: nur bei `status==='unique'`
 * wird verknüpft, bei Mehrdeutigkeit/keinem Treffer bleibt die Karte unverändert
 * vorläufig (nie falsch verknüpfen). Läuft nach einem Katalog-Sync bzw. bei
 * vorhandenen vorläufigen Karten beim App-Start.
 */
export async function reconcilePendingCards(preloaded?: CardDoc[]): Promise<ReconcileResult> {
  const all = preloaded ?? await getCards();
  const pending = all.filter(c => c.pendingCatalog && c.manualData);
  if (pending.length === 0) return { checked: 0, linked: 0 };

  const setTotalCache = new Map<string, number | null>();
  const deps: ResolveDeps = {
    bySetCodeAndNumber: getCardBySetCodeAndNumberRest,
    bySetAndNumber: getCardBySetAndNumberRest,
    byNameAndNumber: getCardsByNameAndNumberRest,
    byDexNumber: (dex: number) => getCardsByDexNumberRest(dex, 100),
    setIdsByPrintedTotal: getSetIdsByPrintedTotal,
    setPrintedTotal: async (setId: string) => {
      if (!setTotalCache.has(setId)) {
        const doc = await getSetById(setId).catch(() => null);
        setTotalCache.set(setId, doc?.printedTotal ?? null);
      }
      return setTotalCache.get(setId) ?? null;
    },
  };

  let linked = 0;
  for (const c of pending) {
    const m = c.manualData!;
    const resolved = await resolveScannedCard(
      {
        setCode: m.setCode ?? null,
        number: m.number ?? null,
        printedTotal: m.printedTotal ?? null,
        name: m.name ?? null,
        nationalDexNumber: m.dexNumber ?? null,
      },
      deps,
    ).catch(() => null);

    if (resolved?.status === 'unique' && resolved.card) {
      const info = catalogCardToInfo(resolved.card);
      // pendingCatalog:false genügt — der Anzeige-Pfad liest manualData nur bei
      // pendingCatalog, das verbleibende manualData-Feld ist danach totes Datum.
      await updateCard(c.id, {
        tcgId: info.id,
        setId: info.setId,
        setName: info.setName,
        series: info.series,
        number: info.number,
        rarity: info.rarity,
        pokemonType: info.types?.[0],
        supertype: info.supertype,
        pendingCatalog: false,
      });
      linked++;
    }
  }
  return { checked: pending.length, linked };
}
