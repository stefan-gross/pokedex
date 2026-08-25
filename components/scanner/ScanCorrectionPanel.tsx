'use client';

import { useState, useEffect } from 'react';
import { X, ArrowLeftRight, Loader2 } from 'lucide-react';
import { searchCatalogCards } from '@/lib/search/catalog-search';
import { getCardsByDexNumberRest } from '@/lib/firestore/catalog-rest';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { getSetById } from '@/lib/firestore/sets';
import { CardImage } from '@/components/card/CardImage';
import { Input } from '@/components/ui/input';

interface Group { key: string; label: string; accent?: boolean }
interface Item { info: CardInfo; group: string }
interface SetBadge { symbolUrl?: string; nameDe: string }

interface Props {
  /** Sichtbar? Steuert die Slide-Animation (B2: Panel gleitet übers Sheet). */
  open: boolean;
  /** Aktuell erkannte Karte — Dex-Nr. für „gleiche Art", ID zum Ausschließen. */
  card: CardInfo;
  /** pHash-/mehrdeutige Kandidaten des Scans (falls vorhanden). */
  candidates?: CardInfo[];
  /** Erkannte Sprache — steuert EN-/DE-Bild + Namensanzeige. */
  language?: string;
  /** Nutzer wählt die richtige Karte → korrigieren + still melden. */
  onPick: (cardId: string) => void;
  /** Fallback: Karte ist nicht im Katalog. */
  onNotInCatalog: () => void;
  onClose: () => void;
}

/**
 * Korrektur-Panel (B2): gleitet als solides Panel ÜBER das Info-Glas-Sheet, das
 * große Kartenbild dahinter bleibt fix. Kombinierter Slider — erst echte
 * Kandidaten („Wahrscheinlich"), dann dieselbe Art in anderen Sets („Gleiche
 * Art", via Dex-Nr.) — plus Freitextsuche (Katalog + Dex-Brücke). Eine Auswahl
 * korrigiert die Anzeige UND meldet still (Grundwahrheit). Kein Notizfeld.
 */
