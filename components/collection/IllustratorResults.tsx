'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, User } from 'lucide-react';

/** Ergebnisliste des „Illustrator"-Such-Scopes: passende Illustratoren (Foto +
 *  Name), immer Name aufsteigend, Tippen öffnet die Profilseite. Liste kommt aus
 *  `/api/artists` (nur angereicherte Profile), client-seitig gecacht + gefiltert. */

interface ArtistRow { slug: string; name: string; photoUrl: string | null }

// Prozess-weiter Cache, damit ein Scope-Wechsel nicht neu lädt.
let cache: ArtistRow[] | null = null;

export function IllustratorResults({ query, onCount }: { query: string; onCount?: (n: number | null) => void }) {
  const [all, setAll] = useState<ArtistRow[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (cache) return;
    let alive = true;
    fetch('/api/artists')
      .then(r => r.json())
      .then(d => { if (!alive) return; cache = (d.artists ?? []) as ArtistRow[]; setAll(cache); setLoading(false); })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => (q ? all.filter(a => a.name.toLowerCase().includes(q)) : all), [all, q]);

  // Trefferzahl an den Aufrufer melden (Header-Anzeige rechts neben dem Suchfeld);
  // während des Ladens `null`, damit dort nichts Falsches steht.
  useEffect(() => { onCount?.(loading ? null : rows.length); }, [loading, rows.length, onCount]);

  if (loading) return <p className="text-role-body text-glass-muted px-1 py-6 text-center">Illustratoren werden geladen …</p>;
  if (rows.length === 0) return <p className="text-role-body text-glass-muted px-1 py-6 text-center">Keine Illustratoren gefunden.</p>;

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(a => (
        <Link
          key={a.slug}
          href={`/artists/${encodeURIComponent(a.name)}`}
          className="flex items-center gap-3 rounded-2xl px-3 py-2 glass-inner active:scale-[.99] transition-transform"
        >
          <span className="w-10 h-10 rounded-full overflow-hidden bg-[rgba(120,130,150,0.18)] shrink-0 flex items-center justify-center">
            {a.photoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={a.photoUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
              : <User size={18} className="text-glass-muted" />}
          </span>
          <span className="text-role-title text-glass truncate">{a.name}</span>
          <ChevronRight size={18} className="ml-auto shrink-0 text-glass-muted" />
        </Link>
      ))}
    </div>
  );
}
