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
}

/** Gibt das passende Label zur aktiven Sortierung zurück */
function getSublabel(card: CardInfo, sortKey?: string): string {
  const key = sortKey?.replace(/-asc$|-desc$/, '') ?? 'number';
  switch (key) {
    case 'name':    return card.name;
    case 'pokedex': return card.nationalDexNumber
      ? `#${String(card.nationalDexNumber).padStart(3, '0')}`
      : formatNumber(card);
    case 'hp':      return card.hp ? `KP ${card.hp}` : formatNumber(card);
    default:        return formatNumber(card);
  }
}
function formatNumber(card: CardInfo) {
  const total = card.printedTotal ?? card.total;
  return card.number + (total ? `/${total}` : '');
}

export function CardGrid({
  cards,
  ownedMap = new Map(),
  binders = [],
  setMeta,
  emptyState,
  sortKey,
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
            sublabel={getSublabel(card, sortKey)}
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