export function ScanCorrectionPanel({
  open, card, candidates, language, onPick, onNotInCatalog, onClose,
}: Props) {
  // Slide-Mount: beim Öffnen einblenden (rAF → Transition greift), beim Schließen
  // erst raus-animieren, dann unmounten.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [q, setQ] = useState('');
  const [searchResults, setSearchResults] = useState<Item[] | null>(null);
  const [family, setFamily] = useState<CardInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [setBadges, setSetBadges] = useState<Map<string, SetBadge>>(new Map());

  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    // Schließen: raus-animieren, unmounten, Suche für nächstes Öffnen zurücksetzen.
    setShown(false);
    setQ('');
    setSearchResults(null);
    const t = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(t);
  }, [open]);

  // „Gleiche Art" (Dex-Brücke) beim Öffnen laden — sprachübergreifend alle
  // Auflagen derselben Art, ohne die schon als Kandidat gezeigten / die aktuelle.
  useEffect(() => {
    if (!open || card.nationalDexNumber == null) { setFamily([]); return; }
    let cancelled = false;
    getCardsByDexNumberRest(card.nationalDexNumber, 60)
      .then(cards => { if (!cancelled) setFamily(cards.map(catalogCardToInfo)); })
      .catch(() => { if (!cancelled) setFamily([]); });
    return () => { cancelled = true; };
  }, [open, card.nationalDexNumber]);

  // Freitextsuche (Katalog + Dex-Brücke), debounced.
  useEffect(() => {
    const term = q.trim();
    const t = setTimeout(async () => {
      if (term.length < 2) { setSearchResults(null); setLoading(false); return; }
      setLoading(true);
      try {
        const { cards } = await searchCatalogCards(term, { displayLimit: 40, bridgeByDex: true });
        setSearchResults(cards.map(c => ({ info: catalogCardToInfo(c), group: 'search' })));
      } catch {
        setSearchResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // Vorbelegte Liste (ohne Suche): Kandidaten zuerst, dann gleiche Art —
  // dedupliziert, aktuelle Karte raus.
  const prefill: Item[] = (() => {
    const seen = new Set<string>([card.id]);
    const out: Item[] = [];
    for (const c of candidates ?? []) {
      if (!seen.has(c.id)) { seen.add(c.id); out.push({ info: c, group: 'cand' }); }
    }
    for (const c of family) {
      if (!seen.has(c.id)) { seen.add(c.id); out.push({ info: c, group: 'family' }); }
    }
    return out;
  })();

  const items = searchResults ?? prefill;

  const GROUPS: Record<string, Group> = {
    cand:   { key: 'cand',   label: 'Wahrscheinlich', accent: true },
    family: { key: 'family', label: 'Gleiche Art' },
    search: { key: 'search', label: '' },
  };

  // Set-Symbol + dt. Set-Name für die Treffer nachladen (gleichnamige Auflagen).
  useEffect(() => {
    const ids = [...new Set(items.map(i => i.info.setId).filter(Boolean))];
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
  }, [items]);

  if (!mounted) return null;

  return (
    <div
      className="dark absolute inset-0 z-30 rounded-[24px] flex flex-col overflow-hidden"
      style={{
        background: '#0d1017',
        border: '1px solid rgba(255,255,255,0.10)',
        transform: shown ? 'translateY(0)' : 'translateY(102%)',
        transition: 'transform .3s cubic-bezier(.22,.9,.3,1)',
      }}
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5">
        <span className="flex items-center gap-2 text-[15px] font-bold text-[#f4c542]">
          <ArrowLeftRight size={17} /> Richtige Karte wählen
        </span>
        <button
          onClick={onClose}
          aria-label="Abbrechen"
          className="w-8 h-8 flex items-center justify-center rounded-lg"
          style={{ background: 'rgba(255,255,255,0.08)' }}
        >
          <X size={17} color="#fff" />
        </button>
      </div>

      <div className="px-4 pb-2">
        <Input
          variant="search"
          value={q}
          onChange={setQ}
          onClear={() => setQ('')}
          placeholder="Name oder Nummer …"
          autoFocus
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-white/50"><Loader2 size={16} className="animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-sm text-white/50">
            {searchResults ? 'Keine Karten gefunden.' : 'Tippe den Namen der richtigen Karte ein.'}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1 items-stretch">
            {items.map((it, idx) => {
              const prev = items[idx - 1];
              const showLabel = !searchResults && it.group !== prev?.group && GROUPS[it.group]?.label;
              const badge = setBadges.get(it.info.setId);
              const hasEn = it.info.nameEn && it.info.nameEn !== it.info.name;
              return (
                <div key={it.info.id} className="flex gap-3 shrink-0">
                  {showLabel && (
                    <div
                      className="shrink-0 self-center text-[10px] font-semibold tracking-wide"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', color: GROUPS[it.group].accent ? '#f4c542' : 'rgba(255,255,255,0.5)' }}
                    >
                      {GROUPS[it.group].label}
                    </div>
                  )}
                  <button
                    onClick={() => onPick(it.info.id)}
                    className="shrink-0 w-[150px] rounded-2xl p-2 text-left"
                    style={{ border: it.group === 'cand' ? '1.5px solid #f4c542' : '1.5px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.04)' }}
                    aria-label={`${it.info.name} ${it.info.setCode ?? it.info.setId} ${it.info.number}`}
                  >
                    <div className="relative">
                      {it.group === 'cand' && (
                        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 px-2 py-0.5 rounded-md text-[9px] font-bold" style={{ background: '#f4c542', color: '#3a2c00' }}>Kandidat</span>
                      )}
                      <CardImage card={it.info} size="small" language={language} alt={it.info.name} width={150} height={210} className="w-full aspect-[5/7] rounded-lg object-cover" />
                    </div>
                    <div className="mt-2 text-[13px] font-semibold leading-tight text-white truncate">{it.info.name}</div>
                    {hasEn && <div className="text-[10px] text-white/45 leading-tight truncate -mt-0.5">{it.info.nameEn}</div>}
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-white/65">
                      {badge?.symbolUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={badge.symbolUrl} alt="" className="w-4 h-4 object-contain shrink-0" />
                      )}
                      <span className="truncate">{badge?.nameDe ?? it.info.setName}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/45 font-mono tabular-nums">Nr. {it.info.number}</div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button
        onClick={onNotInCatalog}
        className="shrink-0 py-2.5 text-[12px] font-semibold text-center border-t"
        style={{ color: 'rgba(255,255,255,0.6)', borderColor: 'rgba(255,255,255,0.08)' }}
      >
        Nicht dabei? <span style={{ color: '#f4c542', textDecoration: 'underline' }}>Nicht im Katalog melden</span>
      </button>
    </div>
  );
}
