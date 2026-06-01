'use client';

import { useMemo } from 'react';
import { getRarityGroup, type RarityGroup } from '@/lib/card-constants';
import type { CardInfo } from '@/lib/card-info';

export interface RarityBreakdownItem {
  group: RarityGroup & { order: number };
  count: number;
  ownedCount: number;
}

/** Berechnet die Rarity-Verteilung aus einer Kartenliste */
export function buildRarityBreakdown(
  cards: CardInfo[],
  ownedIds: Set<string>,
): RarityBreakdownItem[] {
  const map = new Map<string, RarityBreakdownItem>();
  for (const card of cards) {
    const g   = card.rarity ? getRarityGroup(card.rarity) : null;
    const key = g?.label ?? 'Sonstige';
    const entry = map.get(key) ?? {
      group: g ?? { label: key, symbol: '?', color: '#6b7280', order: 50, keys: [] },
      count: 0,
      ownedCount: 0,
    };
    entry.count++;
    if (ownedIds.has(card.id)) entry.ownedCount++;
    map.set(key, entry);
  }
  return Array.from(map.values())
    .sort((a, b) => (a.group.order ?? 50) - (b.group.order ?? 50));
}

interface Props {
  cards: CardInfo[];
  ownedIds: Set<string>;
  activeRarities: Set<string>;
  onToggle: (label: string) => void;
}

export function RarityFilterBar({ cards, ownedIds, activeRarities, onToggle }: Props) {
  const breakdown = useMemo(
    () => buildRarityBreakdown(cards, ownedIds),
    [cards, ownedIds],
  );

  if (breakdown.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1.5">
      {breakdown.map(({ group, count, ownedCount }) => {
        const active    = activeRarities.has(group.label);
        const isCssVar  = group.color.startsWith('var(');
        const activeBg  = isCssVar ? 'var(--muted)' : `${group.color}22`;
        const activeBorder = isCssVar ? 'var(--foreground)' : group.color;

        return (
          <button
            key={group.label}
            onClick={() => onToggle(group.label)}
            className="flex items-center gap-1 rounded-full transition-all px-2 py-0.5 border"
            style={active
              ? { background: activeBg, borderColor: activeBorder }
              : { borderColor: 'transparent' }
            }
          >
            {/* Symbol — Gradient für Amazing Rare */}
            {'gradient' in group && group.gradient ? (
              <span
                className="text-xs font-bold"
                style={{
                  background: group.gradient as string,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {group.symbol}
              </span>
            ) : (
              <span className="text-xs font-bold" style={{ color: group.color }}>
                {group.symbol}
              </span>
            )}
            <span className="text-xs" style={{ color: active ? activeBorder : 'var(--muted-foreground)' }}>
              {ownedCount}/{count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
