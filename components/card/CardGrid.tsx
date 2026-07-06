'use client';

import { useState } from 'react';
import { CardTile } from '@/components/card/CardTile';
import { CardDetailSheet, type SetMeta } from '@/components/card/CardDetailSheet';
import type { CardInfo } from '@/lib/card-info';
import type { CardDoc, BinderDoc } from '@/types';

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
}

/** Gibt das passende Label zur aktiven Sortierung zurück */
function getSublabel(card: CardInfo, sortKey?: string, priceMap?: Map<string, number>): string {
  const key = sortKey?.replace(/-asc$|-desc$/, '') ?? 'number';
  switch (key) {
    case 'name':    return card.name;
    case 'pokedex': return card.nationalDexNumber
      ? `#${String(card.nationalDexNumber).padStart(3, '0')}`
      : formatNumber(card);
    case 'hp':      return card.hp ? `KP ${card.hp}` : formatNumber(card);
    case 'price': {
      const price = priceMap?.get(card.id);
      return price != null ? price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '–';
    }
    default:        return formatNumber(card);
  }
}
function formatNumber(card: CardInfo) {
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
}: Props) {
  const [selected, setSelected] = useState<CardInfo | null>(null);

  if (cards.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(card => (
          <CardTile
            key={card.id}
            card={card}
            ownedCards={ownedMap.get(card.id)}
            onCardClick={() => setSelected(card)}
            sublabel={getSublabel(card, sortKey, priceMap)}
          />
        ))}
      </div>

      <CardDetailSheet
        card={selected}
        ownedCopies={selected ? (ownedMap.get(selected.id) ?? []) : []}
        binders={binders}
        setMeta={setMeta}
        onClose={() => setSelected(null)}
        onSaved={() => setSelected(null)}
      />
    </>
  );
}
