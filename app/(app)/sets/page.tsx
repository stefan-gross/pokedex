'use client';

import { useEffect, useState, useMemo } from 'react';
import { ChevronLeft, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCards } from '@/lib/firestore/cards';
import { SERIES_NAMES_DE } from '@/lib/set-names-de';
import { SetListItem } from '@/components/set/SetListItem';
import { ScrollToTopButton } from '@/components/ui/ScrollToTopButton';
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

/** Jahres-Spanne eines Zyklus: „2025" bei gleichem Start/Ende, sonst „2022–2023". */
function yearRange(sets: TcgSet[]): string | null {
  const years = sets.map(s => s.releaseDate?.slice(0, 4)).filter((y): y is string => !!y);
  if (years.length === 0) return null;
  const min = years.reduce((a, b) => (a < b ? a : b));
  const max = years.reduce((a, b) => (a > b ? a : b));
  return min === max ? min : `${min}–${max}`;
}

export default function SetsPage() {
  const [sets, setSets]   = useState<TcgSet[]>([]);
  const [owned, setOwned] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  // Beim ersten Laden nur den neuesten Zyklus (erste Gruppe) aufklappen.
  useEffect(() => {
    if (groups.length > 0) setExpanded(prev => (prev.size === 0 ? new Set([groups[0].name]) : prev));
  }, [groups]);

  const toggleSeries = (name: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  return (
    <div className="min-h-screen">
      {/* Header-Panel (Glas) */}
      <div className="sticky top-safe z-20 px-3 pt-3 pb-1">
        <div className="glass rounded-[20px] px-4 pt-2 pb-3">
          <Button variant="ghost" href="/" className="px-0 -ml-1" icon={<ChevronLeft size={18} strokeWidth={2} />}>
            Dashboard
          </Button>
          <div className="flex items-end justify-between gap-3">
            <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.2)]">Alle Sets</h1>
            {!loading && (
              <div className="flex flex-col items-end shrink-0 text-glass-muted text-sm leading-tight">
                <span><span className="font-bold text-glass tabular-nums">{groups.length}</span> Zyklen</span>
                <span><span className="font-bold text-glass tabular-nums">{sets.length}</span> Sets</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center pt-16">
          <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="px-4 py-4 space-y-4 pb-8">
          {groups.map(group => {
            const seriesName = SERIES_NAMES_DE[group.name] ?? group.name;
            const hasOwned = group.sets.some(set => (ownedBySet.get(set.id) ?? 0) > 0);
            const span = yearRange(group.sets);
            const isOpen = expanded.has(group.name);

            return (
              <div key={group.name} className="glass rounded-2xl overflow-hidden">
                {/* Series-Header — klappt den Zyklus auf/zu */}
                <button
                  type="button"
                  onClick={() => toggleSeries(group.name)}
                  aria-expanded={isOpen}
                  className={`w-full px-4 py-3 flex items-center justify-between gap-2 text-left${
                    isOpen ? ' border-b border-[rgba(46,46,50,0.1)] dark:border-white/10' : ''
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {hasOwned && (
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: 'var(--action-add)' }}
                        aria-label="Karten vorhanden"
                      />
                    )}
                    <span className="text-xs font-bold text-glass-muted uppercase tracking-widest truncate">
                      {seriesName}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {span && <span className="text-role-label text-glass-muted">{span}</span>}
                    <ChevronDown
                      size={18}
                      className={`text-glass-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </span>
                </button>

                {/* Sets — nur im aufgeklappten Zyklus */}
                {isOpen && group.sets.map((set, i) => (
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
                    releaseDate={set.releaseDate}
                    href={`/sets/${set.id}?from=sets`}
                    separator={i < group.sets.length - 1}
                    variant="glass"
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      <ScrollToTopButton />
    </div>
  );
}
