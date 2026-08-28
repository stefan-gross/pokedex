'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { EnergyIcon } from '@/components/ui/EnergyIcon';
import type { EnergyType } from '@/components/ui/EnergyIcon';
import type { DeckStats as DeckStatsData } from '@/lib/decks/stats';

/** Einklappbares Statistik-Panel im Deck-Editor (Standard eingeklappt).
 *  Reine Anzeige der von computeDeckStats gerechneten Werte, CSS-Balken. */
export function DeckStats({ stats }: { stats: DeckStatsData }) {
  const [open, setOpen] = useState(false);

  const cat = stats.byCategory;
  const catTotal = (cat.pokemon + cat.trainer + cat.energy + cat.other) || 1;
  const types = Object.entries(stats.byType).sort((a, b) => b[1] - a[1]);
  const maxType = Math.max(1, ...types.map(t => t[1]));
  const costEntries = Object.entries(stats.energyCostHistogram)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const maxCost = Math.max(1, ...costEntries.map(c => c[1]));

  return (
    <div className="rounded-2xl glass mb-4 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3">
        <span className="font-semibold">Statistik</span>
        <ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-4">
          {/* Kategorie-Aufteilung */}
          <div>
            <div className="flex h-3 rounded-full overflow-hidden">
              <div style={{ width: `${(cat.pokemon / catTotal) * 100}%`, background: '#e53e3e' }} />
              <div style={{ width: `${(cat.trainer / catTotal) * 100}%`, background: '#4299e1' }} />
              <div style={{ width: `${(cat.energy / catTotal) * 100}%`, background: '#ecc94b' }} />
              <div style={{ width: `${(cat.other / catTotal) * 100}%`, background: '#a0aec0' }} />
            </div>
            <div className="flex gap-3 mt-1.5 text-role-label flex-wrap">
              <Legend color="#e53e3e" label="Pokémon" n={cat.pokemon} />
              <Legend color="#4299e1" label="Trainer" n={cat.trainer} />
              <Legend color="#ecc94b" label="Energie" n={cat.energy} />
              {cat.other > 0 && <Legend color="#a0aec0" label="Sonst." n={cat.other} />}
            </div>
          </div>

          <div className="text-role-label"><span className="font-semibold">{stats.basicPokemonCount}</span> Basis-Pokémon</div>

          {/* Typ-Verteilung */}
          {types.length > 0 && (
            <div>
              <p className="text-role-label font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Typen</p>
              <div className="flex flex-col gap-1">
                {types.map(([t, n]) => (
                  <div key={t} className="flex items-center gap-2">
                    <EnergyIcon type={t as EnergyType} size={16} />
                    <div className="flex-1 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(n / maxType) * 100}%`, background: 'var(--foreground)' }} />
                    </div>
                    <span className="w-6 text-right text-role-label tabular-nums">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Energiekosten-Kurve (Attacken) */}
          {costEntries.length > 0 && (
            <div>
              <p className="text-role-label font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Energiekosten (Attacken)</p>
              <div className="flex items-end gap-2 h-20">
                {costEntries.map(([cost, n]) => (
                  <div key={cost} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-role-label tabular-nums">{n}</span>
                    <div className="w-full rounded-t" style={{ height: `${(n / maxCost) * 100}%`, background: '#4299e1', minHeight: 2 }} />
                    <span className="text-role-label tabular-nums text-muted-foreground">{cost}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      {label} {n}
    </span>
  );
}
