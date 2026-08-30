'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Pencil, Check, AlertTriangle, Layers, MoreVertical, Sparkles } from 'lucide-react';
import { getDeck, setDeckCardCount, addCardToDeck } from '@/lib/firestore/decks';
import { getAllSets } from '@/lib/firestore/sets';
import { syncDeckWishlists } from '@/lib/decks/sync';
import { getCatalogCardsByIds, getCardsByEvolutionFamily, type CatalogCard } from '@/lib/firestore/catalog';
import { getCards } from '@/lib/firestore/cards';
import { getBinders } from '@/lib/firestore/binders';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { validateDeck, isCardLegal } from '@/lib/decks/rules';
import { groupDeckRows, type DeckGroup } from '@/lib/decks/group';
import { computeDeckDemand, type DeckDemand } from '@/lib/decks/demand';
import { computeDeckStats } from '@/lib/decks/stats';
import { CardImage } from '@/components/card/CardImage';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { EnergyIcon, type EnergyType } from '@/components/ui/EnergyIcon';
import { CreateDeckModal } from '@/components/deck/CreateDeckModal';
import { DeckCardSearchSheet } from '@/components/deck/DeckCardSearchSheet';
import { DeckStats } from '@/components/deck/DeckStats';
import { TestHandSheet } from '@/components/deck/TestHandSheet';
import { DeckCodeSheet } from '@/components/deck/DeckCodeSheet';
import { DeckSuggestionsSheet } from '@/components/deck/DeckSuggestionsSheet';
import { AiDeckBuilderSheet } from '@/components/deck/AiDeckBuilderSheet';
import { Button } from '@/components/ui/button';
import { Menu } from '@/components/ui/menu';
import { Stepper } from '@/components/ui/stepper';
import { Collapsible } from '@/components/ui/collapsible';
import { formatCardNumber, formatEUR } from '@/lib/format';
import type { DeckDoc, DeckCardRef, CardDoc } from '@/types';

const FORMAT_LABEL: Record<string, string> = { standard: 'Standard', expanded: 'Expanded', unlimited: 'Unlimited' };
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'Pokémon', label: 'Pokémon' },
  { key: 'Trainer', label: 'Trainer' },
  { key: 'Energy',  label: 'Energie' },
];

// Evolutionsstufe → Badge (Farbcodierung: Basis grün / Ph.1 blau / Ph.2 lila).
// `color` = voller Pill-Hintergrund (Text darauf weiß) UND Farbe der
// Stufenzähler-Ziffern; mittelkräftige Töne, damit sie in Light UND Dark lesbar
// sind.
const STAGE_STYLE: Record<'Basic' | 'Stage 1' | 'Stage 2', { label: string; color: string }> = {
  'Basic':   { label: 'Basis',   color: '#3f9e2c' },
  'Stage 1': { label: 'Phase 1', color: '#3182ce' },
  'Stage 2': { label: 'Phase 2', color: '#7a5cd8' },
};
function stageKey(card?: CatalogCard): keyof typeof STAGE_STYLE | null {
  if (!card || card.supertype !== 'Pokémon') return null;
  if (card.subtypes?.includes('Stage 2')) return 'Stage 2';
  if (card.subtypes?.includes('Stage 1')) return 'Stage 1';
  if (card.subtypes?.includes('Basic')) return 'Basic';
  return null;
}
const stageRank = (card?: CatalogCard) => { const s = stageKey(card); return s === 'Basic' ? 0 : s === 'Stage 1' ? 1 : s === 'Stage 2' ? 2 : 3; };

/** Eine Evolutionslinie (oder ein Einzel-Pokémon) im Deck. */
interface PokemonLine { key: string; header: string | null; counts: number[]; groups: DeckGroup[]; }

// Empfohlene Anzahl je Stufe (Best Practice, Nutzer kann per Stepper anpassen).
const RECOMMENDED_COUNT = [4, 2, 3];   // Basis / Phase 1 / Phase 2

/** Fehlende Stufe einer Linie (Inline-Vorschlag) mit empfohlener Anzahl +
 *  Besitz in „Unsortiert". */
interface GapItem { dex: number; rank: number; stageLabel: string; card: CatalogCard | null; name: string; recommended: number; owned: number; }

