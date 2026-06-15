'use client';

import { useState, useEffect, useMemo, use, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, Settings, LayoutGrid, BookOpen, Pencil, Eye,
  Plus, X, ChevronRight,
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
    try { await setBinderPages(id, newPages); }
    catch (e) { console.error('[binder] persistPages error', e); }
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

  // ── Slot-Operationen ────────────────────────────────────────────────────
  const swapSlots = (slotA: number, slotB: number) => {
    if (slotA === slotB) return;
    const next = pages.map(p => ({ slots: [...p.slots] }));
    const cur = next[pageIdx];
    if (!cur) return;
    [cur.slots[slotA], cur.slots[slotB]] = [cur.slots[slotB], cur.slots[slotA]];
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

  // ── Page-Verwaltung ─────────────────────────────────────────────────────
  const addPage = () => persistPages([...pages, { slots: Array(binderSize).fill(null) }]);

  const deletePage = (i: number) => {
    const hasContent = pages[i].slots.some(s => !!s);
    if (hasContent && !confirm('Diese Seite enthält Karten. Wirklich löschen?')) return;
    const next = pages.filter((_, idx) => idx !== i);
    persistPages(next.length === 0 ? [{ slots: Array(binderSize).fill(null) }] : next);
    if (pageIdx >= next.length) setPageIdx(Math.max(0, next.length - 1));
  };

  const movePagesByIds = (fromId: string, toId: string) => {
    const from = Number(fromId.replace('page-', ''));
    const to   = Number(toId.replace('page-', ''));
    if (from === to) return;
    persistPages(arrayMove(pages, from, to));
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
      <div className="h-1.5 w-full" style={{ background: binderColor }} />

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
          onMovePage={movePagesByIds}
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

// ── Mini-Page-Grid ────────────────────────────────────────────────────────
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

// ── Binder Overview — Doppelseiten mit dnd-kit-Sortable ───────────────────
function BinderOverview({
  pages, binderSize, cols, cardsById, accent, editMode,
  onOpenPage, onAddPage, onDeletePage, onMovePage,
}: {
  pages: BinderPage[]; binderSize: number; cols: number;
  cardsById: Map<string, CardDoc>; accent: string; editMode: boolean;
  onOpenPage: (i: number) => void;
  onAddPage: () => void;
  onDeletePage: (i: number) => void;
  onMovePage: (fromId: string, toId: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const items = pages.map((_, i) => `page-${i}`);
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={(e: DragEndEvent) => {
        setActiveId(null);
        if (!e.over || e.over.id === e.active.id) return;
        onMovePage(String(e.active.id), String(e.over.id));
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={items} strategy={rectSortingStrategy}>
        <div className="px-3 pt-4 grid grid-cols-2 gap-3">
          {pages.map((page, pageI) => (
            <SortablePageTile
              key={`page-${pageI}`}
              id={`page-${pageI}`}
              pageI={pageI}
              page={page}
              binderSize={binderSize}
              cols={cols}
              cardsById={cardsById}
              accent={accent}
              editMode={editMode}
              onOpen={() => onOpenPage(pageI)}
              onDelete={() => onDeletePage(pageI)}
            />
          ))}

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
      </SortableContext>

      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(.2,.9,.3,1)' }}>
        {activeId
          ? (() => {
              const idx = Number(activeId.replace('page-', ''));
              const page = pages[idx];
              if (!page) return null;
              return (
                <div
                  className="bg-card rounded-xl border-2 shadow-2xl p-2 flex flex-col"
                  style={{ borderColor: accent, transform: 'rotate(-2deg) scale(1.05)' }}
                >
                  <MiniPageGrid slots={page.slots} cols={cols} cardsById={cardsById} />
                  <div className="mt-2 text-[11px] text-muted-foreground">Seite {idx + 1}</div>
                </div>
              );
            })()
          : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortablePageTile({
  id, pageI, page, binderSize, cols, cardsById, accent, editMode, onOpen, onDelete,
}: {
  id: string;
  pageI: number;
  page: BinderPage;
  binderSize: number;
  cols: number;
  cardsById: Map<string, CardDoc>;
  accent: string;
  editMode: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editMode,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    animation: editMode && !isDragging ? 'binder-wiggle 0.5s ease-in-out infinite alternate' : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-card rounded-xl border border-border shadow-card p-2 flex flex-col"
      onClick={() => { if (!editMode) onOpen(); }}
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
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDelete(); }}
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
}

// ── Page Detail — Slots als dnd-kit-Sortable (Swap-Semantik) ──────────────
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
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
  );

  if (!page) {
    return <div className="px-4 py-8 text-center text-muted-foreground">Keine Seite</div>;
  }

  const activeCard = activeSlot != null && page.slots[activeSlot]
    ? cardsById.get(page.slots[activeSlot]!)
    : null;

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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => {
          const slotI = Number(String(e.active.id).replace('slot-', ''));
          setActiveSlot(slotI);
        }}
        onDragEnd={(e: DragEndEvent) => {
          setActiveSlot(null);
          if (!e.over || e.over.id === e.active.id) return;
          const from = Number(String(e.active.id).replace('slot-', ''));
          const to   = Number(String(e.over.id).replace('slot-', ''));
          onSwapInPage(from, to);
        }}
        onDragCancel={() => setActiveSlot(null)}
      >
        <div
          className="grid gap-2 px-3 pb-6"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        >
          {page.slots.map((slotId, slotI) => {
            const card = slotId ? cardsById.get(slotId) : undefined;
            return card ? (
              <DraggableCardSlot
                key={slotI}
                id={`slot-${slotI}`}
                card={card}
                accent={accent}
                editMode={editMode}
                isDragging={activeSlot === slotI}
                onTap={() => onCardTap(card)}
                onDelete={() => onClearSlot(slotI)}
              />
            ) : (
              <DroppableEmptySlot
                key={slotI}
                id={`slot-${slotI}`}
                n={pageIdx * page.slots.length + slotI + 1}
                editMode={editMode}
                accent={accent}
                onAdd={() => onAddToSlot(slotI)}
              />
            );
          })}
        </div>

        <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(.2,.9,.3,1)' }}>
          {activeCard ? (
            <div
              className="rounded-xl overflow-hidden border-2"
              style={{
                borderColor: accent,
                background: '#1a1a1a',
                boxShadow: '0 16px 36px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.35)',
                transform: 'rotate(-2deg) scale(1.08)',
                aspectRatio: '2.5/3.5',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeCard.tcgImageUrl ?? `https://images.pokemontcg.io/${activeCard.setId}/${activeCard.number.split('/')[0]}_hires.png`}
                alt={activeCard.name}
                className="w-full h-full object-cover"
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// ── Draggable Card-Slot (dnd-kit) ─────────────────────────────────────────
function DraggableCardSlot({
  id, card, accent, editMode, isDragging, onTap, onDelete,
}: {
  id: string;
  card: CardDoc;
  accent: string;
  editMode: boolean;
  isDragging: boolean;
  onTap: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, isOver } = useSortable({
    id,
    disabled: !editMode,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(editMode ? listeners : {})}
      className="relative rounded-xl overflow-hidden border aspect-[2.5/3.5] w-full"
      style={{
        borderColor: isOver ? accent : `${accent}55`,
        borderWidth: isOver ? 2 : 1,
        background: '#1a1a1a',
        opacity: isDragging ? 0.3 : 1,
        boxShadow: isOver ? `0 0 0 4px ${accent}40` : undefined,
        transform: isOver ? 'scale(1.04)' : undefined,
        transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out',
        animation: editMode && !isDragging ? 'binder-wiggle 0.5s ease-in-out infinite alternate' : undefined,
        touchAction: editMode ? 'none' : undefined,
      }}
      onClick={() => { if (!editMode) onTap(); }}
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
      {editMode && !isDragging && (
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
  );
}

// ── Droppable Empty-Slot (dnd-kit) ────────────────────────────────────────
function DroppableEmptySlot({
  id, n, editMode, accent, onAdd,
}: {
  id: string;
  n: number;
  editMode: boolean;
  accent: string;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !editMode });
  return (
    <div
      ref={setNodeRef}
      className="relative rounded-xl border border-dashed aspect-[2.5/3.5] w-full"
      style={{
        background: 'var(--secondary)',
        borderColor: isOver ? accent : 'var(--border)',
        borderWidth: isOver ? 2 : 1,
        boxShadow: isOver ? `0 0 0 4px ${accent}40` : undefined,
        transform: isOver ? 'scale(1.04)' : undefined,
        transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out',
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {editMode ? (
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
