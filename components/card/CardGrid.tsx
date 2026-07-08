'use client';

import { useState } from 'react';
import { CardTile } from '@/components/card/CardTile';
import { CardDetailSheet, type SetMeta } from '@/components/card/CardDetailSheet';
import type { CardInfo } from '@/lib/card-info';
import type { CardDoc, BinderDoc } from '@/types';
import { PRICE_COLOR } from '@/lib/prices/value-tier';
import type { TcgSet } from '@/lib/firestore/sets';
import { SYMBOL_ONLY_SERIES } from '@/lib/card-constants';

interface Props {
  cards: CardInfo[];
  /** tcgId → eigene Kopien in der Sammlung */
  ownedMap?: Map<string, CardDoc[]>;
  binders?: BinderDoc[];
  /** Optional: Set-Kontext für den Detail-Sheet (Logo, dt. Name, Gesamtzahl) */
  setMeta?: SetMeta;
  /** Leerer Zustand — z.B. "Keine Karten gefunden" */
  emptyState?: React.ReactNode;
  /** Aktiver Sortierschlüssel — bestimmt das Label unter der Karte */
  sortKey?: string;
  /** tcgId → Preis — nur nötig, wenn nach Preis sortiert wird */
  priceMap?: Map<string, number>;
  /** Wird beim Schließen des Detail-Sheets aufgerufen (z.B. um einen dort frisch
   *  nachgeladenen Preis in die eigene priceMap zu übernehmen). */
  onDetailClose?: (card: CardInfo) => void;
  /** tcgIds, die aktuell auf der Wunschliste stehen — für den Herz-Status. */
  wishlistIds?: Set<string>;
  /** Herz-Klick auf einer Kachel — togglet die Karte auf/von der Wunschliste. */
  onToggleWishlist?: (card: CardInfo) => void;
  /** Preise werden noch per Batch-Route nachgeladen — zeigt animierte
   *  Platzhalter statt "–", solange nach Preis sortiert wird. */
  pricesLoading?: boolean;
  /** setId → Set-Metadaten (Symbol/Kürzel) — nur nötig, wenn `showSetBadge` aktiv ist. */
  setsMeta?: Map<string, TcgSet>;
  /** Zeigt ein kleines Set-Symbol oben links auf jeder Kachel — sinnvoll, wenn
   *  Ergebnisse mehrere Sets umfassen (z.B. Suche nach einem Pokémon-Namen). */
  showSetBadge?: boolean;
}

/** Gibt das passende Label zur aktiven Sortierung zurück. */
function getSublabel(card: CardInfo, sortKey?: string, priceMap?: Map<string, number>): string {
  const key = sortKey?.replace(/-asc$|-desc$/, '') ?? 'number';
  switch (key) {
    case 'name':    return card.name;
    case 'pokedex': return card.nationalDexNumber
      ? `#${String(card.nationalDexNumber).padStart(3, '0')}`
      : ''; // Trainer/Energie haben keine Pokédex-Nummer
    case 'hp':      return card.hp ? `KP ${card.hp}` : formatNumber(card);
    case 'price': {
      const price = priceMap?.get(card.id);
      return price != null ? price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '–';
    }
    default:
      return formatNumber(card);
  }
}
// Mit führenden Nullen wie auf der Karte aufgedruckt (Breite = Ziffernzahl von
// printedTotal/total, z.B. "053" bei einem 198er-Set). Alphanumerische Nummern
// (Promos wie "SWSH092") bleiben unverändert.
function formatNumber(card: CardInfo) {
  const total = card.printedTotal ?? card.total;
  if (total && /^\d+$/.test(card.number)) {
    return card.number.padStart(String(total).length, '0');
  }
  return card.number;
}

/** Animierter Platzhalter, solange Suchergebnisse/Browse-Karten laden — gleiche
 *  Form wie CardTile (Bild + Sublabel-Zeile), damit der Grid-Wechsel nicht springt. */
export function CardGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="w-full aspect-[2.5/3.5] rounded-[8px] animate-pulse bg-[rgba(30,40,80,0.1)] dark:bg-white/10" />
          <div className="h-2.5 w-3/5 mx-auto rounded-full animate-pulse bg-[rgba(30,40,80,0.1)] dark:bg-white/10" />
        </div>
      ))}
    </div>
  );
}

export function CardGrid({
  cards,
  ownedMap = new Map(),
  binders = [],
  setMeta,
  emptyState,
  sortKey,
  priceMap,
  onDetailClose,
  wishlistIds,
  onToggleWishlist,
  pricesLoading,
  setsMeta,
  showSetBadge,
}: Props) {
  const [selected, setSelected] = useState<CardInfo | null>(null);

  if (cards.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  const closeDetail = () => {
    if (selected) onDetailClose?.(selected);
    setSelected(null);
  };

  const sortKeyBase = sortKey?.replace(/-asc$|-desc$/, '') ?? 'number';
  const isPriceSort = sortKeyBase === 'price';
  // Set-Kürzel/-Symbol vor der Nummer ergibt nur bei Nummern-Sortierung Sinn —
  // bei Namens-/Pokédex-/Preis-Sortierung ist die Nummer nicht der Anzeigefokus.
  const showNumberPrefix = showSetBadge && sortKeyBase === 'number';

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(card => {
          const set = setsMeta?.get(card.setId);
          const numberPrefixCode = set?.ptcgoCode ?? card.setCode;
          const series = set?.series ?? card.series;
          const isSymbolOnlySet = !!series && SYMBOL_ONLY_SERIES.includes(series);
          const numberPrefixSymbolUrl = isSymbolOnlySet ? set?.symbolUrl : undefined;
          return (
          <CardTile
            key={card.id}
            card={card}
            ownedCards={ownedMap.get(card.id)}
            onCardClick={() => setSelected(card)}
            sublabel={getSublabel(card, sortKey, priceMap)}
            sublabelColor={isPriceSort ? PRICE_COLOR : undefined}
            sublabelLoading={isPriceSort && pricesLoading && priceMap?.get(card.id) == null}
            isWishlisted={wishlistIds?.has(card.id)}
            onWishlist={() => onToggleWishlist?.(card)}
            setSymbolUrl={showSetBadge ? set?.symbolUrl : undefined}
            setCode={numberPrefixCode}
            numberPrefixCode={showNumberPrefix && !numberPrefixSymbolUrl ? numberPrefixCode : undefined}
            numberPrefixSymbolUrl={showNumberPrefix ? numberPrefixSymbolUrl : undefined}
          />
          );
        })}
      </div>

      <CardDetailSheet
        card={selected}
        ownedCopies={selected ? (ownedMap.get(selected.id) ?? []) : []}
        binders={binders}
        setMeta={setMeta}
        onClose={closeDetail}
        onSaved={closeDetail}
      />
    </>
  );
}