/** Gruppiert Pokémon-Zeilen nach ECHTER Evolutionslinie (gemeinsame
 *  evolutionFamily, nur Kettenglieder), sortiert innerhalb nach Stufe. Linien
 *  mit ≥2 Gliedern bekommen einen Kopf (höchste Stufe + „4–0–2"-Zähler);
 *  Einzel-/eigenständige Pokémon laufen ohne Kopf (nach Name). */
function groupPokemonLines(groups: DeckGroup[], byId: Map<string, CatalogCard>): PokemonLine[] {
  // Pass 1: dex → Familien-Key aus allen Karten, die eine echte (mehrstufige)
  // Familie tragen — damit Karten OHNE eigene Familie (z.B. Promos) über ihre
  // Dex-Nummer der passenden Linie zugeordnet werden können.
  const dexToFamily = new Map<number, string>();
  const familyDex = new Map<string, number[]>();
  for (const g of groups) {
    const fam = byId.get(g.primary.catalogId)?.evolutionFamily;
    if (fam && fam.length > 1) {
      const dex = [...new Set(fam)].sort((a, b) => a - b);
      const key = 'fam:' + dex.join('-');
      familyDex.set(key, dex);
      for (const d of dex) if (!dexToFamily.has(d)) dexToFamily.set(d, key);
    }
  }

  const chainBuckets = new Map<string, DeckGroup[]>();
  const singles: DeckGroup[] = [];
  for (const g of groups) {
    const card = byId.get(g.primary.catalogId);
    const ownFam = card?.evolutionFamily;
    const famKey = ownFam && ownFam.length > 1
      ? 'fam:' + [...new Set(ownFam)].sort((a, b) => a - b).join('-')
      : (card?.nationalDexNumber != null ? dexToFamily.get(card.nationalDexNumber) : undefined);
    const s = stageKey(card);
    // Kettenglied: Stufe 1/2 immer (sofern eine Linie gefunden); Basis nur als
    // Wurzel (niedrigste Dex-Nummer der Familie).
    let inChain = false;
    if (famKey) {
      const dexArr = familyDex.get(famKey)!;
      if (s === 'Stage 1' || s === 'Stage 2') inChain = true;
      else if (s === 'Basic' && card?.nationalDexNumber === Math.min(...dexArr)) inChain = true;
    }
    if (inChain && famKey) {
      (chainBuckets.get(famKey) ?? chainBuckets.set(famKey, []).get(famKey)!).push(g);
    } else {
      singles.push(g);
    }
  }

  const lines: PokemonLine[] = [];
  for (const [key, gs] of chainBuckets) {
    // Auch eine einzelne Kettenkarte (z.B. nur die Basis) ist eine Linie —
    // dann werden die fehlenden Stufen inline vorgeschlagen (manueller Aufbau).
    gs.sort((a, b) => {
      const r = stageRank(byId.get(a.primary.catalogId)) - stageRank(byId.get(b.primary.catalogId));
      return r !== 0 ? r : a.displayName.localeCompare(b.displayName, 'de');
    });
    const counts: number[] = [0, 0, 0];
    for (const g of gs) { const r = stageRank(byId.get(g.primary.catalogId)); if (r <= 2) counts[r] += g.total; }
    const rep = gs.reduce((best, g) => stageRank(byId.get(g.primary.catalogId)) >= stageRank(byId.get(best.primary.catalogId)) ? g : best);
    lines.push({ key, header: rep.displayName, counts, groups: gs });
  }
  for (const g of singles) lines.push({ key: 'single:' + g.key, header: null, counts: [0, 0, 0], groups: [g] });

  lines.sort((a, b) => {
    if (!!a.header !== !!b.header) return a.header ? -1 : 1;   // Ketten-Linien vor Einzelkarten
    return (a.header ?? a.groups[0].displayName).localeCompare(b.header ?? b.groups[0].displayName, 'de');
  });
  return lines;
}

