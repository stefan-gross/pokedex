'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getCards } from '@/lib/firestore/cards';
import { SERIES_NAMES_DE } from '@/lib/set-names-de';
import type { CardDoc } from '@/types';

interface TcgSet {
  id: string;
  name: string;
  nameDe?: string;
  logoDe?: string;
  series: string;
  printedTotal: number;
  total: number;
  ptcgoCode?: string;
  releaseDate: string;
  images: { symbol: string; logo: string };
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
      <div className="sticky top-safe z-20 bg-background border-b border-border px-4 pt-4 pb-3 flex items-center gap-3">
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
              <div key={group.name} className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Series-Header */}
                <div className="px-4 py-3 flex items-center justify-between border-b border-border"
                     style={{ background: 'rgba(255,255,255,0.025)' }}>
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    {seriesName}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {totalOwned.toLocaleString('de-DE')}/{totalCards.toLocaleString('de-DE')}
                  </span>
                </div>

                {/* Sets */}
                {group.sets.map((set, i) => {
                  const ownedCount = ownedBySet.get(set.id) ?? 0;
                  const pct = set.total ? Math.round((ownedCount / set.total) * 100) : 0;
                  const isLast = i === group.sets.length - 1;

                  return (
                    <Link
                      key={set.id}
                      href={`/sets/${set.id}?from=sets`}
                      className={`flex items-center gap-3 px-4 py-3 active:bg-secondary transition-colors${isLast ? '' : ' border-b border-border'}`}
                    >
                      {/* Logo: deutsch (TCGdex) → englisch (pokemontcg.io) → verstecken */}
                      <div className="w-14 shrink-0 flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={set.logoDe ?? `https://images.pokemontcg.io/${set.id}/logo.png`}
                          alt={set.nameDe ?? set.name}
                          className="max-h-8 max-w-[56px] object-contain"
                          onError={e => {
                            const img = e.currentTarget as HTMLImageElement;
                            if (set.logoDe && img.src === set.logoDe) {
                              img.src = `https://images.pokemontcg.io/${set.id}/logo.png`;
                            } else {
                              img.style.display = 'none';
                            }
                          }}
                        />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        {/* Row 1: Name + Code + Count */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">{set.nameDe ?? set.name}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {set.ptcgoCode && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md border" style={{ color: 'var(--foreground)', borderColor: 'var(--foreground)' }}>
                                {set.ptcgoCode}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {ownedCount}/{set.total}
                            </span>
                          </div>
                        </div>
                        {/* Row 2: Progress bar */}
                        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, background: 'var(--pokedex-red)' }}
                          />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
