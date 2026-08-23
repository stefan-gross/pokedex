'use client';

import { useState, useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import { searchCatalogCards } from '@/lib/search/catalog-search';
import { getSetById } from '@/lib/firestore/sets';
import { catalogCardToInfo, resolveCardImage, type CardInfo } from '@/lib/card-info';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SetBadge { symbolUrl?: string; nameDe: string }

export interface ScanReportResult {
  reportType: 'wrong' | 'not_in_catalog';
  correctedCardId?: string;
  correctedName?: string;
  note?: string;
}

interface Props {
  /** Was die App erkannt hatte (Kontext) — leer bei „nicht erkannt". */
  recognizedName?: string;
  /** Das gescannte Bild (data-URL) zur Orientierung. */
  imageSrc?: string;
  onClose: () => void;
  onSubmit: (result: ScanReportResult) => void;
}

/** Melden-Sheet: der Nutzer wählt per Katalogsuche die RICHTIGE Karte
 *  (Grundwahrheit) oder „nicht im Katalog". Läuft über dem Kamerabild →
 *  `forceDark elevated`. */
export function ScanReportSheet({ recognizedName, imageSrc, onClose, onSubmit }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CardInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [setBadges, setSetBadges] = useState<Map<string, SetBadge>>(new Map());

  // Set-Metadaten (Symbol + dt. Name, z.B. „Dunkelnacht") für die Treffer-Sets
  // nachladen → im Picker Symbol + Set-Name statt nur der Set-ID zeigen.
  useEffect(() => {
    const ids = [...new Set(results.map(r => r.setId).filter(Boolean))];
    const missing = ids.filter(id => !setBadges.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map(async id => {
      const s = await getSetById(id).catch(() => null);
      return [id, { symbolUrl: s?.symbolUrl, nameDe: s?.nameDe ?? s?.name ?? id }] as const;
    })).then(entries => {
      if (cancelled) return;
      setSetBadges(prev => { const m = new Map(prev); for (const [id, v] of entries) m.set(id, v); return m; });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  useEffect(() => {
    const term = q.trim();
    // Alle State-Updates laufen in der Timeout-Callback (nicht synchron im
    // Effekt-Body) — vermeidet Kaskaden-Renders (react-hooks/set-state-in-effect).
    const t = setTimeout(async () => {
      if (term.length < 2) { setResults([]); setLoading(false); return; }
      setLoading(true);
      try {
        const { cards } = await searchCatalogCards(term, { displayLimit: 40 });
        setResults(cards.map(catalogCardToInfo));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (c: CardInfo) =>
    onSubmit({ reportType: 'wrong', correctedCardId: c.id, correctedName: c.name, note: note.trim() || undefined });

  return (
    <Sheet
      open
      onClose={onClose}
      dragToClose
      elevated
      forceDark
      bodyClassName="px-2 pb-4"
      header={
        <div className="shrink-0">
          <div className="px-4 pb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-semibold">Scan melden</h2>
              {recognizedName && (
                <p className="text-[11px] text-muted-foreground truncate">Erkannt als: {recognizedName} — wähle die richtige Karte</p>
              )}
            </div>
            <Button variant="ghost" onClick={onClose} icon={<X />} aria-label="Schließen" className="shrink-0" />
          </div>
          <div className="px-4 pb-3 flex items-center gap-2">
            {imageSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageSrc} alt="Scan" className="w-10 h-14 rounded object-cover shrink-0 border" style={{ borderColor: 'var(--border)' }} />
            )}
            <Input
              variant="search"
              value={q}
              onChange={setQ}
              onClear={() => setQ('')}
              placeholder="Richtige Karte suchen (Name/Nummer)…"
              autoFocus
            />
          </div>
        </div>
      }
      footer={
        <div className="flex items-center gap-2 px-4 py-2">
          <Input value={note} onChange={setNote} placeholder="Notiz (optional)" className="flex-1" />
          <Button
            variant="secondary"
            onClick={() => onSubmit({ reportType: 'not_in_catalog', note: note.trim() || undefined })}
          >
            Nicht im Katalog
          </Button>
        </div>
      }
    >
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : q.trim().length < 2 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">Tippe den Namen der richtigen Karte ein.</div>
        ) : results.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">Keine Karten gefunden.</div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5">
            {results.map(info => (
              <button
                key={info.id}
                onClick={() => pick(info)}
                className="flex items-center gap-2 px-2 py-2 rounded-md text-left transition-colors hover:bg-secondary active:bg-secondary"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resolveCardImage(info)}
                  alt={info.name}
                  className="w-9 h-12 rounded object-cover shrink-0"
                  onError={e => { e.currentTarget.style.visibility = 'hidden'; }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{info.name}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
                    {setBadges.get(info.setId)?.symbolUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={setBadges.get(info.setId)!.symbolUrl} alt="" className="w-4 h-4 object-contain shrink-0" />
                    )}
                    <span className="truncate">{setBadges.get(info.setId)?.nameDe ?? info.setName}</span>
                    <span className="font-mono shrink-0">· {info.number}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
