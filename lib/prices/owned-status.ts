'use client';

import { getCards } from '@/lib/firestore/cards';
import { getCatalogCardsByIds } from '@/lib/firestore/catalog';

/** Passiver Preis-Status der eigenen Sammlung — rein aus den bereits
 *  gecachten Katalog-Preisen (`tcg_catalog.{id}.prices`) berechnet, OHNE
 *  Live-Refresh (kein `/api/prices`-Aufruf, keine pokemontcg.io-Anfrage).
 *  Nutzt nur Client-SDK-Reads, funktioniert also auch ohne Admin-Credentials. */
export interface OwnedPriceStatus {
  /** Anzahl unterschiedlicher besessener Karten (tcgIds) mit einem gecachten Preis. */
  withPrice: number;
  /** Anzahl unterschiedlicher besessener Karten (tcgIds) insgesamt. */
  total: number;
  /** Jüngster `cachedAt`-Zeitpunkt über alle bepreisten Karten — ~letzte Preisaktualisierung. */
  lastRefresh: Date | null;
}

export async function getOwnedPriceStatus(): Promise<OwnedPriceStatus> {
  const cards = await getCards();
  const tcgIds = [...new Set(cards.map(c => c.tcgId).filter(Boolean))] as string[];
  if (tcgIds.length === 0) return { withPrice: 0, total: 0, lastRefresh: null };

  const catalog = await getCatalogCardsByIds(tcgIds);
  let withPrice = 0;
  let lastMs = 0;
  for (const cc of catalog) {
    // `prices` ist am Katalog-Dokument gespeichert, aber nicht Teil des
    // `CatalogCard`-Typs (wird serverseitig geschrieben) — daher `unknown`-Zugriff.
    const p = (cc as unknown as { prices?: { empty?: boolean; variants?: unknown[]; cachedAt?: { toMillis?: () => number } } }).prices;
    if (p && p.empty !== true && Array.isArray(p.variants) && p.variants.length > 0) {
      withPrice++;
      const ms = p.cachedAt?.toMillis?.() ?? 0;
      if (ms > lastMs) lastMs = ms;
    }
  }
  return { withPrice, total: tcgIds.length, lastRefresh: lastMs ? new Date(lastMs) : null };
}
