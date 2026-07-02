'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getCards } from '@/lib/firestore/cards';
import { SERIES_NAMES_DE } from '@/lib/set-names-de';
import { SetListItem } from '@/components/set/SetListItem';
import type { CardDoc } from '@/types';

interface TcgSet {
  id: string;
  name: string;
  nameDe?: string;
  logoUrl?: string;    // DE-Logo (TCGdex) wenn verfügbar, sonst EN-Fallback
  logoUrlEn?: string;
  symbolUrl?: string;
  series: string;
  printedTotal: number;
  total: number;
  ptcgoCode?: string;
  releaseDate: string;
}

interface SeriesGroup {
  name: string;
  sets: TcgSet[];
}

export default function SetsPage() {
  const [sets, setSets]   = useState<TcgSet[]>([]);
  const [owned, setOwned] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/sets').then(r => r.json()),
      getCards(),
    ]).then(([setsData, ownedCards]) => {
      setSets(setsData.data ?? []);
      setOwned(ownedCards);
    }).finally(() => setLoading(false));
  }, []);

  // Karten pro setId zählen
  const ownedBySet = useMemo(() => {
    const map = new Map<string, number>();
    for (const card of owned) {
      if (card.setId) map.set(card.setId, (map.get(card.setId) ?? 0) + 1);
    }
    return map;
  }, [owned]);

  // Sets nach Series gruppieren (Reihenfolge: wie von API — neueste zuerst)
  const groups = useMemo<SeriesGroup[]>(() => {
    const map = new Map<string, TcgSet[]>();
    for (const set of sets) {
      const existing = map.get(set.series) ?? [];
      map.set(set.series, [...existing, set]);
    }
    return Array.from(map.entries()).map(([series, s]) => ({ name: series, sets: s }));
  }, [sets]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-safe z-20 bg-background shadow-header px-4 pt-4 pb-3 flex items-center gap-3">
        <Link href="/" className="text-muted-foreground shrink-0">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="font-semibold text-base">Alle Sets</h1>
      </div>

      {loading ? (
        <div className="flex justify-center pt-16">
          <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="px-4 py-4 space-y-4 pb-8">
          {groups.map(group => {
            const seriesName = SERIES_NAMES_DE[group.name] ?? group.name;
            const totalOwned = group.sets.reduce((s, set) => s + (ownedBySet.get(set.id) ?? 0), 0);
            const totalCards = group.sets.reduce((s, set) => s + set.total, 0);

            return (
              <div key={group.name} className="bg-card rounded-2xl shadow-card overflow-hidden">
                {/* Series-Header */}
                <div className="px-4 py-3 flex items-center justify-between border-b border-border/30"
                     style={{ background: 'rgba(255,255,255,0.025)' }}>
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    {seriesName}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {totalOwned.toLocaleString('de-DE')}/{totalCards.toLocaleString('de-DE')}
                  </span>
                </div>

                {/* Sets */}
                {group.sets.map((set, i) => (
                  <SetListItem
                    key={set.id}
                    setId={set.id}
                    name={set.name}
                    nameDe={set.nameDe}
                    logoDe={set.logoUrl}
                    owned={ownedBySet.get(set.id) ?? 0}
                    total={set.total}
                    ptcgoCode={set.ptcgoCode}
                    symbolUrl={set.symbolUrl}
                    series={set.series}
                    href={`/sets/${set.id}?from=sets`}
                    separator={i < group.sets.length - 1}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
