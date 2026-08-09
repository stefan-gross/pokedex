'use client';

import { useState, useEffect, useMemo, useRef, use, useCallback, createContext, useContext } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, Settings, LayoutGrid, BookOpen, FileText, Check,
  Plus, Minus, ChevronRight, ChevronDown, Info, MoreHorizontal, FileDown, Images,
  Pencil, Trash2,
} from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors,
  closestCenter, useDroppable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, arrayMove, rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getBinder, deleteBinderCascade, setBinderPages, cardIdsToPages,
  ensureDefaultBinder, addCardToBinder, addCardsToBinder, removeCardFromOtherBinders,
  setCardExclusiveBinder,
} from '@/lib/firestore/binders';
import { syncTemplateBinders } from '@/lib/template-binders/sync';
import { getCard, getCards } from '@/lib/firestore/cards';
import { getCatalogCardsByIds, type CatalogCard } from '@/lib/firestore/catalog';
import { resolveTemplateSlots } from '@/lib/template-binders/resolve';
import { resolveSlotWinners } from '@/lib/template-binders/slot-winner';
import { catalogCardToInfo, pendingCardInfo, ownedCardToInfo, type CardInfo } from '@/lib/card-info';
import { CreateBinderModal } from '@/components/binder/CreateBinderModal';
import { CollectionTypeBadge } from '@/components/binder/CollectionTypeBadge';
import { BinderIcon } from '@/lib/binder-icons';
import { binderSizeLabel, binderSizeCols, type BinderSize } from '@/lib/binder-sizes';
import {
  pagesToSheets, sheetsToPages, ensureEvenPages, pageLabel,
} from '@/lib/binder-sheets';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { CardImage } from '@/components/card/CardImage';
import { Card } from '@/components/card/Card';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Progress } from '@/components/ui/progress';
import { BinderSlotPickerModal } from '@/components/binder/BinderSlotPickerModal';
import { useTemplateGrid } from '@/components/binder/TemplateGridBrowser';
import { Grabber } from '@/components/ui/Grabber';
import { Menu } from '@/components/ui/menu';
import { useGrabberCollapse } from '@/lib/hooks/use-grabber-collapse';
import { ScrollToTopButton } from '@/components/ui/ScrollToTopButton';
import { Sheet } from '@/components/ui/modal';
import { useTotalValue } from '@/lib/hooks/use-total-value';
import { usePricesBatch } from '@/lib/hooks/use-prices-batch';
import { findVariantPrice, pickTrendPrice } from '@/lib/prices/value-tier';
import { VARIANT_LABELS, holoShimmerClass } from '@/lib/card-constants';
import { tintedGlassStyle } from '@/lib/ui/tinted-glass';
import { readableTextColor } from '@/lib/color-utils';
import { wiggleDelay } from '@/lib/utils';
import type { PriceResult } from '@/lib/prices/types';
import type { BinderDoc, BinderPage, CardDoc } from '@/types';

interface Props {
  params: Promise<{ id: string }>;
}

type View = 'binder' | 'page' | 'grid';

/** „i" mit diagonalem Strich = Zusatzinfos AUS. Lucide hat kein `InfoOff`,
 *  daher das Info-Icon mit einem currentColor-Strich überlagert. */
function InfoOffIcon({ size = 13 }: { size?: number }) {
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <Info size={size} />
      <span
        className="absolute bg-current rounded-full"
        style={{ width: size + 3, height: 1.5, transform: 'rotate(45deg)' }}
      />
    </span>
  );
}

/** Resolved Hintergrund-Farbe basierend auf Binder-Setting. */
const MILKY_BG = 'rgba(255, 255, 255, 0.55)';

const ADD_GLASS_STYLE    = tintedGlassStyle('#2f855a');
const DELETE_GLASS_STYLE = tintedGlassStyle('#c53030');

function resolvePageBg(setting: 'black' | 'white' | 'transparent' | undefined): string {
  switch (setting) {
    case 'white':       return '#f3f4f6';
    case 'transparent': return MILKY_BG;
    case 'black':
    default:            return '#1a1a1a';
  }
}

/** Hochkontrast-Textfarbe für einen Hintergrund. Nicht-Hex (rgba/milky) → dunkler Text. */
function readableText(bg: string): string {
  return readableTextColor(bg, '#1a1a1a');
}

/** Slot-Farben passend zum Seitenhintergrund. */
function slotColors(pageBg: string): { bg: string; border: string } {
  if (!pageBg?.startsWith('#')) {
    // milky / halbtransparent: dezent opaker Slot mit dunkler Border
    return { bg: 'rgba(255,255,255,0.6)', border: 'rgba(0,0,0,0.18)' };
  }
  const onDark = readableText(pageBg) === '#ffffff';
  const target = onDark ? 'white' : 'black';
  return {
    bg:     `color-mix(in srgb, ${pageBg} 86%, ${target} 14%)`,
    border: `color-mix(in srgb, ${pageBg} 65%, ${target} 35%)`,
  };
}

/** Katalog-Infos (per tcgId) der eigenen Karten dieser Sammlung — damit tief
 *  verschachtelte Blätter/Grids/Slots das LIVE-Bild aus dem Katalog auflösen
 *  (via ownedCardToInfo), statt einer eingefrorenen URL. Vom Seiten-Root
 *  bereitgestellt, von den Blatt-Komponenten per useContext konsumiert. */
const BinderCatalogCtx = createContext<Map<string, CardInfo>>(new Map());

