'use client';

import { useState, useEffect } from 'react';
import { X, ArrowLeftRight, Loader2, Flag, FilePlus } from 'lucide-react';
import { searchCatalogCards } from '@/lib/search/catalog-search';
import { getCardsByDexNumberRest } from '@/lib/firestore/catalog-rest';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { getSetById } from '@/lib/firestore/sets';
import { CardImage } from '@/components/card/CardImage';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface Item { info: CardInfo; group: string }
interface SetBadge { symbolUrl?: string; logoUrl?: string; nameDe: string; code?: string; printedTotal?: number }

/** Aufgedruckte Sammelnummer, wie auf der Karte: „022/025" bzw. Promo „XY133". */
function printedNumber(number: string, printedTotal?: number): string {
  const base = number.split('/')[0];
  const padded = /^\d+$/.test(base) ? base.padStart(3, '0') : base;
  return printedTotal ? `${padded}/${String(printedTotal).padStart(3, '0')}` : padded;
}

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
  /** Aus dem Scan gebaute Pending-Karte (Name/Nummer/Set-Signal gelesen), die als
   *  erstes Slider-Item „Nicht im Katalog" angeboten wird. null → nicht baubar
   *  (dann Fallback-Button „Nicht im Katalog"). */
  pendingCard?: CardInfo | null;
  /** „Nicht im Katalog": Pending-Karte übernehmen (falls baubar) + melden. */
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
  open, card, candidates, language, pendingCard, onPick, onNotInCatalog, onClose,
}: Props) {
  const english = language === 'en';

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

  // Dt. Art-Name je Dex-Nr. aus den Treffern selbst ableiten: Karten MIT DE-Namen
  // (catalogCardToInfo → `name`=DE, `nameEn` gesetzt) liefern die Übersetzung für
  // englisch-only-Auflagen derselben Art (z.B. „Greninja" → „Quajutsu"). So steht
  // überall derselbe deutsche Name, auch wenn eine Auflage keinen DE-Namen hat.
  const dexDe = new Map<number, string>();
  for (const it of items) {
    if (it.info.nameEn && it.info.nationalDexNumber != null && !dexDe.has(it.info.nationalDexNumber)) {
      dexDe.set(it.info.nationalDexNumber, it.info.name);
    }
  }
  const deName = (info: CardInfo): string =>
    info.nameEn ? info.name : (info.nationalDexNumber != null ? dexDe.get(info.nationalDexNumber) : undefined) ?? info.name;
  // Anzeige-Name je erkannter Sprache: englische Karte → englischer Name (Bilder
  // sind via `language` ohnehin schon englisch), sonst der einheitliche DE-Name.
  const displayName = (info: CardInfo): string =>
    english ? (info.nameEn ?? info.name) : deName(info);

  // Set-Symbol + Logo (DE) + Code + Gesamtzahl für die Treffer nachladen.
  useEffect(() => {
    const ids = [...new Set(items.map(i => i.info.setId).filter(Boolean))];
    const missing = ids.filter(id => !setBadges.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map(async id => {
      const s = await getSetById(id).catch(() => null);
      return [id, {
        symbolUrl: s?.symbolUrl,
        logoUrl: s?.logoUrl || s?.logoUrlEn || undefined,
        nameDe: s?.nameDe ?? s?.name ?? id,
        code: s?.ptcgoCode,
        printedTotal: s?.printedTotal,
      }] as const;
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
        ) : (items.length === 0 && !pendingCard) ? (
          <div className="text-center py-8 text-sm text-white/50">
            {searchResults ? 'Keine Karten gefunden.' : 'Tippe den Namen der richtigen Karte ein.'}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1 items-stretch">
            {/* „Nicht im Katalog"-Erstkarte: übernimmt die aus dem Scan gebaute
                Pending-Karte → danach normal „Hinzufügen". */}
            {pendingCard && (
              <button
                onClick={onNotInCatalog}
                className="shrink-0 w-[150px] rounded-2xl p-2 text-center"
                style={{ border: '1.5px dashed #f4c542', background: 'rgba(244,197,66,0.06)' }}
                aria-label="Nicht im Katalog — als neue Karte aufnehmen"
              >
                <div className="w-full aspect-[5/7] rounded-lg flex flex-col items-center justify-center gap-1.5" style={{ border: '1.5px dashed rgba(244,197,66,0.45)' }}>
                  <FilePlus size={26} color="#f4c542" />
                  <span className="text-[11px] font-semibold" style={{ color: '#f4c542' }}>Nicht im Katalog</span>
                </div>
                <div className="mt-2 text-[13px] font-semibold leading-tight text-white truncate">{pendingCard.name}</div>
                <div className="mt-1.5 text-[11px] text-white/60 leading-tight">Als neue Karte aufnehmen</div>
                <div className="mt-1 text-[11px] text-white/45 font-mono tabular-nums truncate">
                  {pendingCard.setCode && <span className="text-white/45">{pendingCard.setCode} · </span>}
                  {printedNumber(pendingCard.number, pendingCard.printedTotal)}
                </div>
              </button>
            )}
            {items.map(it => {
              const badge = setBadges.get(it.info.setId);
              const isCand = it.group === 'cand';
              return (
                <button
                  key={it.info.id}
                  onClick={() => onPick(it.info.id)}
                  className="shrink-0 w-[150px] rounded-2xl p-2 text-center"
                  style={{ border: isCand ? '1.5px solid #f4c542' : '1.5px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.04)' }}
                  aria-label={`${displayName(it.info)} ${badge?.code ?? it.info.setId} ${printedNumber(it.info.number, badge?.printedTotal)}`}
                >
                  <div className="relative">
                    {isCand && (
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 px-2 py-0.5 rounded-md text-[9px] font-bold" style={{ background: '#f4c542', color: '#3a2c00' }}>Kandidat</span>
                    )}
                    <CardImage card={it.info} size="small" language={language} alt={displayName(it.info)} width={150} height={210} className="w-full aspect-[5/7] rounded-lg object-cover" />
                  </div>

                  <div className="mt-2 text-[13px] font-semibold leading-tight text-white truncate">{displayName(it.info)}</div>

                  {/* Set-Identität: Logo (DE) wenn vorhanden, sonst Symbol + Name. */}
                  <div className="mt-1.5 h-5 flex items-center justify-center gap-1.5">
                    {badge?.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={badge.logoUrl} alt={badge.nameDe} className="h-5 max-w-full object-contain" />
                    ) : (
                      <>
                        {badge?.symbolUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={badge.symbolUrl} alt="" className="w-4 h-4 object-contain shrink-0" />
                        )}
                        <span className="text-[11px] text-white/65 truncate">{badge?.nameDe ?? it.info.setName}</span>
                      </>
                    )}
                  </div>

                  {/* Set-Kürzel + aufgedruckte Nummer (022/025 bzw. Promo XY133). */}
                  <div className="mt-1 text-[11px] text-white/55 font-mono tabular-nums truncate">
                    {badge?.code && <span className="text-white/45">{badge.code} · </span>}
                    {printedNumber(it.info.number, badge?.printedTotal)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Fallback-Button nur, wenn keine Pending-Karte baubar ist (Scan zu dünn) —
          sonst übernimmt die „Nicht im Katalog"-Erstkarte im Slider diese Rolle. */}
      {!pendingCard && (
        <div className="shrink-0 px-4 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <Button
            variant="secondary"
            className="w-full"
            icon={<Flag size={16} />}
            onClick={onNotInCatalog}
          >
            Nicht im Katalog
          </Button>
        </div>
      )}
    </div>
  );
}