export default function DeckEditorPage() {
  const params = useParams();
  const id = String(params.id);

  const [deck, setDeck] = useState<DeckDoc | null>(null);
  const [byId, setById] = useState<Map<string, CatalogCard>>(new Map());
  const [owned, setOwned] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [testHandOpen, setTestHandOpen] = useState(false);
  const [detailCard, setDetailCard] = useState<CardInfo | null>(null);
  // Fehlende Stufen je Linie (Inline-Vorschlag): lineKey → Kandidaten.
  const [lineGaps, setLineGaps] = useState<Map<string, GapItem[]>>(new Map());
  // Besitz in „Unsortiert" (lose Karten) je tcgId — für „besitzt X / fehlt M".
  const [looseOwned, setLooseOwned] = useState<Map<string, number>>(new Map());
  const [codeSheet, setCodeSheet] = useState<null | 'export' | 'import'>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const loadDeck = async () => {
    try {
      const d = await getDeck(id);
      setDeck(d);
      const ids = d?.cards.map(c => c.catalogId) ?? [];
      if (ids.length) {
        const cs = await getCatalogCardsByIds(ids);
        setById(new Map(cs.map(c => [c.id, c])));
      } else {
        setById(new Map());
      }
    } catch (e) {
      console.error('[deck] load error', e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadDeck(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => { getCards().then(setOwned).catch(() => {}); }, []);

  // Lose Karten in „Unsortiert" (Default-Binder) je tcgId zählen.
  useEffect(() => {
    (async () => {
      const [cards, binders] = await Promise.all([getCards(), getBinders()]);
      const looseIds = new Set(binders.find(b => b.isDefault)?.cardIds ?? []);
      const m = new Map<string, number>();
      for (const c of cards) if (c.tcgId && looseIds.has(c.id)) m.set(c.tcgId, (m.get(c.tcgId) ?? 0) + (c.quantity ?? 1));
      setLooseOwned(m);
    })().catch(() => {});
  }, []);

  // Fehlende Stufen je Evolutionslinie ermitteln (ALLE Stufen der Familie, die
  // im Deck fehlen — beim manuellen Aufbau schlägt eine Basis so ihre Phase 1/2
  // vor). Kandidaten: bevorzugt eine besessene Auflage aus „Unsortiert", sonst
  // eine format-legale Katalogkarte. Empfohlene Anzahl + Besitz mitliefern.
  useEffect(() => {
    if (!deck || byId.size === 0) return;
    let cancelled = false;
    (async () => {
      const refs = deck.cards.filter(c => (byId.get(c.catalogId)?.supertype ?? c.supertype) === 'Pokémon');
      const lines = groupPokemonLines(groupDeckRows(refs, byId), byId).filter(l => l.header);
      const map = new Map<string, GapItem[]>();
      for (const line of lines) {
        if (!line.key.startsWith('fam:')) continue;
        const dexArr = line.key.slice(4).split('-').map(Number);
        const present = new Set(line.groups.map(g => byId.get(g.primary.catalogId)?.nationalDexNumber).filter((d): d is number => d != null));
        const gapDex = dexArr.filter(d => !present.has(d));   // ALLE fehlenden Stufen der Familie
        const items: GapItem[] = [];
        for (const d of gapDex) {
          const rank = dexArr.indexOf(d);
          const wantStage = rank === 0 ? 'Basic' : rank === dexArr.length - 1 ? 'Stage 2' : 'Stage 1';
          let cands: CatalogCard[] = [];
          try { cands = await getCardsByEvolutionFamily(d); } catch { /* skip */ }
          const legal = cands.filter(c => c.nationalDexNumber === d && c.subtypes?.includes(wantStage) && isCardLegal(c, deck.format));
          const pool = legal.length ? legal : cands.filter(c => c.nationalDexNumber === d && isCardLegal(c, deck.format));
          // Bevorzugt eine in „Unsortiert" besessene Auflage.
          const pick = pool.find(c => (looseOwned.get(c.id) ?? 0) > 0) ?? pool[0] ?? null;
          items.push({
            dex: d, rank, stageLabel: STAGE_STYLE[wantStage].label, card: pick,
            name: pick?.nameDe ?? pick?.name ?? `#${d}`,
            recommended: RECOMMENDED_COUNT[Math.min(rank, 2)],
            owned: pick ? (looseOwned.get(pick.id) ?? 0) : 0,
          });
        }
        if (items.length) map.set(line.key, items);
      }
      if (!cancelled) setLineGaps(map);
    })();
    return () => { cancelled = true; };
  }, [deck, byId, looseOwned]);

  // Bedarfs-Wunschliste des Decks im Hintergrund synchron halten: einmal beim
  // Öffnen (falls sich Besitz/Katalog seit dem letzten Mal geändert hat) und
  // nach jeder Rezept-Mutation. Fire-and-forget — hält die UI schnell.
  const syncDemand = () => { syncDeckWishlists({ deckIds: [id] }).catch(e => console.error('[deck] demand sync', e)); };
  useEffect(() => { syncDemand(); /* eslint-disable-next-line */ }, [id]);

  const validation = useMemo(() => deck ? validateDeck(deck.cards, byId, deck.format) : null, [deck, byId]);
  const demand: DeckDemand | null = useMemo(() => deck ? computeDeckDemand(deck.cards, byId, owned) : null, [deck, byId, owned]);
  const stats = useMemo(() => deck ? computeDeckStats(deck.cards, byId) : null, [deck, byId]);
  const counts = useMemo(() => new Map((deck?.cards ?? []).map(c => [c.catalogId, c.count])), [deck]);
  const ownedTcgIds = useMemo(() => new Set(owned.map(c => c.tcgId).filter((t): t is string => !!t)), [owned]);

  const changeCount = async (catalogId: string, count: number) => {
    if (!deck) return;
    await setDeckCardCount(deck.id, catalogId, count);
    await loadDeck();
    syncDemand();
  };
  // Gruppen-Stepper (dieselbe Karte über mehrere Drucke/Sprachen = eine Zeile):
  // + erhöht den „Haupt"-Druck; − reduziert zuerst den kleinsten Druck, sodass
  // ein versehentlicher Zweit-Druck (EN/DE-Mix) beim Runterzählen verschwindet.
  // Klick aufs Kartenbild → Kartendetail (mit den besessenen Exemplaren).
  const openDetail = (catalogId: string) => {
    const c = byId.get(catalogId);
    if (c) setDetailCard(catalogCardToInfo(c));
  };
  const incGroup = (g: DeckGroup) => changeCount(g.primary.catalogId, g.primary.count + 1);
  const decGroup = (g: DeckGroup) => {
    const target = [...g.prints].filter(p => p.count > 0).sort((a, b) => a.count - b.count)[0];
    if (target) changeCount(target.catalogId, target.count - 1);
  };
  const addCard = async (card: CardInfo) => {
    if (!deck) return;
    await addCardToDeck(deck.id, card, 1);
    await loadDeck();
    syncDemand();
  };

  // PTCGL-Import: aufgelöste Karten mit ihrer Anzahl ins Deck übernehmen (merge).
  const importResolved = async (resolved: { card: CatalogCard; count: number }[]) => {
    if (!deck) return;
    for (const r of resolved) await addCardToDeck(deck.id, catalogCardToInfo(r.card), r.count);
    await loadDeck();
    syncDemand();
  };

  // Einzelnen Katalog-Vorschlag ins Deck übernehmen.
  const addCatalogCard = async (card: CatalogCard, count: number) => {
    if (!deck) return;
    await addCardToDeck(deck.id, catalogCardToInfo(card), count);
    await loadDeck();
    syncDemand();
  };

  const exportPdf = async () => {
    if (!deck || exportingPdf) return;
    setExportingPdf(true);
    try {
      // Deutsche Set-Namen + gedruckte Nummer frisch auflösen (wie im Wunschlisten-PDF).
      const allSets = await getAllSets();
      const setById = new Map(allSets.map(s => [s.id, s]));
      const sections = CATEGORIES.map(cat => {
        const rows = deck.cards
          .filter(c => (byId.get(c.catalogId)?.supertype ?? c.supertype) === cat.key)
          .sort((a, b) => a.name.localeCompare(b.name, 'de'))
          .map(ref => {
            const c = byId.get(ref.catalogId);
            const own = demand?.perCard.get(ref.catalogId);
            const sid = c?.setId ?? ref.setId;
            const s = setById.get(sid);
            const total = s?.printedTotal;
            return {
              count: ref.count,
              name: c?.nameDe ?? c?.name ?? ref.name,
              setName: s?.nameDe ?? s?.name ?? sid,
              number: formatCardNumber(c?.number ?? ref.number, total),
              owned: own?.isBasicEnergy ? 'Basis-Energie' : own ? `${own.owned}/${own.need}` : '',
              price: (c?.priceEur ?? 0) > 0 ? formatEUR((c!.priceEur ?? 0) * ref.count) : '',
            };
          });
        const catTotal = rows.reduce((s, r) => s + r.count, 0);
        return { title: `${cat.label} · ${catTotal}`, rows };
      }).filter(sec => sec.rows.length > 0);

      const total = deck.cards.reduce((s, c) => s + c.count, 0);
      const subtitle = `${FORMAT_LABEL[deck.format] ?? deck.format} · ${total}/60 · ${formatEUR(valueEur)}`;
      const dateStr = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });

      const { downloadDeckPdf } = await import('@/components/deck/deck-pdf');
      await downloadDeckPdf({ title: deck.name, subtitle, dateStr, sections });
    } catch (e) {
      console.error('[deck] PDF export error', e);
    } finally {
      setExportingPdf(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center pt-16"><div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (!deck) {
    return <div className="p-6 text-center text-muted-foreground"><p>Deck nicht gefunden.</p><Button variant="ghost" href="/decks" className="mt-3">Zurück zu Decks</Button></div>;
  }

  const valueEur = deck.cards.reduce((s, c) => s + (byId.get(c.catalogId)?.priceEur ?? 0) * c.count, 0);

  return (
    <div className="px-4 pt-safe pb-28">
      {/* Header */}
      {/* Header-Panel (Glas): Zurück + Aktionen · Infos/Status · Statistik */}
      <div className="glass rounded-[20px] px-4 pt-2 pb-3 mb-4 flex flex-col gap-2.5">
        {/* Zurück + Aktionen */}
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" href="/decks" className="-ml-2 shrink-0">‹ Decks</Button>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="secondary" onClick={() => setEditOpen(true)} icon={<Pencil size={18} />} aria-label="Deck bearbeiten" />
            <Menu
              portal
              trigger={(open, toggle) => (
                <Button variant="secondary" onClick={toggle} icon={<MoreVertical size={18} />} aria-label="Mehr" aria-expanded={open} />
              )}
              items={[
                { label: 'KI-Deck erstellen', onClick: () => setAiOpen(true) },
                { label: 'Als Code exportieren', onClick: () => setCodeSheet('export') },
                { label: 'Code importieren', onClick: () => setCodeSheet('import') },
                { label: exportingPdf ? 'PDF wird erstellt …' : 'Als PDF', onClick: exportPdf, disabled: exportingPdf || deck.cards.length === 0 },
              ]}
            />
          </div>
        </div>

        {/* Name + Infos/Status */}
        <div className="min-w-0">
          <h1 className="text-role-h1 text-glass truncate">{deck.name}</h1>
          {validation && (
            <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-role-label mt-0.5">
              <span className="font-semibold tabular-nums">{validation.totalCount}/60</span>
              <span className="text-muted-foreground">· {FORMAT_LABEL[deck.format] ?? deck.format}</span>
              <span className="text-muted-foreground">· {formatEUR(valueEur)}</span>
              {validation.valid ? (
                <span className="inline-flex items-center gap-1 font-semibold" style={{ color: '#2f855a' }}><Check size={14} /> Spielbar</span>
              ) : (
                (() => {
                  const n = validation.issues.filter(i => i.severity === 'block').length;
                  return <span className="inline-flex items-center gap-1 font-semibold text-[#c53030] dark:text-[#ef9a9a]"><AlertTriangle size={13} /> {n} {n === 1 ? 'Problem' : 'Probleme'}</span>;
                })()
              )}
            </div>
          )}
          {validation && !validation.valid && (
            <div className="mt-1 flex flex-col gap-0.5">
              {validation.issues.map((iss, i) => (
                <div key={i} className={`text-role-label ${iss.severity === 'block' ? 'text-[#c53030] dark:text-[#ef9a9a]' : 'text-[#b7791f] dark:text-[#e2b464]'}`}>• {iss.message}</div>
              ))}
            </div>
          )}
        </div>

        {/* Statistik (einklappbar, im Panel eingebettet) */}
        {stats && deck.cards.length > 0 && <DeckStats stats={stats} bare />}
      </div>

      {/* Testhand + Vorschläge */}
      {deck.cards.length > 0 && (
        <div className="flex gap-2 mb-4">
          <Button variant="secondary" size="lg" onClick={() => setTestHandOpen(true)} icon={<Layers size={18} />} className="flex-1">
            Testhand
          </Button>
          <Button variant="secondary" size="lg" onClick={() => setSuggestOpen(true)} icon={<Sparkles size={18} />} className="flex-1">
            Vorschläge
          </Button>
        </div>
      )}

      {/* Kategorie-Sektionen */}
      {deck.cards.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <p>Noch keine Karten. Füge über „+ Karte" welche hinzu.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {CATEGORIES.map(cat => {
            const refs = deck.cards.filter(c => (byId.get(c.catalogId)?.supertype ?? c.supertype) === cat.key);
            const groups = groupDeckRows(refs, byId).sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'));
            if (groups.length === 0) return null;
            const catTotal = groups.reduce((s, g) => s + g.total, 0);
            return (
              <Collapsible
                key={cat.key}
                title={cat.label}
                right={<span className="text-sm font-bold tabular-nums text-muted-foreground">{catTotal}</span>}
              >
                {cat.key === 'Pokémon' ? (
                  (() => {
                    const pokeLines = groupPokemonLines(groups, byId);
                    const chains = pokeLines.filter(l => l.header);
                    const solos = pokeLines.filter(l => !l.header);
                    return (
                      <div className="flex flex-col gap-4">
                        {/* Evolutionslinien: Kettenglieder nach Stufe eingerückt, Lücken inline */}
                        {chains.map(line => {
                          const rows = [
                            ...line.groups.map(g => ({ kind: 'card' as const, rank: stageRank(byId.get(g.primary.catalogId)), g })),
                            ...(lineGaps.get(line.key) ?? []).map(gap => ({ kind: 'gap' as const, rank: gap.rank, gap })),
                          ].sort((a, b) => a.rank - b.rank);
                          return (
                            <div key={line.key}>
                              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                                <span className="text-role-label font-bold text-glass truncate">{line.header}-Linie</span>
                                <span className="text-role-label font-bold tabular-nums shrink-0 flex items-center gap-0.5">
                                  <span style={{ color: STAGE_STYLE['Basic'].color }}>{line.counts[0]}</span>
                                  <span className="text-muted-foreground">–</span>
                                  <span style={{ color: STAGE_STYLE['Stage 1'].color }}>{line.counts[1]}</span>
                                  <span className="text-muted-foreground">–</span>
                                  <span style={{ color: STAGE_STYLE['Stage 2'].color }}>{line.counts[2]}</span>
                                </span>
                              </div>
                              {/* Innerhalb der Linie KEINE Trennlinien — die Einrückung
                                  strukturiert bereits; nur Abstand zwischen den Stufen. */}
                              <div className="flex flex-col gap-2.5">
                                {rows.map(r => (
                                  <div key={r.kind === 'card' ? r.g.key : 'gap' + r.gap.dex} style={{ paddingLeft: r.rank * 14 }}>
                                    {r.kind === 'card'
                                      ? <DeckRow group={r.g} card={byId.get(r.g.primary.catalogId)} demand={demand} onInc={() => incGroup(r.g)} onDec={() => decGroup(r.g)} onOpenDetail={() => openDetail(r.g.primary.catalogId)} />
                                      : <GapRow gap={r.gap} onAdd={(n) => r.gap.card && addCatalogCard(r.gap.card, n)} onOpenDetail={() => r.gap.card && setDetailCard(catalogCardToInfo(r.gap.card))} />}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}

                        {/* Eigenständige Pokémon (V/ex/GX/Radiant) — klar abgetrennt */}
                        {solos.length > 0 && (
                          <div>
                            {chains.length > 0 && (
                              <div className="text-role-label font-bold uppercase tracking-wide text-muted-foreground px-1 pb-1">Einzelne Pokémon</div>
                            )}
                            <div className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
                              {solos.map(l => (
                                <div key={l.groups[0].key} className="py-2 first:pt-0 last:pb-0">
                                  <DeckRow group={l.groups[0]} card={byId.get(l.groups[0].primary.catalogId)} demand={demand} onInc={() => incGroup(l.groups[0])} onDec={() => decGroup(l.groups[0])} onOpenDetail={() => openDetail(l.groups[0].primary.catalogId)} />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
                    {groups.map(g => (
                      <div key={g.key} className="py-2 first:pt-0 last:pb-0">
                        <DeckRow group={g} card={byId.get(g.primary.catalogId)} demand={demand} onInc={() => incGroup(g)} onDec={() => decGroup(g)} onOpenDetail={() => openDetail(g.primary.catalogId)} />
                      </div>
                    ))}
                  </div>
                )}
              </Collapsible>
            );
          })}
        </div>
      )}

      {/* Floating „+ Karte" */}
      <Button
        variant="primary"
        accentColor="#2f855a"
        size="lg"
        onClick={() => setSearchOpen(true)}
        icon={<Plus strokeWidth={2.6} />}
        className="fixed left-1/2 -translate-x-1/2 z-30 shadow-lg"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)' }}
      >
        Karte
      </Button>

      <DeckCardSearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        counts={counts}
        ownedTcgIds={ownedTcgIds}
        onAdd={addCard}
        onSetCount={changeCount}
      />
      {editOpen && (
        <CreateDeckModal existing={deck} onClose={() => setEditOpen(false)} onSaved={loadDeck} />
      )}
      <TestHandSheet open={testHandOpen} onClose={() => setTestHandOpen(false)} cards={deck.cards} byId={byId} />
      {detailCard && (
        <CardDetailSheet
          card={detailCard}
          ownedCopies={owned.filter(c => c.tcgId === detailCard.id)}
          onClose={() => setDetailCard(null)}
          onSaved={() => { getCards().then(setOwned).catch(() => {}); }}
        />
      )}
      <DeckCodeSheet
        open={codeSheet !== null}
        onClose={() => setCodeSheet(null)}
        mode={codeSheet ?? 'export'}
        cards={deck.cards}
        byId={byId}
        onImport={importResolved}
      />
      <DeckSuggestionsSheet
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        cards={deck.cards}
        byId={byId}
        owned={owned}
        format={deck.format}
        onAdd={addCatalogCard}
      />
      <AiDeckBuilderSheet
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        deck={deck}
        onApplied={() => { loadDeck(); syncDemand(); }}
      />
    </div>
  );
}

function DeckRow({ group, card, demand, onInc, onDec, onOpenDetail }: {
  group: DeckGroup;
  card: CatalogCard | undefined;
  demand: DeckDemand | null;
  onInc: () => void;
  onDec: () => void;
  onOpenDetail: () => void;
}) {
  const info: CardInfo = card
    ? catalogCardToInfo(card)
    : { id: group.primary.catalogId, name: group.displayName, number: group.primary.number, setId: group.primary.setId, supertype: group.primary.supertype, imgSmall: '', imgLarge: '' } as CardInfo;
  // Besitz/Bedarf über alle Drucke der Gruppe summieren.
  let need = 0, owned = 0, isBasicEnergy = false, hasOwn = false;
  for (const p of group.prints) {
    const o = demand?.perCard.get(p.catalogId);
    if (!o) continue;
    hasOwn = true; need += o.need; owned += o.owned; isBasicEnergy = isBasicEnergy || o.isBasicEnergy;
  }
  const missing = !isBasicEnergy && hasOwn ? Math.max(0, need - owned) : 0;
  const isPokemon = (card?.supertype ?? info.supertype) === 'Pokémon';
  const sk = stageKey(card);
  const stage = sk ? STAGE_STYLE[sk] : null;
  const retreat = isPokemon ? card?.retreat ?? null : null;

  return (
    <div className="flex items-start gap-3">
      {/* Klickbares Kartenbild → Kartendetail */}
      <button onClick={onOpenDetail} className="w-11 shrink-0 mt-0.5 rounded active:scale-95 transition-transform" aria-label={`${group.displayName} – Kartendetail`}>
        <CardImage card={info} size="small" alt={group.displayName} width={63} height={88} className="w-full rounded" />
      </button>

      {/* Mitte: Name/Stufe/Attacken links, Zahlen (KP/Schaden) rechtsbündig */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-semibold truncate">{group.displayName}</span>
            {stage && (
              <span className="text-[10px] font-bold px-1.5 py-px rounded shrink-0 text-white" style={{ background: stage.color }}>{stage.label}</span>
            )}
          </span>
          {isPokemon && card?.hp != null && (
            <span className="text-role-label font-semibold text-muted-foreground shrink-0 tabular-nums">{card.hp} KP</span>
          )}
        </div>

        {isPokemon && card?.attacks?.map((at, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-role-label mt-0.5">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="flex items-center gap-0.5 shrink-0">
                {(at.cost ?? []).length
                  ? (at.cost ?? []).map((c, j) => <EnergyIcon key={j} type={c as EnergyType} size={13} />)
                  : <span className="text-muted-foreground">—</span>}
              </span>
              <span className="truncate">{at.name}</span>
            </span>
            {at.damage && <span className="font-semibold tabular-nums shrink-0">{at.damage}</span>}
          </div>
        ))}

        {(retreat != null || isBasicEnergy) && (
          <p className="truncate text-role-label text-muted-foreground mt-0.5 flex items-center gap-1">
            {retreat != null && (
              <span className="flex items-center gap-0.5 shrink-0">
                Rückzug {Array.from({ length: retreat }).map((_, j) => <EnergyIcon key={j} type="Colorless" size={12} />)}
              </span>
            )}
            {isBasicEnergy && <span className="truncate">Basis-Energie</span>}
          </p>
        )}
      </div>

      {/* Rechts: Stepper allein + fehlende Anzahl in Rot darunter */}
      <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
        <Stepper value={group.total} onDec={onDec} onInc={onInc} />
        {missing > 0 && (
          <span className="text-[11px] font-bold text-[#c53030] dark:text-[#ef9a9a]">fehlt {missing}</span>
        )}
      </div>
    </div>
  );
}

/** Inline-Vorschlag für eine fehlende Stufe der Linie: empfohlene Anzahl per
 *  Stepper wählbar (voll / weniger / nur besessene), zeigt Besitz aus
 *  „Unsortiert" + fehlende Anzahl. Bild öffnet das Detail. */
function GapRow({ gap, onAdd, onOpenDetail }: { gap: GapItem; onAdd: (count: number) => void; onOpenDetail: () => void }) {
  const [count, setCount] = useState(gap.recommended);
  const info = gap.card ? catalogCardToInfo(gap.card) : null;
  const stageColor = [STAGE_STYLE['Basic'], STAGE_STYLE['Stage 1'], STAGE_STYLE['Stage 2']][gap.rank]?.color ?? '#888';
  const missing = Math.max(0, count - gap.owned);
  return (
    <div className="flex items-start gap-3 rounded-xl py-1.5 pl-1" style={{ boxShadow: 'inset 2px 0 0 rgba(183,121,31,0.55)' }}>
      <button onClick={onOpenDetail} disabled={!gap.card} className="w-11 shrink-0 rounded active:scale-95 transition-transform" aria-label={`${gap.name} – Kartendetail`}>
        {info
          ? <CardImage card={info} size="small" alt={gap.name} width={63} height={88} className="w-full rounded opacity-80" />
          : <div className="w-full aspect-[63/88] rounded bg-black/10 dark:bg-white/10" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold truncate">{gap.name}</span>
          <span className="text-[10px] font-bold px-1.5 py-px rounded shrink-0 text-white" style={{ background: stageColor }}>{gap.stageLabel}</span>
        </div>
        <p className="text-role-label mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className="text-[#b7791f] dark:text-[#e2b464] font-semibold">Vorschlag</span>
          <span className="text-muted-foreground">· besitzt {gap.owned}</span>
          {missing > 0 && <span className="font-semibold text-[#c53030] dark:text-[#ef9a9a]">· fehlt {missing}</span>}
        </p>
      </div>
      <div className="flex flex-col items-center gap-1 shrink-0">
        <Stepper value={count} min={0} onDec={() => setCount(c => Math.max(0, c - 1))} onInc={() => setCount(c => c + 1)} />
        <button
          onClick={() => onAdd(count)}
          disabled={!gap.card || count < 1}
          className="h-7 px-3 rounded-full text-white text-[13px] font-semibold disabled:opacity-40 active:scale-95 transition-transform"
          style={{ background: '#2f855a' }}
        >
          Hinzufügen
        </button>
      </div>
    </div>
  );
}
