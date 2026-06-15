'use client';

import { useState, useEffect, useRef, useMemo, use, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, Settings, LayoutGrid, BookOpen, Pencil, Eye,
  Plus, X, ChevronRight,
} from 'lucide-react';
import { getBinder, deleteBinder, setBinderPages, cardIdsToPages } from '@/lib/firestore/binders';
import { getCard } from '@/lib/firestore/cards';
import { getCatalogCardsByIds } from '@/lib/firestore/catalog';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { CreateBinderModal } from '@/components/binder/CreateBinderModal';
import { BinderIcon } from '@/lib/binder-icons';
import { binderSizeLabel, binderSizeCols, type BinderSize } from '@/lib/binder-sizes';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { BinderSlotPickerModal } from '@/components/binder/BinderSlotPickerModal';
import type { BinderDoc, BinderPage, CardDoc } from '@/types';

interface Props {
  params: Promise<{ id: string }>;
}

type View = 'binder' | 'page' | 'grid';

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
  const [showActions, setShowActions] = useState(false);
  const [view, setView] = useState<View>('binder');
  const [pageIdx, setPageIdx] = useState<number>(0);
  const [editMode, setEditMode] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<{ page: number; slot: number } | null>(null);
  const [detailCard, setDetailCard] = useState<CardInfo | null>(null);
  const [detailOwned, setDetailOwned] = useState<CardDoc[]>([]);

  const binderSize = (binder?.size ?? 9) as BinderSize;
  const isBox = binder?.collectionType === 'box';

  const load = useCallback(async () => {
    const b = await getBinder(id);
    if (!b) { router.push('/binders'); return; }
    setBinder(b);
    const owned = await Promise.all(b.cardIds.map(cid => getCard(cid)));
    const ownedCards = owned.filter(Boolean) as CardDoc[];
    setCards(ownedCards);
    const size = (b.size ?? 9) as BinderSize;
    setPages(b.pages && b.pages.length > 0 ? b.pages : cardIdsToPages(b.cardIds, size));
    if (b.collectionType === 'box') setView('grid');
    setLoading(false);
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  const persistPages = useCallback(async (newPages: BinderPage[]) => {
    setPages(newPages);
    try {
      await setBinderPages(id, newPages);
    } catch (e) {
      console.error('[binder] persistPages error', e);
    }
  }, [id]);

  const handleDelete = async () => {
    if (!binder) return;
    if (!confirm(`Sammlung „${binder.name}" löschen?`)) return;
    await deleteBinder(binder.id);
    router.push('/binders');
  };

  const openDetail = async (cardDoc: CardDoc) => {
    if (!cardDoc.tcgId) return;
    const [cc] = await getCatalogCardsByIds([cardDoc.tcgId]);
    if (!cc) return;
    setDetailOwned(cards.filter(c => c.tcgId === cardDoc.tcgId));
    setDetailCard(catalogCardToInfo(cc));
  };

  // ── Slot-Operationen (in der aktuellen Seite) ───────────────────────────
  const swapSlots = (slotA: number, slotB: number) => {
    if (slotA === slotB) return;
    const next = pages.map(p => ({ slots: [...p.slots] }));
    const cur = next[pageIdx];
    if (!cur) return;
    const tmp = cur.slots[slotA];
    cur.slots[slotA] = cur.slots[slotB];
    cur.slots[slotB] = tmp;
    persistPages(next);
  };

  const clearSlot = (slotI: number) => {
    const next = pages.map(p => ({ slots: [...p.slots] }));
    if (!next[pageIdx]) return;
    next[pageIdx].slots[slotI] = null;
    persistPages(next);
  };

  const assignSlot = (pageI: number, slotI: number, cardDocId: string) => {
    const next = pages.map(p => ({ slots: [...p.slots] }));
    if (!next[pageI]) return;
    next[pageI].slots[slotI] = cardDocId;
    persistPages(next);
  };

  // ── Page-Verwaltung ──────────────────────────────────────────────────────
  const addPage = () => {
    persistPages([...pages, { slots: Array(binderSize).fill(null) }]);
  };

  const deletePage = (i: number) => {
    const hasContent = pages[i].slots.some(s => !!s);
    if (hasContent && !confirm('Diese Seite enthält Karten. Wirklich löschen?')) return;
    const next = pages.filter((_, idx) => idx !== i);
    persistPages(next.length === 0 ? [{ slots: Array(binderSize).fill(null) }] : next);
    if (pageIdx >= next.length) setPageIdx(Math.max(0, next.length - 1));
  };

  const movePage = (from: number, to: number) => {
    if (from === to || from === to - 1) return;
    const next = [...pages];
    const [p] = next.splice(from, 1);
    next.splice(from < to ? to - 1 : to, 0, p);
    persistPages(next);
  };

  const swapPages = (a: number, b: number) => {
    if (a === b) return;
    const next = [...pages];
    [next[a], next[b]] = [next[b], next[a]];
    persistPages(next);
  };

  if (loading || !binder) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const binderColor = binder.color ?? 'var(--pokedex-red)';
  const layoutCols = binderSizeCols(binderSize);
  const layoutLabel = isBox ? 'Box' : binderSizeLabel(binderSize);
  const totalCapacity = isBox ? null : (binder.capacity ?? null);

  return (
    <div className="min-h-screen pb-24">
      {/* Color bar */}
      <div className="h-1.5 w-full" style={{ background: binderColor }} />

      {/* Header */}
      <div className="sticky top-0 z-20 bg-background border-b border-border px-4 pt-3 pb-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-muted-foreground" aria-label="Zurück">
            <ChevronLeft size={22} />
          </button>
          <BinderIcon
            name={binder.icon ?? (isBox ? 'box' : 'folder')}
            size={26}
            style={{ color: binderColor }}
            className="shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold truncate">{binder.name}</h1>
            <p className="text-xs text-muted-foreground">{layoutLabel}</p>
          </div>
          <div className="flex flex-col items-end shrink-0 leading-none">
            <span
              className="text-[36px] font-extrabold tabular-nums"
              style={{ color: binderColor }}
            >
              {cards.length}
            </span>
            {totalCapacity != null && (
              <span className="text-[11px] text-muted-foreground/70 mt-0.5 tabular-nums">
                von {totalCapacity}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowActions(a => !a)}
            className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center"
            aria-label="Aktionen"
          >
            <Settings size={15} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 mt-3">
          {!isBox && (
            <div className="flex rounded-full p-0.5 bg-secondary border border-border">
              <ViewBtn icon={<BookOpen size={15} />} active={view === 'binder'} onClick={() => { setView('binder'); setEditMode(false); }} color={binderColor} label="Doppelseiten" />
              <ViewBtn icon={<LayoutGrid size={15} />} active={view === 'grid'} onClick={() => { setView('grid'); setEditMode(false); }} color={binderColor} label="Gitter" />
            </div>
          )}
          {!isBox && view !== 'grid' && (
            <button
              onClick={() => setEditMode(e => !e)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold transition-colors"
              style={{
                background: editMode ? binderColor : 'var(--secondary)',
                color: editMode ? '#fff' : 'var(--muted-foreground)',
                border: editMode ? 'none' : '1px solid var(--border)',
              }}
            >
              {editMode ? <Eye size={13} /> : <Pencil size={13} />}
              {editMode ? 'Ansicht' : 'Bearbeiten'}
            </button>
          )}
        </div>

        {showActions && (
          <div className="absolute right-4 top-[calc(100%-8px)] bg-card border border-border rounded-md shadow-lg overflow-hidden z-30 min-w-[160px]">
            <button
              onClick={() => { setShowActions(false); setShowEdit(true); }}
              className="w-full px-4 py-3 text-sm text-left hover:bg-secondary"
            >
              Bearbeiten
            </button>
            {!binder.isDefault && (
              <button
                onClick={() => { setShowActions(false); handleDelete(); }}
                className="w-full px-4 py-3 text-sm text-left text-destructive hover:bg-secondary"
              >
                Sammlung löschen
              </button>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      {isBox || view === 'grid' ? (
        <GridView cards={cards} onCardTap={openDetail} />
      ) : view === 'binder' ? (
        <BinderOverview
          pages={pages}
          binderSize={binderSize}
          cols={layoutCols}
          cardsById={cardsById}
          accent={binderColor}
          editMode={editMode}
          onOpenPage={(i) => { setPageIdx(i); setView('page'); }}
          onAddPage={addPage}
          onDeletePage={deletePage}
          onMovePage={movePage}
          onSwapPages={swapPages}
        />
      ) : (
        <PageDetail
          pages={pages}
          pageIdx={Math.min(pageIdx, pages.length - 1)}
          cols={layoutCols}
          cardsById={cardsById}
          accent={binderColor}
          editMode={editMode}
          onChangePageIdx={setPageIdx}
          onSwapInPage={swapSlots}
          onClearSlot={clearSlot}
          onAddToSlot={(slot) => setPickerSlot({ page: Math.min(pageIdx, pages.length - 1), slot })}
          onBack={() => setView('binder')}
          onCardTap={openDetail}
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
            assignSlot(pickerSlot.page, pickerSlot.slot, cardDocId);
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
    </div>
  );
}

// ── View-Toggle-Button ────────────────────────────────────────────────────
function ViewBtn({
  icon, active, onClick, color, label,
}: { icon: React.ReactNode; active: boolean; onClick: () => void; color: string; label: string }) {
  return (
    <button
      onClick={onClick}
      className="w-10 h-8 flex items-center justify-center rounded-full transition-colors"
      style={{
        background: active ? color : 'transparent',
        color: active ? '#fff' : 'var(--muted-foreground)',
      }}
      aria-label={label}
    >
      {icon}
    </button>
  );
}

// ── Mini-Page-Grid (in Doppelseiten-Übersicht — auch für „Neue Seite") ────
function MiniPageGrid({
  slots, cols, cardsById, dim,
}: { slots: (string | null)[]; cols: number; cardsById: Map<string, CardDoc>; dim?: boolean }) {
  return (
    <div
      className="grid gap-1 w-full"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, opacity: dim ? 0.45 : 1 }}
    >
      {slots.map((slotId, slotI) => {
        const card = slotId ? cardsById.get(slotId) : undefined;
        return (
          <div
            key={slotI}
            className="aspect-[2.5/3.5] rounded-md overflow-hidden"
            style={{
              background: card ? '#1a1a1a' : 'var(--secondary)',
              border: card ? 'none' : '1px dashed var(--border)',
            }}
          >
            {card && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={card.tcgImageUrl ?? `https://images.pokemontcg.io/${card.setId}/${card.number.split('/')[0]}_hires.png`}
                alt=""
                className="w-full h-full object-cover"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Grid View ─────────────────────────────────────────────────────────────
function GridView({ cards, onCardTap }: { cards: CardDoc[]; onCardTap: (c: CardDoc) => void }) {
  if (cards.length === 0) {
    return (
      <div className="px-4 py-16 text-center text-muted-foreground text-sm">
        Noch keine Karten in dieser Sammlung.
      </div>
    );
  }
  return (
    <div className="px-3 py-3 grid grid-cols-2 gap-2">
      {cards.map((c, i) => (
        <button
          key={`${c.id}-${i}`}
          onClick={() => onCardTap(c)}
          className="relative rounded-xl overflow-hidden border border-green-500/40 cursor-pointer"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={c.tcgImageUrl ?? `https://images.pokemontcg.io/${c.setId}/${c.number.split('/')[0]}_hires.png`}
            alt={c.name}
            className="w-full aspect-[2.5/3.5] object-cover"
          />
          {c.quantity > 1 && (
            <div className="absolute top-1 right-1 text-[9px] font-bold px-1 py-0.5 rounded bg-black/70 text-white">
              ×{c.quantity}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Binder Overview — Doppelseiten + Page-Drag mit Insertion-Animation ────
type TileRect = { left: number; top: number; width: number; height: number; cx: number; cy: number };

type PageDrag = {
  sourceIdx: number;
  startX: number;   // Cursor-Position zum Drag-Start (clientX)
  startY: number;
  dx: number;       // Aktuelle Drag-Differenz zum Start
  dy: number;
  pointerId: number;
  /** Snapshot der Tile-Rects zum Drag-Start — wird NICHT mehr neu berechnet,
   *  damit Hit-Test während Animation stabil bleibt. */
  rects: Map<number, TileRect>;
  /** Insertion-Position 0..pages.length */
  insertAt: number;
  /** Wenn cursor mittig auf einer Seite ist, Swap statt Insert */
  swapWith: number | null;
};

function BinderOverview({
  pages, binderSize, cols, cardsById, accent, editMode,
  onOpenPage, onAddPage, onDeletePage, onMovePage, onSwapPages,
}: {
  pages: BinderPage[]; binderSize: number; cols: number;
  cardsById: Map<string, CardDoc>; accent: string; editMode: boolean;
  onOpenPage: (i: number) => void;
  onAddPage: () => void;
  onDeletePage: (i: number) => void;
  onMovePage: (from: number, to: number) => void;
  onSwapPages: (a: number, b: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [drag, setDrag] = useState<PageDrag | null>(null);
  // Click-Suppression-Flag: nach Drag den nachfolgenden Click-Event ignorieren
  const justDraggedRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Snapshot aller Tile-Positionen zum Drag-Start — Live-Rects sind durch Transforms instabil
  const snapshotRects = (): Map<number, TileRect> => {
    const map = new Map<number, TileRect>();
    tileRefs.current.forEach((el, idx) => {
      const r = el.getBoundingClientRect();
      map.set(idx, {
        left: r.left, top: r.top, width: r.width, height: r.height,
        cx: r.left + r.width / 2, cy: r.top + r.height / 2,
      });
    });
    return map;
  };

  // Tile-Pointer-Down: Long-Press startet Drag
  const onTilePointerDown = (e: React.PointerEvent, pageI: number) => {
    if (!editMode) return;
    clearLongPress();
    const startX = e.clientX;
    const startY = e.clientY;
    const pid = e.pointerId;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      const rects = snapshotRects();
      try { containerRef.current?.setPointerCapture(pid); } catch {}
      setDrag({
        sourceIdx: pageI, startX, startY, dx: 0, dy: 0, pointerId: pid,
        rects, insertAt: pageI, swapWith: null,
      });
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(15);
    }, 350);
  };

  // Container-Pointer-Move: cancelt Long-Press bei großer Bewegung, sonst trackt Drag
  const onContainerPointerMove = (e: React.PointerEvent) => {
    // Vor Long-Press: bei signifikanter Bewegung den Timer abbrechen
    if (longPressTimer.current && drag == null) {
      // Wir haben startX/Y nicht hier, also vergleichen wir mit aktuellem Element-Center
      // Simpler: nach > 8 px Bewegung ohne Drag → cancel
      clearLongPress();
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    // Hit-Test mit Snapshot-Rects (nicht den Live-Rects, die durch Transforms wandern)
    let insertAt = pages.length;
    let swapWith: number | null = null;
    for (let i = 0; i < pages.length; i++) {
      if (i === drag.sourceIdx) continue;
      const r = drag.rects.get(i);
      if (!r) continue;
      if (e.clientY >= r.top && e.clientY <= r.top + r.height) {
        const midX = r.left + r.width / 2;
        const innerL = r.left + r.width * 0.25;
        const innerR = r.left + r.width * 0.75;
        if (e.clientX > innerL && e.clientX < innerR) {
          swapWith = i; insertAt = i; break;
        } else if (e.clientX <= midX) {
          insertAt = i; break;
        } else {
          insertAt = i + 1; break;
        }
      }
    }
    setDrag({ ...drag, dx, dy, insertAt, swapWith });
  };

  const onContainerPointerUp = () => {
    if (!drag) return;
    const { sourceIdx, insertAt, swapWith } = drag;
    if (swapWith != null && swapWith !== sourceIdx) {
      onSwapPages(sourceIdx, swapWith);
    } else if (insertAt !== sourceIdx && insertAt !== sourceIdx + 1) {
      onMovePage(sourceIdx, insertAt);
    }
    // Click-Suppression: der nachfolgende `click` auf die Tile soll nicht öffnen
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 100);
    setDrag(null);
  };

  const onContainerPointerCancel = () => {
    setDrag(null);
    clearLongPress();
  };

  // Tile-Click (View-Mode oder kein Long-Press) öffnet Page — aber nicht direkt nach Drag
  const onTileClick = (pageI: number) => {
    if (editMode) return;
    if (justDraggedRef.current) return;
    onOpenPage(pageI);
  };

  // Verschiebungs-Offset jeder Tile berechnen (Snapshot-basiert)
  const tileShift = (idx: number): { x: number; y: number } => {
    if (!drag) return { x: 0, y: 0 };
    if (idx === drag.sourceIdx) return { x: 0, y: 0 };
    // Swap: nur swap-target tauscht visuell die Position
    if (drag.swapWith != null && drag.swapWith !== drag.sourceIdx) {
      if (idx === drag.swapWith) {
        const src = drag.rects.get(drag.sourceIdx);
        const dst = drag.rects.get(drag.swapWith);
        if (!src || !dst) return { x: 0, y: 0 };
        return { x: src.left - dst.left, y: src.top - dst.top };
      }
      return { x: 0, y: 0 };
    }
    // Insert: alle Tiles ab insertAt nach rechts shiften (in 2-Spalten-Grid = halbe Tile-Breite)
    const r = drag.rects.get(idx);
    if (!r) return { x: 0, y: 0 };
    const newIdx = idx > drag.sourceIdx ? idx - 1 : idx;
    return newIdx >= drag.insertAt ? { x: r.width * 0.5, y: 0 } : { x: 0, y: 0 };
  };

  return (
    <div
      ref={containerRef}
      className="px-3 pt-4 grid grid-cols-2 gap-3 relative select-none"
      style={{ touchAction: drag ? 'none' : undefined }}
      onPointerMove={onContainerPointerMove}
      onPointerUp={onContainerPointerUp}
      onPointerCancel={onContainerPointerCancel}
    >
      {pages.map((page, pageI) => {
        const isSource = drag?.sourceIdx === pageI;
        const shift = tileShift(pageI);
        const transform = isSource
          ? `translate(${drag!.dx}px, ${drag!.dy}px) scale(1.05)`
          : (shift.x !== 0 || shift.y !== 0)
            ? `translate(${shift.x}px, ${shift.y}px)`
            : undefined;
        return (
          <div
            key={pageI}
            ref={el => { if (el) tileRefs.current.set(pageI, el); }}
            data-page={pageI}
            className="bg-card rounded-xl border border-border shadow-card p-2 flex flex-col"
            style={{
              transform,
              transition: isSource ? 'none' : 'transform 200ms ease-out',
              zIndex: isSource ? 50 : 1,
              touchAction: editMode ? 'none' : undefined,
              opacity: isSource ? 0.95 : 1,
              animation: editMode && !isSource ? 'binder-wiggle 0.5s ease-in-out infinite alternate' : undefined,
            }}
            onPointerDown={e => onTilePointerDown(e, pageI)}
            onClick={() => onTileClick(pageI)}
          >
            <MiniPageGrid slots={page.slots} cols={cols} cardsById={cardsById} />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-muted-foreground">
                Seite {pageI + 1}
                {' · '}
                <span className="tabular-nums">
                  {page.slots.filter(Boolean).length}/{binderSize}
                </span>
              </span>
              {editMode && (
                <button
                  onClick={e => { e.stopPropagation(); onDeletePage(pageI); }}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-white"
                  style={{ background: 'var(--action-delete)' }}
                  aria-label="Seite löschen"
                >
                  <X size={11} strokeWidth={3} />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {editMode && (
        <button
          onClick={onAddPage}
          className="relative bg-card rounded-xl border-2 border-dashed border-border p-2 flex flex-col"
          aria-label="Neue Seite"
        >
          <MiniPageGrid
            slots={Array(binderSize).fill(null)}
            cols={cols}
            cardsById={cardsById}
            dim
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span
              className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg text-white"
              style={{ background: 'var(--action-add)' }}
            >
              <Plus size={24} strokeWidth={3} />
            </span>
          </div>
          <div className="flex items-center justify-between mt-2 pointer-events-none">
            <span className="text-[11px] text-muted-foreground">Neue Seite</span>
          </div>
        </button>
      )}
    </div>
  );
}

// ── Card-Slot (Edit + Drag-Logik integriert) ──────────────────────────────
function CardSlot({
  card, accent, editMode, onTap, onDelete, onDragStart, onDragMove, onDragEnd, isDropTarget = false,
}: {
  card: CardDoc; accent: string; editMode: boolean;
  onTap?: () => void;
  onDelete?: () => void;
  onDragStart?: () => void;
  onDragMove?: (clientX: number, clientY: number) => void;
  /** Wird beim Drop aufgerufen — targetSlot ist die data-slot Nummer am Drop-Punkt, oder null. */
  onDragEnd?: (targetSlot: number | null) => void;
  /** Wenn true: ein anderer Slot wird gerade auf diesen hier gedraggt — visueller Hint. */
  isDropTarget?: boolean;
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; pid: number } | null>(null);
  // Geschwindigkeits-basierte Tilt-Animation: dragRot folgt sanft der horizontalen Velocity
  const [dragRot, setDragRot] = useState(0);
  const velRef = useRef<{ x: number; t: number } | null>(null);
  const elRef = useRef<HTMLDivElement>(null);

  const cleanup = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    dragStartRef.current = null;
    velRef.current = null;
    setDrag(null);
    setDragRot(0);
  };

  // Wrapper: macht 1:1-Translate ohne Transition (Finger-Tracking)
  // Inner: macht "Pickup"-Animation (Scale + Shadow + leichte Rotation) mit Transition
  return (
    <div
      ref={elRef}
      className="relative w-full aspect-[2.5/3.5]"
      style={{
        transform: drag ? `translate3d(${drag.x}px, ${drag.y}px, 0)` : undefined,
        transition: drag ? 'none' : 'transform 220ms cubic-bezier(.2,.9,.3,1)',
        zIndex: drag ? 50 : 1,
        touchAction: editMode ? 'none' : undefined,
        willChange: drag ? 'transform' : undefined,
      }}
      onPointerDown={e => {
        if (!editMode || !onDragEnd) return; // View-Mode → reiner Tap-Pfad
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        const pid = e.pointerId;
        cleanup();
        longPressTimer.current = setTimeout(() => {
          longPressTimer.current = null;
          try { (elRef.current as HTMLDivElement).setPointerCapture(pid); } catch {}
          setDrag({ x: 0, y: 0, pid });
          onDragStart?.();
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(15);
        }, 350);
      }}
      onPointerMove={e => {
        if (drag && e.pointerId === drag.pid && dragStartRef.current) {
          setDrag({
            x: e.clientX - dragStartRef.current.x,
            y: e.clientY - dragStartRef.current.y,
            pid: drag.pid,
          });
          // Velocity-basierte Tilt-Berechnung: schnelle horizontale Bewegung kippt die Karte
          const now = performance.now();
          if (velRef.current) {
            const dt = now - velRef.current.t;
            if (dt > 0) {
              const vx = (e.clientX - velRef.current.x) / dt; // px/ms
              const target = Math.max(-10, Math.min(10, vx * 18));
              // Sanft glätten — 30 % zur Ziel-Rotation, Rest zur Ruhelage
              setDragRot(prev => prev + (target - prev) * 0.35);
            }
          }
          velRef.current = { x: e.clientX, t: now };
          onDragMove?.(e.clientX, e.clientY);
          return;
        }
        if (longPressTimer.current && dragStartRef.current) {
          const dx = e.clientX - dragStartRef.current.x;
          const dy = e.clientY - dragStartRef.current.y;
          if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
            dragStartRef.current = null;
          }
        }
      }}
      onPointerUp={e => {
        if (drag) {
          const elements = document.elementsFromPoint(e.clientX, e.clientY);
          let target: number | null = null;
          for (const el of elements) {
            const ds = (el as HTMLElement).dataset?.slot;
            if (ds != null) { target = Number(ds); break; }
          }
          onDragEnd?.(target);
          cleanup();
          return;
        }
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
          onTap?.();
        }
        dragStartRef.current = null;
      }}
      onPointerCancel={() => {
        if (drag) onDragEnd?.(null);
        cleanup();
      }}
      onClick={e => { if (drag) e.stopPropagation(); }}
    >
      {/* Mid-Layer: Pickup-Animation (scale + velocity-rotation + shadow) */}
      <div
        className="absolute inset-0"
        style={{
          transform: drag
            ? `scale(1.10) rotate(${dragRot}deg)`
            : isDropTarget ? 'scale(1.04)' : 'scale(1) rotate(0deg)',
          transition: drag
            ? 'transform 80ms linear, box-shadow 180ms ease-out'
            : 'transform 220ms cubic-bezier(.2,.9,.3,1), box-shadow 220ms ease-out',
          willChange: 'transform',
        }}
      >
        {/* Inner-Layer: kontinuierliches Bobbing während Drag (gibt der Karte „Leben") */}
        <div
          className="relative w-full h-full rounded-xl overflow-hidden border"
          style={{
            borderColor: isDropTarget ? accent : `${accent}55`,
            borderWidth: isDropTarget ? 2 : 1,
            background: '#1a1a1a',
            boxShadow: drag
              ? '0 16px 36px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.3)'
              : isDropTarget ? `0 0 0 4px ${accent}30` : undefined,
            animation: drag
              ? 'binder-card-bob 1.1s ease-in-out infinite'
              : editMode ? 'binder-wiggle 0.5s ease-in-out infinite alternate' : undefined,
            transition: 'border-color 150ms ease-out, box-shadow 220ms ease-out',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.tcgImageUrl ?? `https://images.pokemontcg.io/${card.setId}/${card.number.split('/')[0]}_hires.png`}
            alt={card.name}
            className="w-full h-full object-cover pointer-events-none"
            draggable={false}
          />
          {card.quantity > 1 && !editMode && (
            <div className="absolute top-1 right-1 text-[9px] font-bold px-1 py-0.5 rounded bg-black/70 text-white">
              ×{card.quantity}
            </div>
          )}
          {editMode && onDelete && !drag && (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="absolute top-1 right-1 w-7 h-7 rounded-md flex items-center justify-center shadow-md text-white"
              style={{ background: 'var(--action-delete)' }}
              aria-label="Aus Slot entfernen"
            >
              <X size={14} strokeWidth={3} />
            </button>
          )}
          <div
            className="absolute bottom-0 left-0 right-0 px-1 pb-1 pt-3 pointer-events-none"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,.7), transparent)' }}
          >
            <div className="text-[9px] text-white/80 truncate">{card.number}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Empty-Slot ────────────────────────────────────────────────────────────
function EmptySlot({ n, editMode, onAdd }: { n: number; editMode: boolean; onAdd?: () => void }) {
  return (
    <div
      className="relative rounded-xl border border-dashed border-border aspect-[2.5/3.5] w-full"
      style={{ background: 'var(--secondary)' }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {editMode && onAdd ? (
          <button
            onClick={onAdd}
            className="w-12 h-12 rounded-full flex items-center justify-center shadow-md text-white"
            style={{ background: 'var(--action-add)' }}
            aria-label="Karte hinzufügen"
          >
            <Plus size={24} strokeWidth={3} />
          </button>
        ) : (
          <span className="text-muted-foreground/30 text-lg">{n}</span>
        )}
      </div>
    </div>
  );
}

// ── Page Detail ───────────────────────────────────────────────────────────
function PageDetail({
  pages, pageIdx, cols, cardsById, accent, editMode,
  onChangePageIdx, onSwapInPage, onClearSlot, onAddToSlot, onBack, onCardTap,
}: {
  pages: BinderPage[]; pageIdx: number; cols: number;
  cardsById: Map<string, CardDoc>; accent: string; editMode: boolean;
  onChangePageIdx: (i: number) => void;
  onSwapInPage: (slotA: number, slotB: number) => void;
  onClearSlot: (slot: number) => void;
  onAddToSlot: (slot: number) => void;
  onBack: () => void;
  onCardTap: (c: CardDoc) => void;
}) {
  const page = pages[pageIdx];
  const totalPages = pages.length;
  // Welcher Slot wird gerade als Drop-Ziel von einem laufenden Card-Drag „getroffen"?
  const [hoverTarget, setHoverTarget] = useState<number | null>(null);
  const [draggingFrom, setDraggingFrom] = useState<number | null>(null);

  if (!page) {
    return <div className="px-4 py-8 text-center text-muted-foreground">Keine Seite</div>;
  }

  const computeHover = (clientX: number, clientY: number): number | null => {
    const elements = document.elementsFromPoint(clientX, clientY);
    for (const el of elements) {
      const ds = (el as HTMLElement).dataset?.slot;
      if (ds != null) return Number(ds);
    }
    return null;
  };

  return (
    <div>
      <div className="flex items-center justify-between px-4 pt-2 pb-3">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-md flex items-center justify-center"
          style={{ background: 'var(--secondary)' }}
          aria-label="Zurück zur Übersicht"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onChangePageIdx(Math.max(0, pageIdx - 1))}
            disabled={pageIdx === 0}
            className="w-8 h-8 rounded-md flex items-center justify-center disabled:opacity-30"
            style={{ background: 'var(--secondary)' }}
            aria-label="Vorherige Seite"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-mono text-muted-foreground tabular-nums">
            Seite {pageIdx + 1} / {totalPages}
          </span>
          <button
            onClick={() => onChangePageIdx(Math.min(totalPages - 1, pageIdx + 1))}
            disabled={pageIdx >= totalPages - 1}
            className="w-8 h-8 rounded-md flex items-center justify-center disabled:opacity-30"
            style={{ background: 'var(--secondary)' }}
            aria-label="Nächste Seite"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="w-9" />
      </div>

      <div
        className="grid gap-2 px-3 pb-6"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {page.slots.map((slotId, slotI) => {
          const card = slotId ? cardsById.get(slotId) : undefined;
          return (
            <div key={slotI} data-slot={slotI}>
              {card ? (
                <CardSlot
                  card={card}
                  accent={accent}
                  editMode={editMode}
                  onTap={() => onCardTap(card)}
                  onDelete={editMode ? () => onClearSlot(slotI) : undefined}
                  isDropTarget={draggingFrom != null && draggingFrom !== slotI && hoverTarget === slotI}
                  onDragStart={editMode ? () => setDraggingFrom(slotI) : undefined}
                  onDragMove={editMode ? (cx, cy) => {
                    const t = computeHover(cx, cy);
                    setHoverTarget(t !== slotI ? t : null);
                  } : undefined}
                  onDragEnd={editMode ? (target) => {
                    setDraggingFrom(null);
                    setHoverTarget(null);
                    if (target != null && target !== slotI) onSwapInPage(slotI, target);
                  } : undefined}
                />
              ) : (
                <EmptySlot
                  n={pageIdx * page.slots.length + slotI + 1}
                  editMode={editMode}
                  onAdd={editMode ? () => onAddToSlot(slotI) : undefined}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
