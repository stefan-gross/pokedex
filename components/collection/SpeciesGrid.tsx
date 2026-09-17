'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import SPECIES from '@/lib/pokemon-species-de.json';
import { pokemonArtworkUrl } from '@/lib/binder-icons';

/** Pokédex-Grid des „Pokémon"-Such-Scopes: alle 1025 Spezies als Kacheln mit
 *  offiziellem Artwork (= Sammlungs-Icon), client-seitig nach Suchbegriff (Name
 *  oder Dex-Nummer) gefiltert und nach Name/Dex sortiert. Große Menge → Reveal-
 *  Chunk beim Scrollen. Tap → `onSelect(dex)` (aktuell: Karten dieses Pokémon). */

interface Species { dex: number; name: string }
const ALL = SPECIES as Species[];
const REVEAL = 60;

export function SpeciesGrid({ query, sort, dir = 'asc', onSelect }: {
  query: string;
  sort: 'name' | 'dex';
  dir?: 'asc' | 'desc';
  onSelect: (dex: number) => void;
}) {
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = ALL;
    if (q) {
      const num = q.replace(/^#/, '');
      const numeric = /^\d+$/.test(num);
      r = r.filter(p => p.name.toLowerCase().includes(q) || (numeric && String(p.dex).includes(num)));
    }
    const sgn = dir === 'desc' ? -1 : 1;
    return [...r].sort((a, b) => sgn * (sort === 'name' ? a.name.localeCompare(b.name, 'de') : a.dex - b.dex));
  }, [query, sort, dir]);

  const [visible, setVisible] = useState(REVEAL);
  useEffect(() => { setVisible(REVEAL); }, [query, sort, dir]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setVisible(v => Math.min(v + REVEAL, list.length));
    }, { rootMargin: '500px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [list.length]);

  if (list.length === 0) return <p className="text-role-body text-glass-muted px-1 py-6 text-center">Keine Pokémon gefunden.</p>;

  return (
    <>
      <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
        {list.slice(0, visible).map(p => (
          <button
            key={p.dex}
            onClick={() => onSelect(p.dex)}
            className="flex flex-col items-center gap-1 rounded-2xl p-2 glass-inner active:scale-[.97] transition-transform"
          >
            <span className="w-full aspect-square flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pokemonArtworkUrl(p.dex)}
                alt={p.name}
                loading="lazy"
                className="w-full h-full object-contain"
                onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
              />
            </span>
            <span className="text-role-label text-glass truncate max-w-full text-center leading-tight">{p.name}</span>
            <span className="text-role-badge text-glass-muted tabular-nums">#{String(p.dex).padStart(4, '0')}</span>
          </button>
        ))}
      </div>
      <div ref={sentinelRef} className="h-1" />
    </>
  );
}