export default function BinderDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [binder, setBinder] = useState<BinderDoc | null>(null);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const cardsById = useMemo(() => {
    const m = new Map<string, CardDoc>();
    for (const c of cards) m.set(c.id, c);
    return m;
  }, [cards]);
  const [pages, setPages] = useState<BinderPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [view, setView] = useState<View>('binder');
  const [pageIdx, setPageIdx] = useState<number>(0);
  const [editMode, setEditMode] = useState(false);
  // Bearbeiten-Modus (automatische Sammlungen): ausgewählte Karten (CardDoc-IDs)
  // zum Entfernen. Tipp wählt aus, „Entfernen" schickt sie zurück nach Unsortiert.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<{ pageIdx: number; slotIdx: number } | null>(null);
  const [detailCard, setDetailCard] = useState<CardInfo | null>(null);
  const [detailOwned, setDetailOwned] = useState<CardDoc[]>([]);
  // Fehlende Karten eines Vorlagen-Binders — Katalog-Platzhalter fürs exakt
  // richtige Slot (Key "pageIdx-slotIdx"), damit man wie in der Suche sieht,
  // welche Karte an dieser Stelle noch fehlt statt nur einer leeren Fläche.
  const [missingCards, setMissingCards] = useState<Map<string, CatalogCard>>(new Map());
  // Katalog-Infos der eigenen Karten (per tcgId) — Bild/Metadaten live aus dem
  // Katalog statt eingefrorenem CardDoc-Bild (siehe ownedCardToInfo).
  const [catalogInfoById, setCatalogInfoById] = useState<Map<string, CardInfo>>(new Map());
  // Fortschritt eines Vorlagen-Binders (besessene / gesamt Slots) — aus
  // derselben Auflösung wie `missingCards`, damit beide konsistent bleiben.
  const [templateProgress, setTemplateProgress] = useState<{ owned: number; total: number } | null>(null);
  const [showCardInfo, setShowCardInfo] = useState(false);

  const totalValue = useTotalValue(cards);
  // Preis pro Karte für die Grid-Ansicht — dieselbe Batch-Route wie überall,
  // liefert volle Varianten-Daten (Standard/Reverse Holo/…), Auflösung pro
  // Karte über `findVariantPrice` (identisch zu `useTotalValue`).
  const cardTcgIds = useMemo(() => {
    const ids = cards.map(c => c.tcgId).filter((x): x is string => !!x);
    // Vorlagen-Binder: zusätzlich die Katalog-Platzhalter fehlender Slots
    // mit einpreisen, für den "komplette Sammlung"-Wert unten im Header.
    const missingIds = Array.from(missingCards.values()).map(c => c.id);
    return Array.from(new Set([...ids, ...missingIds]));
  }, [cards, missingCards]);

  // Katalog-Infos der eigenen Karten laden (per tcgId) → Bild/Metadaten für
  // Grid/Blatt/Overlay. Läuft bei jeder Änderung von `cards`.
  useEffect(() => {
    const ids = [...new Set(cards.map(c => c.tcgId).filter((x): x is string => !!x))];
    // getCatalogCardsByIds([]) → [] → leere Map; setState nur async im then.
    getCatalogCardsByIds(ids)
      .then(ccs => setCatalogInfoById(new Map(ccs.map(cc => [cc.id, catalogCardToInfo(cc)]))))
      .catch(() => {});
  }, [cards]);
  const { prices: cardPrices } = usePricesBatch(cardTcgIds);
  // Preis-Summe der noch fehlenden Karten (ein Preis pro Platzhalter-Katalog-
  // eintrag, wie beim Preis-Sortieren auf der Set-Detailseite) — addiert auf
  // den bereits vorhandenen `totalValue.total` ergibt den Wert der KOMPLETTEN
  // (fertigen) Sammlung, nicht nur der schon besessenen Karten.
  const missingValue = useMemo(() => {
    let sum = 0;
    missingCards.forEach(cc => {
      const price = pickTrendPrice(cardPrices?.get(cc.id));
      if (price != null) sum += price;
    });
    return sum;
  }, [missingCards, cardPrices]);

  const binderSize = (binder?.size ?? 9) as BinderSize;
  const isBox = binder?.collectionType === 'box';

  const load = useCallback(async () => {
    try {
      // Binder + ALLE eigenen Karten in nur ZWEI Reads laden und die
      // enthaltenen Karten per Map auflösen — statt (früher) ein getDoc PRO
      // Karte (`Promise.all(cardIds.map(getCard))`, bei z.B. „Unsortiert" 100+
      // Einzel-Reads). Das war auf wackligem Netz langsam und konnte hängen; ein
      // fehlgeschlagener Read ließ zudem den Spinner ewig stehen (kein finally).
      const [b, allCards] = await Promise.all([getBinder(id), getCards()]);
      if (!b) { router.push('/binders'); return; }
      setBinder(b);
      const byId = new Map(allCards.map(c => [c.id, c]));
      const ownedCards = b.cardIds.map(cid => byId.get(cid)).filter(Boolean) as CardDoc[];
      setCards(ownedCards);
      const size = (b.size ?? 9) as BinderSize;
      const rawPages = b.pages && b.pages.length > 0 ? b.pages : cardIdsToPages(b.cardIds, size);
      // Pages immer gerade Anzahl — Sheets sind Vorder+Rück-Paare
      setPages(ensureEvenPages(rawPages, size));
      if (b.collectionType === 'box') setView('grid');
    } catch (e) {
      console.error('[binder] load error', e);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  // ── Bearbeiten-Modus (automatische Sammlungen): Karten entfernen ──────────
  const exitEditMode = useCallback(() => { setEditMode(false); setSelectedIds(new Set()); }, []);
  const toggleSelect = useCallback((cardId: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(cardId)) n.delete(cardId); else n.add(cardId);
      return n;
    });
  }, []);
  // Ausgewählte Karten aus der (Vorlagen-)Sammlung entfernen → zurück nach
  // „Unsortiert" (setCardExclusiveBinder: aus allen Bindern raus + in Default
  // rein), danach Template-Sync (leere Slots werden wieder Platzhalter). NICHT
  // clearSlot (das würde die Karte verwaisen und `pages` direkt editieren).
  const removeSelectedFromTemplate = useCallback(async () => {
    if (!binder || removing || selectedIds.size === 0) return;
    setRemoving(true);
    try {
      const defaultId = await ensureDefaultBinder();
      for (const cardId of selectedIds) await setCardExclusiveBinder(cardId, defaultId);
      await syncTemplateBinders({ binderIds: [binder.id] });
      setSelectedIds(new Set());
      await load();
    } catch (e) {
      console.error('[binder] remove selected error', e);
    } finally {
      setRemoving(false);
    }
  }, [binder, removing, selectedIds, load]);

  // Bei jedem Ansichtswechsel nach oben scrollen: Öffnet man aus der (langen,
  // gescrollten) Blätter-Übersicht eine Seite, behielte das Dokument sonst seine
  // Scrollposition — die kurze Einzelseite erschiene dann halb nach oben aus dem
  // Sichtfeld geschoben. Bei bereits oben stehendem Scroll ein No-op.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [view]);

  // ── Grid-Ansicht einer Vorlagen-Sammlung ────────────────────────────────
  // Die Filter leben im SELBEN sticky Panel wie Ansichts-Switch + Infos (nicht
  // in einem zweiten Panel darunter). Der Grid-Zustand kommt aus dem Hook, der
  // Kollaps (Grabber/Scroll) aus `useGrabberCollapse` — beide unbedingt (nicht
  // bedingt) aufrufen, daher hier vor jedem early-return.
  const templateGridActive = !!binder?.template && view === 'grid';
  const panelRef    = useRef<HTMLDivElement>(null);
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const tg = useTemplateGrid({
    template: binder?.template ?? null,
    active: templateGridActive,
    priceResults: cardPrices,
    onCardsChanged: load,
    selectMode: editMode && !!binder?.template,
    binderCardIds: binder?.cardIds,
    selectedCardIds: selectedIds,
    onToggleSelectCard: toggleSelect,
  });
  const { stage, registerRegion, regionStyle, grabberProps } = useGrabberCollapse({
    regionCount: 1,
    panelRef,
    gridWrapRef,
    ready: tg.ready,
    scrollTrigger: templateGridActive,
    measureDeps: [tg.ready, templateGridActive],
  });

  // „Füllen": nur FEHLENDE Slots dieser Vorlagen-Sammlung mit der jeweils
  // BESTEN Karte aus dem losen Stapel „Unsortiert" belegen — andere Sammlungen
  // bleiben unangetastet. Wir lösen die Slot-Gewinner nur über die Karten in
  // „Unsortiert" auf; liegt dort eine bessere Variante (z.B. Holo) als die schon
  // im Binder (z.B. Standard), wird sie hinzugefügt und der anschließende
  // Template-Sync verdrängt die schlechtere Karte zurück nach „Unsortiert".
  // Duplikate/schlechtere Varianten kommen erst gar nicht in die Sammlung.
  const [filling, setFilling] = useState(false);
  const handleFillFromOwned = useCallback(async () => {
    if (!binder?.template || filling) return;
    setFilling(true);
    try {
      const [allOwned, slots, defaultBinderId] = await Promise.all([
        getCards(),
        resolveTemplateSlots(binder.template),
        ensureDefaultBinder(),
      ]);
      const defaultBinder = await getBinder(defaultBinderId);
      const unsortedIds = new Set(defaultBinder?.cardIds ?? []);
      const unsorted = allOwned.filter(c => unsortedIds.has(c.id));
      const languageAware = binder.template.type === 'pokedex';
      const winnerIds = resolveSlotWinners(slots, unsorted, { languageAware })
        .map(r => r.winnerCardId)
        .filter((id): id is string => id !== null);
      const inThis = new Set(binder.cardIds);
      const toAdd = winnerIds.filter(id => !inThis.has(id));
      if (toAdd.length > 0) await addCardsToBinder(binder.id, toAdd); // 1 Write statt N
      await syncTemplateBinders({ binderIds: [binder.id] });
      await load();
    } catch (e) {
      console.error('[fill] error', e);
    } finally {
      setFilling(false);
    }
  }, [binder, filling, load]);

  // ── Export (Liste als PDF) ──────────────────────────────────────────────
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const handleExportList = useCallback(async (variant: 'missing' | 'owned' | 'both') => {
    if (!binder || exporting) return;
    setExporting(true);
    try {
      const fmtPrice = (tcgId?: string) => {
        const v = tcgId ? pickTrendPrice(cardPrices?.get(tcgId)) : null;
        return v != null ? v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '';
      };
      const ownedRows = cards.map(c => {
        const info = c.tcgId ? catalogInfoById.get(c.tcgId) : undefined;
        return { name: info?.name ?? c.name, number: info?.number ?? c.number, setName: info?.setName ?? c.setName, price: fmtPrice(c.tcgId), owned: true };
      });
      const missingRows = [...missingCards.values()].map(cc => {
        const info = catalogCardToInfo(cc);
        return { name: info.name, number: info.number, setName: info.setName, price: fmtPrice(cc.id), owned: false };
      });
      const rows = (variant === 'owned' ? ownedRows : variant === 'missing' ? missingRows : [...ownedRows, ...missingRows])
        .sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0));
      const { downloadCollectionPdf } = await import('@/components/binder/collection-pdf');
      const dateStr = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
      const label = variant === 'owned' ? 'Besitz' : variant === 'missing' ? 'Fehlliste' : 'Sammlung';
      await downloadCollectionPdf({ title: `${binder.name} — ${label}`, dateStr, variant, showSet: false, rows });
      setShowExport(false);
    } catch (e) {
      console.error('[export] list', e);
    } finally {
      setExporting(false);
    }
  }, [binder, exporting, cards, catalogInfoById, missingCards, cardPrices]);

  // ── Export (Proxy-Karten der fehlenden als PDF, Graustufen) ──────────────
  const [proxyProgress, setProxyProgress] = useState<{ done: number; total: number } | null>(null);
  const handleExportProxies = useCallback(async () => {
    if (!binder || exporting) return;
    setExporting(true);
    try {
      // Fehlende Karten in Binder-Reihenfolge (Blatt → Slot) sortieren und je
      // Karte die Fundstelle als Label bauen — Schlüssel ist "pageIdx-slotIdx".
      const entries = [...missingCards.entries()].sort(([ka], [kb]) => {
        const [pa, sa] = ka.split('-').map(Number);
        const [pb, sb] = kb.split('-').map(Number);
        return pa - pb || sa - sb;
      });
      const cardsIn = entries.map(([key, cc]) => {
        const [pIdx, sIdx] = key.split('-').map(Number);
        const info = catalogCardToInfo(cc);
        const sheet = Math.floor(pIdx / 2) + 1;
        const side = pIdx % 2 === 0 ? 'Vorder' : 'Rück';
        // Absolute Slot-Nummer — dieselbe Zahl, die im Binder auf dem leeren
        // Slot als Platzhalter steht (pageIdx · Größe + slotIdx + 1), damit man
        // die Proxy-Karte direkt dem passenden Slot zuordnen kann.
        const slotNo = pIdx * binderSize + sIdx + 1;
        return {
          imgUrl: info.imgLargeDe || info.imgLarge || undefined,
          name: info.name, number: info.number, setCode: cc.setCode,
          label: `Blatt ${sheet} · ${side} · Slot ${slotNo}`,
        };
      });
      if (cardsIn.length === 0) { setShowExport(false); return; }
      const mod = await import('@/components/binder/proxy-pdf');
      setProxyProgress({ done: 0, total: cardsIn.length });
      const images = await mod.prepareProxyImages(cardsIn, (done, total) => setProxyProgress({ done, total }));
      const items = cardsIn.map((c, i) => ({ src: images[i], label: c.label }));
      await mod.downloadProxyPdf(`${binder.name} — Proxy-Karten`, items);
      setShowExport(false);
    } catch (e) {
      console.error('[export] proxies', e);
    } finally {
      setExporting(false);
      setProxyProgress(null);
    }
  }, [binder, exporting, missingCards, binderSize]);

  // Platzhalter-Karten für fehlende Slots eines Vorlagen-Binders — dieselbe
  // Regel-Engine wie der Sync (lib/template-binders/*), aber rein lesend
  // (keine Schreibvorgänge). Läuft nach jedem `load()`, da sich sowohl das
  // Template als auch der Kartenbestand geändert haben können.
  useEffect(() => {
    if (!binder?.template) { setMissingCards(new Map()); setTemplateProgress(null); return; }
    let cancelled = false;
    const template = binder.template;
    const size = binder.size ?? 9;
    (async () => {
      const slots = await resolveTemplateSlots(template);
      const languageAware = template.type === 'pokedex';
      const resolutions = resolveSlotWinners(slots, cards, { languageAware }).sort((a, b) => a.order - b.order);
      if (cancelled) return;
      const map = new Map<string, CatalogCard>();
      let owned = 0;
      resolutions.forEach((r, i) => {
        if (r.winnerCardId === null && r.missingCatalog) {
          map.set(`${Math.floor(i / size)}-${i % size}`, r.missingCatalog);
        } else if (r.winnerCardId !== null) {
          owned++;
        }
      });
      setMissingCards(map);
      setTemplateProgress(resolutions.length > 0 ? { owned, total: resolutions.length } : null);
    })();
    return () => { cancelled = true; };
  }, [binder?.id, binder?.template, binder?.size, cards]);

  const persistPages = useCallback(async (newPages: BinderPage[]) => {
    setPages(newPages);
    try { await setBinderPages(id, newPages); }
    catch (e) { console.error('[binder] persistPages error', e); }
  }, [id]);

  const handleDelete = async () => {
    if (!binder) return;
    if (!confirm(`Sammlung „${binder.name}" löschen?`)) return;
    await deleteBinderCascade(binder);
    router.push('/binders');
  };

  const openDetail = async (cardDoc: CardDoc) => {
    // Vorläufige Karte (kein Katalog-Eintrag): Platzhalter aus manualData zeigen.
    if (cardDoc.pendingCatalog || !cardDoc.tcgId) {
      setDetailOwned([cardDoc]);
      setDetailCard(pendingCardInfo(cardDoc));
      return;
    }
    const [cc] = await getCatalogCardsByIds([cardDoc.tcgId]);
    if (!cc) return;
    setDetailOwned(cards.filter(c => c.tcgId === cardDoc.tcgId));
    setDetailCard(catalogCardToInfo(cc));
  };

  // Tap auf eine fehlende (Platzhalter-)Karte eines Vorlagen-Binders — öffnet
  // dasselbe Kartendetail wie eine unbesessene Karte in der Suche (0 eigene
  // Exemplare, aber Preis/Wunschliste einsehbar), statt tot zu sein.
  const openMissingDetail = (catalogCard: CatalogCard) => {
    setDetailOwned([]);
    setDetailCard(catalogCardToInfo(catalogCard));
  };

  // ── Slot-Operationen (über Page-Index) ─────────────────────────────────
  const swapSlots = (pA: number, sA: number, pB: number, sB: number) => {
    if (pA === pB && sA === sB) return;
    const next = pages.map(p => ({ slots: [...p.slots] }));
    if (!next[pA] || !next[pB]) return;
    [next[pA].slots[sA], next[pB].slots[sB]] = [next[pB].slots[sB], next[pA].slots[sA]];
    persistPages(next);
  };

  const clearSlot = (pageIdx: number, slotIdx: number) => {
    const next = pages.map(p => ({ slots: [...p.slots] }));
    if (!next[pageIdx]) return;
    next[pageIdx].slots[slotIdx] = null;
    persistPages(next);
  };

  // Eine Kopie in einen Slot legen. Exklusiv: die Kopie wird aus ALLEN anderen
  // Sammlungen entfernt (Eingang/Unsortiert/andere manuelle/automatische) —
  // eine physische Karte liegt in genau einer Hülle. Kam sie aus einer
  // automatischen Sammlung, wird diese anschließend neu synchronisiert (ihr
  // Slot ist jetzt frei → landet ggf. auf der Auto-Wunschliste).
  const assignSlot = async (pageIdx: number, slotIdx: number, cardDocId: string) => {
    const next = pages.map(p => ({ slots: [...p.slots] }));
    if (!next[pageIdx]) return;
    next[pageIdx].slots[slotIdx] = cardDocId;
    await persistPages(next);
    await removeCardFromOtherBinders(cardDocId, id);
    await syncTemplateBinders();
    load();
  };

  // ── Sheet-Verwaltung ────────────────────────────────────────────────────
  const addSheet = () => {
    const empty = (): BinderPage => ({ slots: Array(binderSize).fill(null) });
    persistPages([...pages, empty(), empty()]);
  };

  const deleteSheet = async (sheetIdx: number) => {
    const frontIdx = sheetIdx * 2;
    const backIdx = sheetIdx * 2 + 1;
    const cardIdsOnSheet = [
      ...(pages[frontIdx]?.slots ?? []),
      ...(pages[backIdx]?.slots ?? []),
    ].filter((s): s is string => !!s);

    if (cardIdsOnSheet.length > 0) {
      const ok = confirm(
        `Blatt ${sheetIdx + 1} enthält ${cardIdsOnSheet.length} Karte(n). ` +
        `Sie werden zurück in „Unsortiert" verschoben. Fortfahren?`
      );
      if (!ok) return;
    }

    // Karten in den Default-Binder schieben
    if (cardIdsOnSheet.length > 0) {
      try {
        const defaultId = await ensureDefaultBinder();
        for (const cid of cardIdsOnSheet) {
          await addCardToBinder(defaultId, cid);
        }
      } catch (e) {
        console.error('[binder] cascade to default failed', e);
      }
    }

    // Sheet aus Pages entfernen
    const next = pages.filter((_, i) => i !== frontIdx && i !== backIdx);
    const safe = next.length === 0
      ? [{ slots: Array(binderSize).fill(null) }, { slots: Array(binderSize).fill(null) }]
      : ensureEvenPages(next, binderSize);
    persistPages(safe);
    // Page-Index korrigieren falls über das Ende hinaus
    if (pageIdx >= safe.length) setPageIdx(Math.max(0, safe.length - 1));
  };

  const moveSheetByIds = (fromId: string, toId: string) => {
    const from = Number(fromId.replace('sheet-', ''));
    const to   = Number(toId.replace('sheet-', ''));
    if (from === to) return;
    const sheets = pagesToSheets(pages, binderSize);
    persistPages(sheetsToPages(arrayMove(sheets, from, to)));
  };

  if (loading || !binder) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isProtected = !!binder.isDefault;
  const binderColor = binder.color ?? '#e53e3e'; // var(--pokedex-red) als Hex — tintedGlassStyle() braucht echtes Hex, kein CSS-Var
  const layoutCols = binderSizeCols(binderSize);
  const layoutLabel = isBox ? 'Box' : binderSizeLabel(binderSize);
  const pageBg = resolvePageBg(binder.pageBackground);
  const sheets = pagesToSheets(pages, binderSize);

  return (
    <BinderCatalogCtx.Provider value={catalogInfoById}>
    <div className="min-h-screen">
      {/* ── Sticky Header-/Info-Panel: Kopf + Ansichts-Switch UND (in der
          Grid-Ansicht) die kollabierenden Filter — alles in EINEM Panel. ── */}
      <div ref={panelRef} className="sticky top-safe z-20 mx-3 mt-3 mb-2 glass rounded-[20px] px-4 pt-2 pb-2">
        <Button variant="ghost" onClick={() => router.back()} className="px-0 -ml-1" icon={<ChevronLeft size={18} strokeWidth={2} />}>
          Sammlungen
        </Button>
        <div className="flex items-center gap-3 mt-1">
          <BinderIcon
            name={binder.icon ?? (isBox ? 'box' : 'folder')}
            size={40}
            style={{ color: binderColor }}
            className="shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-role-h2 truncate text-glass flex items-center gap-1.5">
              {binder.name}
              <CollectionTypeBadge binder={binder} size="sm" />
            </h1>
            <p className="text-role-label text-glass-muted">{layoutLabel}</p>
          </div>
          {!isProtected && (
            <Menu
              portal
              trigger={(open, toggle) => (
                <Button
                  variant="secondary"
                  icon={<MoreHorizontal />}
                  aria-label="Aktionen"
                  aria-expanded={open}
                  onClick={toggle}
                />
              )}
              items={[
                // „Bearbeiten" (Modus) ist jetzt ein Button im Panel, kein
                // Menüpunkt mehr; der bisherige „Bearbeiten"-Eintrag (Settings)
                // heißt jetzt „Einstellungen".
                { label: 'Einstellungen', onClick: () => setShowEdit(true) },
                ...(binder.template ? [
                  { label: 'Exportieren …', onClick: () => setShowExport(true) },
                  { label: 'Passende Karten einsortieren', onClick: handleFillFromOwned, disabled: filling },
                ] : []),
                ...(!binder.isDefault ? [
                  { label: 'Sammlung löschen', onClick: handleDelete, destructive: true },
                ] : []),
              ]}
            />
          )}
        </div>

        {/* Fortschritt — nur bei automatischen (Vorlagen-)Bindern, analog zur Set-Detailseite. */}
        {binder.template && templateProgress && templateProgress.total > 0 && (
          <div className="space-y-1.5 mt-3">
            <div className="flex justify-between items-baseline">
              <span className="text-role-title text-glass">
                {templateProgress.owned} / {templateProgress.total} Karten
                {!totalValue.loading && (totalValue.withPrice > 0 || missingValue > 0) && (
                  <span className="text-role-label text-glass-muted">
                    {' · ≈'}{totalValue.total.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                    {' (≈'}{(totalValue.total + missingValue).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}{')'}
                  </span>
                )}
              </span>
              <span className="text-role-label text-glass-muted">{Math.round((templateProgress.owned / templateProgress.total) * 100)}%</span>
            </div>
            <Progress value={templateProgress.owned} max={templateProgress.total} accentColor={binderColor} />
          </div>
        )}

        {/* Ansichts-Switch + Seiten-Sprung (nur "Seite"-Ansicht) + Preis in
            EINER Zeile statt drei separaten — spart auf 3x3-Bindern genug
            Höhe, damit die Seiten-Ansicht ohne Scrollen passt. */}
        <div className="flex items-center justify-between gap-2 mt-3">
          <div className="flex items-center gap-2 min-w-0">
            {!isBox && (
              <ButtonGroup
                iconOnly
                className="shrink-0"
                value={view}
                onChange={(v) => { setView(v); exitEditMode(); }}
                options={[
                  { value: 'binder', label: <BookOpen size={18} />, ariaLabel: 'Blätter' },
                  { value: 'page', label: <FileText size={18} />, ariaLabel: 'Seite' },
                  { value: 'grid', label: <LayoutGrid size={18} />, ariaLabel: 'Liste' },
                ]}
              />
            )}
            {!isBox && view === 'page' && pages.length > 2 && (
              <label className="relative inline-flex items-center shrink-0">
                <select
                  value={Math.floor(pageIdx / 2)}
                  onChange={e => setPageIdx(Number(e.target.value) * 2)}
                  className="appearance-none pl-2.5 pr-6 h-11 rounded-full text-[12px] font-bold tabular-nums glass-inner text-glass focus:outline-none"
                  aria-label="Blatt auswählen"
                >
                  {Array.from({ length: Math.ceil(pages.length / 2) }, (_, i) => (
                    <option key={i} value={i}>Blatt {i + 1}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-1.5 pointer-events-none text-glass-muted" />
              </label>
            )}
          </div>
          {/* Rechts ausgerichtet: Zusatzinfo-Switch (nur Seitenansicht) +
              Kontext-Aktion. Automatische Sammlungen zeigen einen sichtbaren
              „Bearbeiten"-Button (Karten entfernen); im Modus wird daraus
              „Fertig". Manuelle Sammlungen starten den Modus weiterhin per
              Long-Press auf eine Kachel und zeigen sonst den Sammlungswert. */}
          <div className="flex items-center gap-2 shrink-0">
            {!isBox && view === 'page' && (
              // Zusatzinfo-Toggle als iconOnly-ButtonGroup (Toggle-Modus) —
              // nutzt deren Gooey-Gleit-Indikator (goo-squish) statt eines
              // eigenen Switch. Links „aus" (durchgestrichenes i), rechts „an".
              <ButtonGroup
                iconOnly
                toggle
                className="shrink-0"
                value={showCardInfo ? 'on' : 'off'}
                onChange={(v) => setShowCardInfo(v === 'on')}
                options={[
                  { value: 'off', label: <InfoOffIcon size={18} />, ariaLabel: 'Zusatzinformationen aus' },
                  { value: 'on',  label: <Info size={18} />,        ariaLabel: 'Zusatzinformationen an' },
                ]}
              />
            )}
            {editMode ? (
              // Icon-only Haken = „Fertig" (verlässt den Modus). Bewusst
              // textlos, damit die Kopfzeile in der Seiten-Ansicht (View-
              // Switch + Info-Schalter + Blatt-Dropdown) nicht überläuft —
              // iOS-typisches Bearbeiten↔Fertig.
              <Button variant="primary" accentColor="#2f855a" onClick={exitEditMode} icon={<Check />} aria-label="Fertig" className="shrink-0" />
            ) : !isProtected && !isBox ? (
              // Bearbeiten-Modus-Einstieg als Icon-only Stift — für alle
              // Ordner-Sammlungen außer „Unsortiert" (Boxen nutzen die Grid-
              // Ansicht ohne Bearbeiten-UI). Einziger Einstieg (kein Long-Press
              // mehr): automatische Sammlungen wählen Karten zum Entfernen,
              // manuelle sortieren/löschen wie gehabt.
              <Button variant="primary" onClick={() => setEditMode(true)} icon={<Pencil />} aria-label="Bearbeiten" className="shrink-0" />
            ) : (
              <span className="text-role-label font-semibold text-right shrink-0" style={{ color: binderColor }}>
                {!totalValue.loading && totalValue.withPrice > 0
                  ? `≈${totalValue.total.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}`
                  : ''}
                {' · '}{cards.length} Karten
              </span>
            )}
          </div>
        </div>

        {/* Filter der Grid-Ansicht — im SELBEN Panel wie Kopf + Ansichts-Switch.
            Kollabierende Region (Suche + Vorhanden/Fehlen + Rarity) per Griff/
            Scroll, Sortierung darunter immer sichtbar (wie Set-Detailseite). */}
        {templateGridActive && (
          <div className="mt-3">
            <div style={regionStyle(0)} className="overflow-hidden">
              <div ref={registerRegion(0)} className="pt-0.5">{tg.filterControls}</div>
            </div>
            <div className="pt-2">{tg.sortBar}</div>
            <Grabber expanded={stage === 0} {...grabberProps} />
          </div>
        )}
      </div>

      {templateGridActive ? (
        <div ref={gridWrapRef} className="px-3 py-3">{tg.grid}</div>
      ) : isBox || view === 'grid' ? (
        binder.isDefault
          ? <RecentTriageView cards={cards} onCardTap={openDetail} prices={cardPrices} />
          : <GridView cards={cards} onCardTap={openDetail} prices={cardPrices} />
      ) : view === 'binder' ? (
        <BinderOverview
          sheets={sheets}
          cols={layoutCols}
          cardsById={cardsById}
          missingCards={missingCards}
          accent={binderColor}
          pageBg={pageBg}
          editMode={editMode}
          template={!!binder.template}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onOpenPage={(pageIdx) => {
            // Öffnet exakt die angeklickte Seite (Vorder = 2n, Rück = 2n+1).
            setPageIdx(pageIdx);
            setView('page');
          }}
          onAddSheet={addSheet}
          onDeleteSheet={deleteSheet}
          onMoveSheet={moveSheetByIds}
        />
      ) : (
        <SinglePageView
          pages={pages}
          pageIdx={Math.min(pageIdx, pages.length - 1)}
          cols={layoutCols}
          binderSize={binderSize}
          cardsById={cardsById}
          missingCards={missingCards}
          accent={binderColor}
          pageBg={pageBg}
          editMode={editMode}
          template={!!binder.template}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onChangePageIdx={setPageIdx}
          onSwap={swapSlots}
          onClearSlot={clearSlot}
          onAddToSlot={(pIdx, slotIdx) => setPickerSlot({ pageIdx: pIdx, slotIdx })}
          onBack={() => setView('binder')}
          onCardTap={openDetail}
          onMissingTap={openMissingDetail}
          showCardInfo={showCardInfo}
          cardPrices={cardPrices}
        />
      )}

      {showEdit && (
        <CreateBinderModal
          existing={binder}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
        />
      )}

      {pickerSlot && (
        <BinderSlotPickerModal
          excludeBinderId={binder.id}
          onClose={() => setPickerSlot(null)}
          onPick={(cardDocId) => {
            assignSlot(pickerSlot.pageIdx, pickerSlot.slotIdx, cardDocId);
            getCard(cardDocId).then(c => {
              if (c) setCards(prev => prev.some(p => p.id === c.id) ? prev : [...prev, c]);
            });
            setPickerSlot(null);
          }}
        />
      )}

      {detailCard && (
        <CardDetailSheet
          card={detailCard}
          ownedCopies={detailOwned}
          onClose={() => setDetailCard(null)}
          onSaved={load}
        />
      )}

      <ScrollToTopButton />

      {/* Export-Sheet: Listen-PDF (fehlend/besessen/beide). Proxy-Karten folgen. */}
      <Sheet open={showExport} onClose={() => setShowExport(false)} title="Exportieren">
        <div className="flex flex-col gap-2 pb-2">
          <p className="text-role-label text-glass-muted px-1">Liste als PDF</p>
          {([
            { v: 'missing', label: 'Fehlende Karten' },
            { v: 'owned',   label: 'Besessene Karten' },
            { v: 'both',    label: 'Alle Karten (mit Status)' },
          ] as const).map(o => (
            <button
              key={o.v}
              onClick={() => handleExportList(o.v)}
              disabled={exporting}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl glass-inner text-left text-glass disabled:opacity-50"
            >
              <FileDown size={18} className="shrink-0 text-glass-muted" />
              <span className="flex-1">{o.label}</span>
            </button>
          ))}
          <p className="text-role-label text-glass-muted px-1 pt-2">Zum Ausdrucken</p>
          <button
            onClick={handleExportProxies}
            disabled={exporting}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl glass-inner text-left text-glass disabled:opacity-50"
          >
            <Images size={18} className="shrink-0 text-glass-muted" />
            <span className="flex-1">Proxy-Karten der fehlenden (Graustufen)</span>
          </button>
          {exporting && (
            <div className="flex items-center gap-2 px-1 pt-1 text-role-label text-glass-muted">
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              {proxyProgress
                ? `Proxy-Bilder … ${proxyProgress.done}/${proxyProgress.total}`
                : 'PDF wird erstellt …'}
            </div>
          )}
        </div>
      </Sheet>

      {/* Auswahl-Leiste im Bearbeiten-Modus (automatische Sammlung) — fix über
          der Bottom-Nav; zeigt Anzahl + Entfernen (zurück nach Unsortiert). */}
      {editMode && binder.template && (
        <div
          className="fixed inset-x-0 z-[70] px-3 pointer-events-none"
          style={{ bottom: 'calc(var(--nav-h) + env(safe-area-inset-bottom, 0px) + 8px)' }}
        >
          <div className="glass rounded-full px-4 py-2 flex items-center justify-between gap-3 shadow-xl pointer-events-auto max-w-md mx-auto">
            <span className="text-sm font-semibold text-glass">
              {selectedIds.size === 0 ? 'Karten zum Entfernen wählen' : `${selectedIds.size} ausgewählt`}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {/* „Abbrechen" bewusst entfernt: „Fertig" (Kopfzeile) verlässt den
                  Modus, Abwählen geht durch erneutes Antippen — ein separater
                  Abbrechen-Button wäre redundant. */}
              <Button
                variant="primary"
                size="sm"
                accentColor="var(--action-delete)"
                onClick={removeSelectedFromTemplate}
                disabled={selectedIds.size === 0 || removing}
                icon={<Trash2 />}
                className="shrink-0"
              >
                Entfernen
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Lade-Overlay während „Passende Karten einsortieren" (Bulk-Add + Sync). */}
      {filling && (
        <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-black/45 backdrop-blur-sm">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium text-white">Karten werden einsortiert …</span>
        </div>
      )}
    </div>
    </BinderCatalogCtx.Provider>
  );
}

// ── Ring-Spalte (Loch-Linie eines Blatts) ─────────────────────────────────
function RingsCol() {
  return (
    <div className="flex flex-col items-center justify-around self-stretch py-2" style={{ width: 12 }}>
      {[0, 1, 2, 3].map(i => (
        <span
          key={i}
          className="rounded-full"
          style={{
            width: 5, height: 5,
            background: 'var(--muted-foreground)',
            opacity: 0.45,
            boxShadow: 'inset 0 0.5px 1px rgba(0,0,0,0.3)',
          }}
        />
      ))}
    </div>
  );
}

// ── Mini-Page-Grid ────────────────────────────────────────────────────────
function MiniPageGrid({
  slots, cols, cardsById, dim, pageBg, missingCards, pageIdx,
  selectMode, selectedIds, onToggleSelect,
}: {
  slots: (string | null)[]; cols: number; cardsById: Map<string, CardDoc>; dim?: boolean; pageBg?: string;
  /** Vorlagen-Binder: Katalog-Platzhalter für fehlende Slots (Key
   *  "pageIdx-slotIdx"), damit man wie in der Suche sieht, welche Karte
   *  hier noch fehlt statt nur einer leeren Fläche. */
  missingCards?: Map<string, CatalogCard>;
  pageIdx?: number;
  /** Auswahl-Modus (automatische Sammlung): vorhandene Karten sind antippbar. */
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (cardId: string) => void;
}) {
  const { bg: slotBg, border: slotBorder } = pageBg
    ? slotColors(pageBg)
    : { bg: 'var(--secondary)', border: 'var(--border)' };
  const catalogInfoById = useContext(BinderCatalogCtx);
  return (
    <div
      className="grid gap-1 w-full"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, opacity: dim ? 0.45 : 1 }}
    >
      {slots.map((slotId, slotI) => {
        const card = slotId ? cardsById.get(slotId) : undefined;
        const cardInfo = card ? ownedCardToInfo(card, catalogInfoById) : undefined;
        const missing = !card && pageIdx != null ? missingCards?.get(`${pageIdx}-${slotI}`) : undefined;
        const selectable = selectMode && !!card;
        const isSel = selectable && !!selectedIds?.has(card!.id);
        return (
          <div
            key={slotI}
            className="relative aspect-[2.5/3.5] rounded-[3px] overflow-hidden"
            style={{
              background: card || missing ? '#1a1a1a' : slotBg,
              border: card || missing ? 'none' : `1px dashed ${slotBorder}`,
              cursor: selectable ? 'pointer' : undefined,
              opacity: selectMode && card && !isSel ? 0.6 : undefined,
              boxShadow: isSel ? `0 0 0 2px ${'var(--pokedex-blue)'}` : undefined,
            }}
            onClick={selectable ? (e) => { e.stopPropagation(); onToggleSelect?.(card!.id); } : undefined}
          >
            {selectable && (
              <div
                className="absolute top-0.5 right-0.5 z-10 w-4 h-4 rounded-full flex items-center justify-center"
                style={isSel
                  ? { background: 'var(--pokedex-blue)', color: '#fff' }
                  : { background: 'rgba(0,0,0,.45)', border: '1.5px solid rgba(255,255,255,.85)' }}
                aria-hidden
              >
                {isSel && <Check size={10} strokeWidth={3} />}
              </div>
            )}
            {missing && !card && (
              <div className="absolute inset-0 bg-[#c9c9c9] dark:bg-[#5b5d63]" />
            )}
            {card && (
              <>
                <CardImage
                  srcDe={cardInfo?.imgLargeDe}
                  src={cardInfo?.imgLarge ?? ""}
                  alt=""
                  width={245}
                  height={342}
                  className="relative w-full h-full object-cover"
                />
                {/* Holo-/Reverse-Glanz nach erfasster Variante des Exemplars
                    (Holo=Artwork, Reverse=Rahmen) — wie auf den großen Slots. */}
                {(card.variant === 'holo' || card.variant === 'reverse') && (
                  <div
                    className={`absolute inset-0 ${holoShimmerClass(card.variant, card.rarity)}`}
                    aria-hidden="true"
                  />
                )}
              </>
            )}
            {!card && missing && (
              // Fehlt-Look wie in der Suche (Card-Theme), ohne Badges/Herz (bare).
              <Card card={catalogCardToInfo(missing)} ownedCards={[]} bare cornerRadius={3} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Grid View ─────────────────────────────────────────────────────────────
function GridView({ cards, onCardTap, prices }: {
  cards: CardDoc[]; onCardTap: (c: CardDoc) => void; prices?: Map<string, PriceResult | null>;
}) {
  const catalogInfoById = useContext(BinderCatalogCtx);
  if (cards.length === 0) {
    return (
      <div className="px-4 py-16 text-center text-glass-muted text-sm">
        Noch keine Karten in dieser Sammlung.
      </div>
    );
  }
  return (
    <div className="px-3 py-3 grid grid-cols-2 gap-2">
      {cards.map((c, i) => {
        const priceResult = c.tcgId ? prices?.get(c.tcgId) : null;
        const variantPrice = priceResult ? findVariantPrice(priceResult.variants, c.variant) : undefined;
        const price = variantPrice?.trend ?? variantPrice?.market;
        return (
          <Card
            key={`${c.id}-${i}`}
            card={ownedCardToInfo(c, catalogInfoById)}
            ownedCards={[c]}
            onCardClick={() => onCardTap(c)}
            price={price != null ? price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : undefined}
          />
        );
      })}
    </div>
  );
}

// ── Eingang-Triage-Ansicht ───────────────────────────────────────────────
// Frisch gescannte/hinzugefügte Karten schnell wiederfinden: neueste zuerst,
// gruppiert in „Heute / Diese Woche / Älter" (aus `addedAt`). Nutzt pro
// Abschnitt das bestehende `GridView` weiter.
function toDateSafe(ts: CardDoc['addedAt']): number {
  const t = ts as unknown as { toDate?: () => Date; seconds?: number };
  if (t?.toDate) return t.toDate().getTime();
  if (typeof t?.seconds === 'number') return t.seconds * 1000;
  return new Date(ts as unknown as string).getTime() || 0;
}

/** Triage-Ansicht für „Unsortiert": frische Karten (Heute/Diese Woche/Älter
 *  nach `addedAt`, neueste zuerst) schnell wiederfinden, um sie zuzuordnen. */
function RecentTriageView({ cards, onCardTap, prices }: {
  cards: CardDoc[]; onCardTap: (c: CardDoc) => void; prices?: Map<string, PriceResult | null>;
}) {
  const sections = useMemo(() => {
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const weekAgo = new Date(startToday); weekAgo.setDate(weekAgo.getDate() - 7);
    const tToday = startToday.getTime();
    const tWeek = weekAgo.getTime();
    const sorted = [...cards].sort((a, b) => toDateSafe(b.addedAt) - toDateSafe(a.addedAt));
    const heute: CardDoc[] = [], woche: CardDoc[] = [], aelter: CardDoc[] = [];
    for (const c of sorted) {
      const t = toDateSafe(c.addedAt);
      if (t >= tToday) heute.push(c);
      else if (t >= tWeek) woche.push(c);
      else aelter.push(c);
    }
    return [
      { key: 'heute', label: 'Heute', cards: heute },
      { key: 'woche', label: 'Diese Woche', cards: woche },
      { key: 'aelter', label: 'Älter', cards: aelter },
    ].filter(s => s.cards.length > 0);
  }, [cards]);

  if (cards.length === 0) return <GridView cards={cards} onCardTap={onCardTap} prices={prices} />;

  return (
    <div>
      {sections.map(s => (
        <section key={s.key}>
          <h3 className="text-role-label text-glass-muted px-4 pt-3 pb-0.5">
            {s.label} · {s.cards.length}
          </h3>
          <GridView cards={s.cards} onCardTap={onCardTap} prices={prices} />
        </section>
      ))}
    </div>
  );
}

// ── Sheet-Tile (Vorder + Rück mit Ringen an beiden Außenrändern) ──────────
function SheetTile({
  sheet, cols, cardsById, missingCards, accent, pageBg, editMode, onOpen, onDelete, isOverlay,
  template, selectMode, selectedIds, onToggleSelect,
}: {
  sheet: { front: BinderPage; back: BinderPage; sheetIdx: number };
  cols: number;
  cardsById: Map<string, CardDoc>;
  missingCards: Map<string, CatalogCard>;
  accent: string;
  pageBg: string;
  editMode: boolean;
  /** Öffnet die konkrete Seite (absoluter pageIdx: Vorderseite = 2·sheet,
   *  Rückseite = 2·sheet+1). */
  onOpen?: (pageIdx: number) => void;
  onDelete?: () => void;
  isOverlay?: boolean;
  /** Automatische Sammlung: keine Blatt-Löschung, stattdessen Karten-Auswahl. */
  template?: boolean;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (cardId: string) => void;
}) {
  const slotsFilled = sheet.front.slots.filter(Boolean).length + sheet.back.slots.filter(Boolean).length;
  const slotsTotal = sheet.front.slots.length + sheet.back.slots.length;
  const pageTextColor = pageBg === 'transparent' ? '#1a1a1a' : readableText(pageBg);
  return (
    <div
      className="rounded-xl border shadow-card p-2"
      style={{
        background: pageBg,
        borderColor: isOverlay ? pageTextColor : 'var(--border)',
        borderStyle: 'solid',
        borderWidth: isOverlay ? 2 : 1,
        cursor: editMode ? undefined : 'pointer',
      }}
      // Rest der Kachel (Spine, Blatt-Label) öffnet die Vorderseite.
      onClick={() => { if (!editMode && onOpen) onOpen(sheet.sheetIdx * 2); }}
    >
      <div className="relative flex items-stretch gap-1.5">
        <RingsCol />
        {/* Vorderseite anklicken → Vorderseite öffnen */}
        <div className="flex-1 min-w-0">
          <MiniPageGrid slots={sheet.front.slots} cols={cols} cardsById={cardsById} pageBg={pageBg} missingCards={missingCards} pageIdx={sheet.sheetIdx * 2} selectMode={selectMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
          <div className="text-[9px] text-center mt-1" style={{ color: pageTextColor, opacity: 0.75 }}>Vorder</div>
        </div>
        {/* Buchrücken-Knick */}
        <div className="self-stretch w-px" style={{ background: pageTextColor, opacity: 0.25 }} />
        {/* Rückseite anklicken → Rückseite öffnen (stoppt den Vorderseiten-
            Handler der Gesamtkachel). */}
        <div
          className="flex-1 min-w-0"
          onClick={e => { if (!editMode && onOpen) { e.stopPropagation(); onOpen(sheet.sheetIdx * 2 + 1); } }}
        >
          <MiniPageGrid slots={sheet.back.slots} cols={cols} cardsById={cardsById} pageBg={pageBg} missingCards={missingCards} pageIdx={sheet.sheetIdx * 2 + 1} selectMode={selectMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
          <div className="text-[9px] text-center mt-1" style={{ color: pageTextColor, opacity: 0.75 }}>Rück</div>
        </div>
        <RingsCol />
      </div>
      <div className="relative flex items-center justify-center mt-2">
        <span
          className="text-[11px] font-bold tabular-nums"
          style={{ color: pageTextColor }}
        >
          Blatt {sheet.sheetIdx + 1}
        </span>
        {editMode && !template && onDelete && (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white"
            style={DELETE_GLASS_STYLE}
            aria-label="Blatt löschen"
          >
            <Minus size={16} strokeWidth={3} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Binder Overview — Sheets als Sortable mit dnd-kit ─────────────────────
function BinderOverview({
  sheets, cols, cardsById, missingCards, accent, pageBg, editMode,
  template, selectedIds, onToggleSelect,
  onOpenPage, onAddSheet, onDeleteSheet, onMoveSheet,
}: {
  sheets: { front: BinderPage; back: BinderPage; sheetIdx: number }[];
  cols: number;
  cardsById: Map<string, CardDoc>;
  missingCards: Map<string, CatalogCard>;
  accent: string;
  pageBg: string;
  editMode: boolean;
  /** Automatische Sammlung: keine Blatt-Verwaltung (Add/Delete/Reorder),
   *  stattdessen Karten-Auswahl zum Entfernen. */
  template?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (cardId: string) => void;
  onOpenPage: (pageIdx: number) => void;
  onAddSheet: () => void;
  onDeleteSheet: (sheetIdx: number) => void;
  onMoveSheet: (fromId: string, toId: string) => void;
}) {
  // Auswahl-Modus (automatische Sammlung im editMode): Karten antippen, keine
  // Blatt-Verwaltung.
  const selectMode = !!template && editMode;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 16 } }),
  );

  const items = sheets.map(s => `sheet-${s.sheetIdx}`);
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={(e: DragEndEvent) => {
        setActiveId(null);
        if (template) return;   // automatische Sammlung: kein Blatt-Umsortieren
        if (!e.over || e.over.id === e.active.id) return;
        onMoveSheet(String(e.active.id), String(e.over.id));
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={items} strategy={rectSortingStrategy}>
        <div className="px-3 pt-4 flex flex-col gap-3">
          {sheets.map(sheet => (
            <SortableSheetTile
              key={`sheet-${sheet.sheetIdx}`}
              id={`sheet-${sheet.sheetIdx}`}
              sheet={sheet}
              cols={cols}
              cardsById={cardsById}
              missingCards={missingCards}
              accent={accent}
              pageBg={pageBg}
              editMode={editMode}
              template={template}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              onOpen={onOpenPage}
              onDelete={() => onDeleteSheet(sheet.sheetIdx)}
            />
          ))}

          {editMode && !template && (
            <button
              onClick={onAddSheet}
              className="relative glass-inner rounded-xl border-2 border-dashed border-border p-2"
              aria-label="Neues Blatt"
            >
              <div className="flex items-stretch gap-1.5 opacity-50">
                <RingsCol />
                <div className="flex-1 min-w-0">
                  <MiniPageGrid slots={Array(sheets[0]?.front.slots.length ?? 9).fill(null)} cols={cols} cardsById={cardsById} dim />
                </div>
                <div className="self-stretch w-px bg-border" />
                <div className="flex-1 min-w-0">
                  <MiniPageGrid slots={Array(sheets[0]?.back.slots.length ?? 9).fill(null)} cols={cols} cardsById={cardsById} dim />
                </div>
                <RingsCol />
              </div>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="w-12 h-12 rounded-full flex items-center justify-center text-white" style={ADD_GLASS_STYLE}>
                  <Plus size={24} strokeWidth={3} />
                </span>
              </div>
              <div className="mt-2 text-[11px] text-glass-muted text-center">Neues Blatt</div>
            </button>
          )}
        </div>
      </SortableContext>

      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(.2,.9,.3,1)' }}>
        {activeId
          ? (() => {
              const idx = Number(activeId.replace('sheet-', ''));
              const s = sheets.find(x => x.sheetIdx === idx);
              if (!s) return null;
              return (
                <div style={{ transform: 'rotate(-1.5deg) scale(1.03)' }}>
                  <SheetTile sheet={s} cols={cols} cardsById={cardsById} missingCards={missingCards} accent={accent} pageBg={pageBg} editMode={false} isOverlay />
                </div>
              );
            })()
          : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableSheetTile({
  id, sheet, cols, cardsById, missingCards, accent, pageBg, editMode, onOpen, onDelete,
  template, selectMode, selectedIds, onToggleSelect,
}: {
  id: string;
  sheet: { front: BinderPage; back: BinderPage; sheetIdx: number };
  cols: number;
  cardsById: Map<string, CardDoc>;
  missingCards: Map<string, CatalogCard>;
  accent: string;
  pageBg: string;
  editMode: boolean;
  onOpen: (pageIdx: number) => void;
  onDelete: () => void;
  template?: boolean;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (cardId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id,
    disabled: !editMode || !!template,   // automatische Sammlung: kein Blatt-Drag
  });

  // Bei automatischen Sammlungen ist Blatt-Drag aus → weder Wackeln noch
  // touch-action:none noch Drag-Listener/Attribute.
  const dragEnabled = editMode && !template;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    animation: dragEnabled && !isDragging && !isOver ? 'binder-wiggle 0.18s ease-in-out infinite alternate' : undefined,
    animationDelay: dragEnabled && !isDragging && !isOver ? `${wiggleDelay(id)}s` : undefined,
    touchAction: dragEnabled ? 'none' : undefined,
    borderColor: isOver ? accent : undefined,
    borderStyle: isOver ? 'dashed' : undefined,
    borderWidth: isOver ? 2 : undefined,
    boxShadow: isOver ? `0 0 0 4px ${accent}40` : undefined,
    scale: isOver ? '1.02' : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      className="no-callout"
      style={style}
      {...(dragEnabled ? attributes : {})}
      {...(dragEnabled ? listeners : {})}
      onContextMenu={e => e.preventDefault()}
    >
      <SheetTile
        sheet={sheet}
        cols={cols}
        cardsById={cardsById}
        missingCards={missingCards}
        accent={accent}
        pageBg={pageBg}
        editMode={editMode}
        template={template}
        selectMode={selectMode}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
        onOpen={onOpen}
        onDelete={onDelete}
      />
    </div>
  );
}

// ── Spread View — Doppelseite mit Karten-Drag über beide Seiten ───────────
type FlipState = {
  kind: 'rotate' | 'slide';
  dir: 'forward' | 'backward';
  progress: number;
  committing: boolean;
} | null;

function SinglePageView({
  pages, pageIdx, cols, binderSize, cardsById, missingCards, accent, pageBg, editMode,
  template, selectedIds, onToggleSelect,
  onChangePageIdx, onSwap, onClearSlot, onAddToSlot, onBack, onCardTap, onMissingTap,
  showCardInfo, cardPrices,
}: {
  pages: BinderPage[]; pageIdx: number; cols: number; binderSize: number;
  cardsById: Map<string, CardDoc>; missingCards: Map<string, CatalogCard>; accent: string; pageBg: string; editMode: boolean;
  /** Automatische Sammlung: Manual-Ops (Drag/Swap/Add/Löschen) aus, stattdessen
   *  Auswahl zum Entfernen. */
  template?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (cardId: string) => void;
  onChangePageIdx: (i: number) => void;
  onSwap: (pA: number, sA: number, pB: number, sB: number) => void;
  onClearSlot: (pageIdx: number, slotIdx: number) => void;
  onAddToSlot: (pageIdx: number, slotIdx: number) => void;
  onBack: () => void;
  onCardTap: (c: CardDoc) => void;
  onMissingTap: (c: CatalogCard) => void;
  showCardInfo?: boolean;
  cardPrices?: Map<string, PriceResult | null>;
}) {
  // Auswahl-Modus (nur automatische Sammlung im editMode): Tipp wählt aus statt
  // Detail zu öffnen; Drag/Swap/Add sind aus.
  const selectMode = !!template && editMode;
  const catalogInfoById = useContext(BinderCatalogCtx);
  const page = pages[pageIdx];
  const totalPages = pages.length;
  const [activeSlot, setActiveSlot] = useState<{ pageIdx: number; slotIdx: number } | null>(null);

  const [flip, setFlip] = useState<FlipState>(null);
  const flipStartRef = useRef<{ x: number; y: number; w: number; locked: boolean } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
  );

  if (!page) {
    return <div className="px-4 py-8 text-center text-muted-foreground">Keine Seite</div>;
  }

  // Vorderseite = gerader Index, Ringe links. Rückseite = ungerader Index, Ringe rechts.
  const isFront = pageIdx % 2 === 0;
  const label = pageLabel(pageIdx);
  const activeCard = activeSlot
    ? cardsById.get(pages[activeSlot.pageIdx]?.slots[activeSlot.slotIdx] ?? '')
    : null;
  const activeCardInfo = activeCard ? ownedCardToInfo(activeCard, catalogInfoById) : null;

  // Page-Renderer — Slots im Layout-Grid mit Page-Background + Lochung auf der
  // natürlichen Seite: Vorderseite (gerader Index) links, Rückseite (ungerader
  // Index) rechts — wie beim Wenden eines gelochten Blatts. WICHTIG: dieselbe
  // Regel gilt im Ruhezustand UND in allen Flip-Layern, damit die Löcher-Spalte
  // am Ende des Umblätterns NICHT die Seite wechselt (das schob sonst das Grid
  // ein paar Pixel = Ruckler beim Loslassen).
  const renderPage = (p: BinderPage, pIdx: number, key: string) => {
    const ringsLeft = pIdx % 2 === 0;
    const slotsContent = (
      <div
        className="flex-1 grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {p.slots.map((slotId, slotI) => {
          const card = slotId ? cardsById.get(slotId) : undefined;
          const slotKey = `slot-${pIdx}-${slotI}`;
          return card ? (
            <DraggableCardSlot
              key={slotKey}
              id={slotKey}
              card={card}
              accent={accent}
              pageBg={pageBg}
              editMode={editMode}
              selectMode={selectMode}
              selected={!!selectedIds?.has(card.id)}
              onToggleSelect={() => onToggleSelect?.(card.id)}
              isDragging={activeSlot?.pageIdx === pIdx && activeSlot?.slotIdx === slotI}
              onTap={() => onCardTap(card)}
              onDelete={() => onClearSlot(pIdx, slotI)}
              showInfo={showCardInfo}
              priceResult={card.tcgId ? cardPrices?.get(card.tcgId) : undefined}
            />
          ) : (
            <DroppableEmptySlot
              key={slotKey}
              id={slotKey}
              n={pIdx * binderSize + slotI + 1}
              editMode={editMode && !selectMode}
              selectMode={selectMode}
              accent={accent}
              pageBg={pageBg}
              missingCard={missingCards.get(`${pIdx}-${slotI}`)}
              onAdd={() => onAddToSlot(pIdx, slotI)}
              onMissingTap={onMissingTap}
              showInfo={showCardInfo}
              priceResult={(() => {
                const mc = missingCards.get(`${pIdx}-${slotI}`);
                return mc ? cardPrices?.get(mc.id) : undefined;
              })()}
            />
          );
        })}
      </div>
    );
    // Hintergrund-Layer (prev-back, neighbor) ohne Shadow rendern, damit kein
    // Schatten an der Ring-Kante der rotierenden Seite sichtbar wird.
    const isBg = key === 'prev-back' || key === 'neighbor';
    return (
      <div
        key={key}
        className={`flex items-stretch gap-2 px-3 py-2 mx-3 rounded-xl border${isBg ? '' : ' shadow-card'}`}
        style={{ background: pageBg, borderColor: 'var(--border)' }}
      >
        {ringsLeft && <RingsCol />}
        {slotsContent}
        {!ringsLeft && <RingsCol />}
      </div>
    );
  };

  // Flip-Pointer-Handlers (nur im View-Mode aktiv)
  // Vorderseite (gerader Index, Ringe links): swipe-left → rotate forward (Rückseite zeigen);
  //                                            swipe-right → slide backward (vorheriges Blatt-Back von links)
  // Rückseite  (ungerader Index, Ringe rechts): swipe-right → rotate backward (Vorderseite zeigen);
  //                                              swipe-left  → slide forward (nächstes Blatt-Front von rechts)
  const onFlipDown = (e: React.PointerEvent) => {
    if (editMode) return;
    const w = (e.currentTarget as HTMLDivElement).clientWidth;
    flipStartRef.current = { x: e.clientX, y: e.clientY, w, locked: false };
  };
  const onFlipMove = (e: React.PointerEvent) => {
    if (editMode || !flipStartRef.current || flip?.committing) return;
    const dx = e.clientX - flipStartRef.current.x;
    const dy = e.clientY - flipStartRef.current.y;
    if (!flipStartRef.current.locked) {
      if (Math.abs(dx) < 10) return;
      if (Math.abs(dy) > Math.abs(dx)) { flipStartRef.current = null; return; }
      flipStartRef.current.locked = true;
    }
    const direction: 'left' | 'right' = dx < 0 ? 'left' : 'right';

    let kind: 'rotate' | 'slide';
    let dir: 'forward' | 'backward';
    if (isFront && direction === 'left')         { kind = 'rotate'; dir = 'forward';  }
    else if (!isFront && direction === 'right')  { kind = 'rotate'; dir = 'backward'; }
    else if (!isFront && direction === 'left')   { kind = 'slide';  dir = 'forward';  }
    else /* isFront && right */                  { kind = 'slide';  dir = 'backward'; }

    if (dir === 'forward' && pageIdx >= totalPages - 1) return;
    if (dir === 'backward' && pageIdx === 0) return;

    const progress = Math.max(0, Math.min(1, Math.abs(dx) / flipStartRef.current.w));
    setFlip({ kind, dir, progress, committing: false });
  };
  const onFlipUp = () => {
    if (!flipStartRef.current) return;
    flipStartRef.current = null;
    if (!flip) return;
    // Nach einem echten Wisch (Flip war aktiv) den unmittelbar folgenden Klick
    // EINMALIG schlucken — sonst löst das Loslassen einen Klick auf der Karte
    // unter dem Finger aus und öffnet ungewollt deren Kartendetail. Capture-
    // Phase am window, damit er vor dem onClick der Karte greift.
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      (ev as MouseEvent).preventDefault?.();
      window.removeEventListener('click', swallow, true);
    };
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true), 400);
    if (flip.progress > 0.35) {
      const target = flip.dir === 'forward' ? pageIdx + 1 : pageIdx - 1;
      setFlip({ ...flip, progress: 1, committing: true });
      // 1) Animation läuft auf progress=1 zu (350ms)
      // 2) pageIdx → target; flip auf opacity-Mask schalten und ohne Transition direkt
      //    auf progress=0 zurücksetzen, damit der Top-Layer keinen sichtbaren Snap
      //    der alten Inhalte zeigt
      setTimeout(() => {
        onChangePageIdx(target);
        setFlip(null);
      }, 350);
    } else {
      setFlip({ ...flip, progress: 0, committing: true });
      setTimeout(() => setFlip(null), 250);
    }
  };

  // Layer-Berechnungen: aktuelle Seite (oben, animiert) + Ziel-Seite (darunter)
  const showFlip = flip != null;
  const targetIdx = !showFlip ? pageIdx
    : flip.dir === 'forward' ? pageIdx + 1 : pageIdx - 1;
  const targetPage = pages[targetIdx] ?? null;
  const flipTransition = flip?.committing ? 'transform 350ms cubic-bezier(.4,.0,.2,1)' : 'none';

  // Rotate: Vorderseite klappt nach links um (Hinge links), Rückseite nach rechts (Hinge rechts).
  const rotateHingeLeft = isFront;
  const rotateAngle = !showFlip || flip.kind !== 'rotate' ? 0
    : rotateHingeLeft ? -180 * flip.progress : 180 * flip.progress;

  // Slide: aktuelle Seite gleitet aus der Ring-fernen Kante, neue Seite kommt von dort herein.
  const slideShift = !showFlip || flip.kind !== 'slide' ? 0
    : flip.dir === 'forward' ? -flip.progress * 100 : flip.progress * 100;

  // Während der Rotation sind ZWEI Nachbar-Blätter im Hintergrund sichtbar:
  //   - Vorderseite des FOLGENDEN Blatts (Sheet+1):
  //       Forward:  neighbor 0% → +100% (raus n. rechts)
  //       Backward: neighbor +100% → 0% (rein v. rechts n. links)
  //   - Rückseite des VORHERIGEN Blatts (Sheet-1):
  //       Forward:  prevBack 0% → -100% (raus n. links)
  //       Backward: prevBack -100% → 0% (rein v. links n. rechts)
  const currentSheetIdx = Math.floor(pageIdx / 2);
  const neighborIdx = (currentSheetIdx + 1) * 2;
  const neighborPage = flip?.kind === 'rotate' ? (pages[neighborIdx] ?? null) : null;
  const neighborShift = !showFlip || flip.kind !== 'rotate' ? 0
    : rotateHingeLeft
      ? flip.progress * 100          // forward: 0 → 100 (raus n. rechts)
      : (1 - flip.progress) * 100;   // backward: 100 → 0 (rein v. rechts, Bewegungsrichtung links)

  const prevBackIdx = currentSheetIdx * 2 - 1;
  const prevBackPage = flip?.kind === 'rotate' ? (pages[prevBackIdx] ?? null) : null;
  const prevBackShift = !showFlip || flip.kind !== 'rotate' ? 0
    : rotateHingeLeft
      ? -(1 - flip.progress) * 100   // forward: -100 → 0 (rein v. links)
      : -flip.progress * 100;        // backward: 0 → -100 (raus n. links)

  // Ein „Seitenschritt" (100%) entspricht NICHT der vollen Containerbreite,
  // sondern der Seitenbreite + kleinem Spalt: der Container ist um 2·mx-3 = 24px
  // breiter als die Seite; abzüglich des gewünschten 2px-Spalts bleibt ein
  // Versatz von 22px pro 100%. So haben benachbarte Seiten beim Verschieben UND
  // Drehen denselben schmalen Abstand wie die Ruhe-Vorschau am Rand (statt der
  // vollen 24px). `step(pct)` rechnet einen Prozent-Versatz in genau diesen
  // Schritt um: translateX(step(100)) = Seitenbreite + 2px.
  const STEP_OFFSET_PX = 22;
  const step = (pct: number) => `calc(${pct}% - ${(pct * STEP_OFFSET_PX / 100).toFixed(3)}px)`;

  return (
    <div>
      {editMode ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e: DragStartEvent) => {
            const parts = String(e.active.id).split('-');
            setActiveSlot({ pageIdx: Number(parts[1]), slotIdx: Number(parts[2]) });
          }}
          onDragEnd={(e: DragEndEvent) => {
            setActiveSlot(null);
            if (!e.over || e.over.id === e.active.id) return;
            const fromParts = String(e.active.id).split('-');
            const toParts = String(e.over.id).split('-');
            onSwap(Number(fromParts[1]), Number(fromParts[2]), Number(toParts[1]), Number(toParts[2]));
          }}
          onDragCancel={() => setActiveSlot(null)}
        >
          {renderPage(page, pageIdx, 'edit')}

          <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(.2,.9,.3,1)' }}>
            {activeCard ? (
              <div
                className="rounded-[4px] overflow-hidden border-2"
                style={{
                  borderColor: accent,
                  background: '#1a1a1a',
                  boxShadow: '0 16px 36px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.35)',
                  transform: 'rotate(-2deg) scale(1.08)',
                  aspectRatio: '2.5/3.5',
                  width: 80,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeCardInfo?.imgLargeDe || activeCardInfo?.imgLarge || undefined}
                  alt={activeCard.name}
                  className="w-full h-full object-cover"
                  onError={e => { e.currentTarget.style.visibility = 'hidden'; }}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <div
          // overflow:visible damit die 3D-Rotation vertikal nicht abgeschnitten
          // wird. Die horizontalen Hintergrund-Layer werden durch overflow-x:
          // hidden auf body/html (siehe globals.css) am Viewport-Rand geclippt.
          className="relative"
          style={{
            perspective: '2000px',
            // `none` statt `pan-y`: die Seite selbst lässt sich nicht mehr
            // verschieben/scrollen — ein (auch leicht diagonaler) Wisch steuert
            // ausschließlich den Blätter-/Seiten-Flip, statt die Seite darunter
            // wegzuscrollen. Die Einzel-Seite ist auf Bildschirmhöhe ausgelegt,
            // daher wird hier kein vertikales Scrollen benötigt.
            touchAction: 'none',
            overscrollBehavior: 'contain',
          }}
          onPointerDown={onFlipDown}
          onPointerMove={onFlipMove}
          onPointerUp={onFlipUp}
          onPointerCancel={onFlipUp}
        >
          {/* Rückseite des vorherigen Blatts — hinter dem rotierenden Blatt
              auf der gegenüberliegenden Seite des Nachbarblatts. */}
          {showFlip && flip.kind === 'rotate' && prevBackPage && (
            <div
              className="absolute inset-0"
              style={{
                transform: `translateX(${step(prevBackShift)})`,
                transition: flipTransition,
                zIndex: 0,
              }}
            >
              {renderPage(prevBackPage, prevBackIdx, 'prev-back')}
            </div>
          )}
          {/* Nachbarblatt-Vorderseite — hinter dem rotierenden Blatt; gleitet
              aus der ring-fernen Kante heraus, während die Rotation läuft. */}
          {showFlip && flip.kind === 'rotate' && neighborPage && (
            <div
              className="absolute inset-0"
              style={{
                transform: `translateX(${step(neighborShift)})`,
                transition: flipTransition,
                zIndex: 0,
              }}
            >
              {renderPage(neighborPage, neighborIdx, 'neighbor')}
            </div>
          )}
          {/* Ziel-Seite — nur bei Slide als separate hereingleitende Schicht.
              Bei Rotate ist die Rückseite Teil des rotierenden Containers
              (Back-Face) und rotiert mit der Vorderseite mit. */}
          {showFlip && flip.kind === 'slide' && targetPage && (
            <div
              className="absolute inset-0"
              style={{
                transform: `translateX(${step(slideShift + (flip.dir === 'forward' ? 100 : -100))})`,
                transition: flipTransition,
              }}
            >
              {renderPage(targetPage, targetIdx, 'target')}
            </div>
          )}
          {/* Nachbarseiten andeuten (nur im Ruhezustand): eine Seiten-Kante,
              BÜNDIG am Bildschirmrand, ~2px hinter der aktuellen Seite hervor.
              WICHTIG: nur auf der Seite, auf der ein SLIDE (Verschieben) hinführt
              — nicht auf der Dreh-Seite. Vorderseite → nach rechts wischen slidet
              zur VORHERIGEN Seite (kommt von links) ⇒ Vorschau LINKS. Rückseite →
              nach links wischen slidet zur NÄCHSTEN Seite (kommt von rechts) ⇒
              Vorschau RECHTS. (Die jeweils andere Wischrichtung ist ein Dreh-Flip
              der Blattrückseite/-vorderseite — dafür keine Rand-Vorschau.) */}
          {!showFlip && !isFront && pageIdx < totalPages - 1 && (
            <div
              aria-hidden
              className="absolute rounded-l-lg border-y border-l pointer-events-none"
              style={{ top: 0, bottom: 0, right: 0, width: 10, zIndex: 0,
                background: pageBg === 'transparent' ? 'rgba(120,120,130,.12)' : pageBg,
                borderColor: 'var(--border)', boxShadow: '-2px 1px 5px rgba(0,0,0,.20)' }}
            />
          )}
          {!showFlip && isFront && pageIdx > 0 && (
            <div
              aria-hidden
              className="absolute rounded-r-lg border-y border-r pointer-events-none"
              style={{ top: 0, bottom: 0, left: 0, width: 10, zIndex: 0,
                background: pageBg === 'transparent' ? 'rgba(120,120,130,.12)' : pageBg,
                borderColor: 'var(--border)', boxShadow: '2px 1px 5px rgba(0,0,0,.20)' }}
            />
          )}
          {/* Animierter Container — bei Rotate als 3D-„Blatt" mit Front- und
              Backface (Folgeseite); bei Slide einfache horizontale Translation. */}
          <div
            style={{
              transform: flip?.kind === 'rotate'
                // Volle 100% (Containerbreite), NICHT step(): die Rotation um die
                // Blattkante muss die geklappte Seite exakt mittig einrasten —
                // mit dem 22px-Gap-Versatz endete sie ~22px daneben und sprang
                // beim Loslassen (flip→null) auf die Rest-Position. Der schmale
                // Abstand zur Nachbarseite entsteht über deren step()-Layer.
                ? `translateX(${(rotateHingeLeft ? 1 : -1) * flip.progress * 100}%) rotateY(${rotateAngle}deg)`
                : flip?.kind === 'slide'
                  ? `translateX(${step(slideShift)})`
                  : undefined,
              transformOrigin: flip?.kind === 'rotate'
                ? (rotateHingeLeft ? 'left center' : 'right center')
                : undefined,
              transformStyle: flip?.kind === 'rotate' ? 'preserve-3d' : undefined,
              transition: flipTransition,
              willChange: showFlip ? 'transform' : undefined,
              position: 'relative',
              zIndex: 1,
            }}
          >
            {/* Frontface — aktuelle Seite */}
            <div
              style={{
                backfaceVisibility: flip?.kind === 'rotate' ? 'hidden' : undefined,
              }}
            >
              {renderPage(page, pageIdx, 'top-front')}
            </div>
            {/* Backface — Folgeseite, an die Vorderseite „angeklebt", rotiert
                mit; durch eigenes rotateY(180deg) ist sie ab 90° sichtbar. */}
            {flip?.kind === 'rotate' && targetPage && (
              <div
                className="absolute inset-0"
                style={{
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                }}
              >
                {renderPage(targetPage, targetIdx, 'top-back')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Kompaktes Overlay über einem Kartenbild — Name, Setnummer(+Variante), Preis.
 *  Gemeinsam für besessene (`DraggableCardSlot`) und fehlende
 *  (`DroppableEmptySlot`) Karten, damit beide identisch aussehen. */
function CardInfoOverlay({
  name, number, price, variantLabel,
}: {
  name: string;
  number?: string;
  price?: number;
  variantLabel?: string;
}) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 px-1 py-0.5 pointer-events-none"
      style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0) 90%)' }}
    >
      <div className="text-[9px] font-bold leading-tight truncate text-white">{name}</div>
      <div className="flex items-center justify-between gap-1 text-[8px] leading-tight text-white/85">
        <span className="truncate">{[number, variantLabel].filter(Boolean).join(' · ')}</span>
        {price != null && (
          <span className="font-semibold shrink-0">
            {price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: price < 10 ? 2 : 0 })}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Draggable Card-Slot ───────────────────────────────────────────────────
function DraggableCardSlot({
  id, card, accent, pageBg, editMode, selectMode, selected, onToggleSelect, isDragging, onTap, onDelete,
  showInfo, priceResult,
}: {
  id: string;
  card: CardDoc;
  accent: string;
  pageBg: string;
  editMode: boolean;
  /** Auswahl-Modus (automatische Sammlung): Tipp wählt aus, kein Drag/Löschen. */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  isDragging: boolean;
  onTap: () => void;
  onDelete: () => void;
  showInfo?: boolean;
  priceResult?: PriceResult | null;
}) {
  const catalogInfoById = useContext(BinderCatalogCtx);
  const cardInfo = ownedCardToInfo(card, catalogInfoById);
  const [imgLoaded, setImgLoaded] = useState(false);
  const { attributes, listeners, setNodeRef, isOver } = useSortable({
    id,
    disabled: !editMode || selectMode,   // im Auswahl-Modus kein Drag
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(editMode && !selectMode ? listeners : {})}
      className="relative rounded-[5px] overflow-hidden aspect-[2.5/3.5] w-full no-callout"
      style={{
        borderColor: selectMode && selected ? accent : isOver ? accent : `${accent}55`,
        borderStyle: isOver ? 'dashed' : 'solid',
        borderWidth: (isOver || (selectMode && selected)) ? 2 : 1,
        background: pageBg === 'transparent' ? '#1a1a1a' : pageBg,
        opacity: isDragging ? 0.3 : (selectMode && !selected ? 0.6 : 1),
        boxShadow: isOver ? `0 0 0 4px ${accent}40` : (selectMode && selected ? `0 0 0 3px ${accent}` : undefined),
        transform: isOver ? 'scale(1.04)' : undefined,
        transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out, opacity 150ms ease-out',
        animation: editMode && !selectMode && !isDragging && !isOver ? 'binder-wiggle 0.18s ease-in-out infinite alternate' : undefined,
        animationDelay: editMode && !selectMode && !isDragging && !isOver ? `${wiggleDelay(id)}s` : undefined,
        touchAction: editMode && !selectMode ? 'none' : undefined,
        cursor: selectMode ? 'pointer' : undefined,
      }}
      onContextMenu={e => e.preventDefault()}
      onClick={() => {
        if (selectMode) { onToggleSelect?.(); return; }
        if (!editMode) onTap();
      }}
    >
      {(() => {
        // Bild-URL kommt aus dem Katalog (Owned-Karten verweisen nur darauf) —
        // solange der Katalog-Lookup noch lädt, gibt es KEINE URL. Dann ein
        // Skeleton rendern statt eines <img> ohne src (das zeigte sonst den
        // alt-Text = Kartenname). Erst mit URL das echte Bild (mit eigenem
        // Skeleton bis onLoad).
        const src = cardInfo.imgLargeDe || cardInfo.imgLarge || undefined;
        return src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={card.name}
            className={`w-full h-full object-cover pointer-events-none no-callout${imgLoaded ? '' : ' img-skeleton'}`}
            draggable={false}
            onLoad={() => setImgLoaded(true)}
            onError={e => { e.currentTarget.style.visibility = 'hidden'; }}
          />
        ) : (
          <div className="w-full h-full img-skeleton" aria-label={card.name} />
        );
      })()}
      {showInfo && !editMode && (
        <CardInfoOverlay
          name={card.name}
          number={card.number}
          variantLabel={VARIANT_LABELS[card.variant]}
          price={(() => {
            const v = priceResult ? findVariantPrice(priceResult.variants, card.variant) : undefined;
            return v?.trend ?? v?.market ?? pickTrendPrice(priceResult);
          })()}
        />
      )}
      {card.quantity > 1 && !editMode && (
        <div className="absolute top-1 right-1 text-[9px] font-bold px-1 py-0.5 rounded bg-black/70 text-white">
          ×{card.quantity}
        </div>
      )}
      {/* Auswahl-Häkchen (Auswahl-Modus, automatische Sammlung) */}
      {selectMode && (
        <div
          className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center"
          style={selected
            ? { background: accent, color: '#fff' }
            : { background: 'rgba(0,0,0,.45)', border: '1.5px solid rgba(255,255,255,.85)' }}
          aria-hidden
        >
          {selected && <Check size={12} strokeWidth={3} />}
        </div>
      )}
      {/* Manuelle Sammlung: Minus-Button zum Slot-Leeren (nicht im Auswahl-Modus) */}
      {editMode && !selectMode && !isDragging && (
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white"
          style={DELETE_GLASS_STYLE}
          aria-label="Aus Slot entfernen"
        >
          <Minus size={10} strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

// ── Droppable Empty-Slot ──────────────────────────────────────────────────
function DroppableEmptySlot({
  id, n, editMode, selectMode, accent, pageBg, missingCard, onAdd, onMissingTap,
  showInfo, priceResult,
}: {
  id: string;
  n: number;
  editMode: boolean;
  /** Auswahl-Modus (automatische Sammlung): fehlende Karten sind hier NICHT
   *  antippbar — kein Detail-Öffnen, nur besessene Karten lassen sich wählen. */
  selectMode?: boolean;
  accent: string;
  pageBg: string;
  /** Vorlagen-Binder: Katalog-Platzhalter für diesen fehlenden Slot —
   *  gleiche Optik wie fehlende Karten in der Suche (CardTile). */
  missingCard?: CatalogCard;
  onAdd: () => void;
  /** Tap auf eine fehlende Karte außerhalb des Bearbeiten-Modus — öffnet ihr
   *  Kartendetail (0 eigene Exemplare), analog zu unbesessenen Karten in der Suche. */
  onMissingTap?: (c: CatalogCard) => void;
  showInfo?: boolean;
  priceResult?: PriceResult | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !editMode });
  const { bg: emptyBg, border: emptyBorder } = slotColors(pageBg);
  return (
    <div
      ref={setNodeRef}
      className="relative rounded-[5px] border border-dashed aspect-[2.5/3.5] w-full overflow-hidden"
      style={{
        background: emptyBg,
        borderColor: isOver ? accent : emptyBorder,
        borderWidth: isOver ? 2 : 1,
        boxShadow: isOver ? `0 0 0 4px ${accent}40` : undefined,
        transform: isOver ? 'scale(1.04)' : undefined,
        transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out',
        cursor: !editMode && !selectMode && missingCard ? 'pointer' : undefined,
      }}
      onClick={() => { if (!editMode && !selectMode && missingCard) onMissingTap?.(missingCard); }}
    >
      {missingCard && (
        <>
          {/* Fehlt-Look wie in der Suche (Card-Theme), ohne Badges/Herz (bare). */}
          <Card card={catalogCardToInfo(missingCard)} ownedCards={[]} bare cornerRadius={5} />
          {showInfo && !editMode && (
            <CardInfoOverlay
              name={missingCard.nameDe ?? missingCard.name}
              number={missingCard.number}
              price={pickTrendPrice(priceResult)}
            />
          )}
        </>
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        {editMode ? (
          <button
            onClick={onAdd}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white"
            style={ADD_GLASS_STYLE}
            aria-label="Karte hinzufügen"
          >
            <Plus size={16} strokeWidth={3} />
          </button>
        ) : !missingCard ? (
          // Platzhalter-Zahl an den Slot-Hintergrund angepasst: dunkel auf hellem,
          // hell auf dunklem Untergrund (Luminanz via readableText), mit moderater
          // Deckkraft — lesbar, aber bewusst dezent (kein harter Kontrast/keine
          // Pille). Volle Kontrastfarbe bei ~55% wirkt klarer als der frühere
          // ausgegraute 50%-Ton.
          <span
            className="text-sm font-bold tabular-nums"
            style={{ color: pageBg?.startsWith('#') ? readableText(pageBg) : '#1a1a1a', opacity: 0.55 }}
          >
            {n}
          </span>
        ) : null}
      </div>
    </div>
  );
}
