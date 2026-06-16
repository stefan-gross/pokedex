'use client';

import { useState, useEffect, useMemo, useRef, use, useCallback } from 'react';
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
import {
  getBinder, deleteBinder, setBinderPages, cardIdsToPages,
  ensureDefaultBinder, addCardToBinder,
} from '@/lib/firestore/binders';
import { getCard } from '@/lib/firestore/cards';
import { getCatalogCardsByIds } from '@/lib/firestore/catalog';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { CreateBinderModal } from '@/components/binder/CreateBinderModal';
import { BinderIcon } from '@/lib/binder-icons';
import { binderSizeLabel, binderSizeCols, type BinderSize } from '@/lib/binder-sizes';
import {
  pagesToSheets, sheetsToPages, ensureEvenPages, pagesToSpreads, spreadLabel,
  type BookSpread,
} from '@/lib/binder-sheets';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { BinderSlotPickerModal } from '@/components/binder/BinderSlotPickerModal';
import type { BinderDoc, BinderPage, CardDoc } from '@/types';

interface Props {
  params: Promise<{ id: string }>;
}

type View = 'binder' | 'spread' | 'grid';

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
  const [spreadIdx, setSpreadIdx] = useState<number>(0);
  const [editMode, setEditMode] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<{ pageIdx: number; slotIdx: number } | null>(null);
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
    const rawPages = b.pages && b.pages.length > 0 ? b.pages : cardIdsToPages(b.cardIds, size);
    // Pages immer gerade Anzahl — Sheets sind Vorder+Rück-Paare
    setPages(ensureEvenPages(rawPages, size));
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

  const assignSlot = (pageIdx: number, slotIdx: number, cardDocId: string) => {
    const next = pages.map(p => ({ slots: [...p.slots] }));
    if (!next[pageIdx]) return;
    next[pageIdx].slots[slotIdx] = cardDocId;
    persistPages(next);
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
        `Sie werden zurück in „Meine Sammlung" verschoben. Fortfahren?`
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
    // Spread-Index korrigieren falls über das Ende hinaus
    const newTotalSheets = safe.length / 2;
    if (spreadIdx > newTotalSheets) setSpreadIdx(Math.max(0, newTotalSheets));
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

  const binderColor = binder.color ?? 'var(--pokedex-red)';
  const layoutCols = binderSizeCols(binderSize);
  const layoutLabel = isBox ? 'Box' : binderSizeLabel(binderSize);
  const totalCapacity = isBox ? null : (binder.capacity ?? null);
  const sheets = pagesToSheets(pages, binderSize);
  const spreads = pagesToSpreads(pages);

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
            <span className="text-[36px] font-extrabold tabular-nums" style={{ color: binderColor }}>
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
              <ViewBtn icon={<BookOpen size={15} />} active={view === 'binder'} onClick={() => { setView('binder'); setEditMode(false); }} color={binderColor} label="Blätter" />
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
            <button onClick={() => { setShowActions(false); setShowEdit(true); }} className="w-full px-4 py-3 text-sm text-left hover:bg-secondary">
              Bearbeiten
            </button>
            {!binder.isDefault && (
              <button onClick={() => { setShowActions(false); handleDelete(); }} className="w-full px-4 py-3 text-sm text-left text-destructive hover:bg-secondary">
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
          sheets={sheets}
          cols={layoutCols}
          cardsById={cardsById}
          accent={binderColor}
          editMode={editMode}
          onOpenSheet={(sheetIdx) => {
            // Sheet n öffnet Spread, das die Vorderseite (page 2n) zeigt.
            // Spread 0 zeigt Vorder Blatt 1 (allein). Spread k zeigt Rück Blatt k + Vorder Blatt k+1.
            // Wir wollen also: Vorder Blatt n+1 sichtbar → spread n (Buch-Anfang) wenn n=0, sonst spread n.
            setSpreadIdx(sheetIdx === 0 ? 0 : sheetIdx);
            setView('spread');
          }}
          onAddSheet={addSheet}
          onDeleteSheet={deleteSheet}
          onMoveSheet={moveSheetByIds}
        />
      ) : (
        <SpreadView
          spreads={spreads}
          spreadIdx={Math.min(spreadIdx, spreads.length - 1)}
          cols={layoutCols}
          binderSize={binderSize}
          cardsById={cardsById}
          accent={binderColor}
          editMode={editMode}
          onChangeSpread={setSpreadIdx}
          onSwap={swapSlots}
          onClearSlot={clearSlot}
          onAddToSlot={(pageIdx, slotIdx) => setPickerSlot({ pageIdx, slotIdx })}
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

// ── Sheet-Tile (Vorder + Rück mit Ringen an beiden Außenrändern) ──────────
function SheetTile({
  sheet, cols, cardsById, accent, editMode, onOpen, onDelete, isOverlay,
}: {
  sheet: { front: BinderPage; back: BinderPage; sheetIdx: number };
  cols: number;
  cardsById: Map<string, CardDoc>;
  accent: string;
  editMode: boolean;
  onOpen?: () => void;
  onDelete?: () => void;
  isOverlay?: boolean;
}) {
  const slotsFilled = sheet.front.slots.filter(Boolean).length + sheet.back.slots.filter(Boolean).length;
  const slotsTotal = sheet.front.slots.length + sheet.back.slots.length;
  return (
    <div
      className="bg-card rounded-xl border shadow-card p-2"
      style={{
        borderColor: isOverlay ? accent : 'var(--border)',
        borderStyle: 'solid',
        borderWidth: isOverlay ? 2 : 1,
        cursor: editMode ? undefined : 'pointer',
      }}
      onClick={() => { if (!editMode && onOpen) onOpen(); }}
    >
      <div className="flex items-stretch gap-1.5">
        <RingsCol />
        <div className="flex-1 min-w-0">
          <MiniPageGrid slots={sheet.front.slots} cols={cols} cardsById={cardsById} />
          <div className="text-[9px] text-center text-muted-foreground/70 mt-1">Vorder</div>
        </div>
        {/* Buchrücken-Knick */}
        <div className="self-stretch w-px bg-border" />
        <div className="flex-1 min-w-0">
          <MiniPageGrid slots={sheet.back.slots} cols={cols} cardsById={cardsById} />
          <div className="text-[9px] text-center text-muted-foreground/70 mt-1">Rück</div>
        </div>
        <RingsCol />
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[11px] text-muted-foreground">
          Blatt {sheet.sheetIdx + 1}
          {' · '}
          <span className="tabular-nums">
            {slotsFilled}/{slotsTotal}
          </span>
        </span>
        {editMode && onDelete && (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white"
            style={{ background: 'var(--action-delete)' }}
            aria-label="Blatt löschen"
          >
            <X size={11} strokeWidth={3} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Binder Overview — Sheets als Sortable mit dnd-kit ─────────────────────
function BinderOverview({
  sheets, cols, cardsById, accent, editMode,
  onOpenSheet, onAddSheet, onDeleteSheet, onMoveSheet,
}: {
  sheets: { front: BinderPage; back: BinderPage; sheetIdx: number }[];
  cols: number;
  cardsById: Map<string, CardDoc>;
  accent: string;
  editMode: boolean;
  onOpenSheet: (sheetIdx: number) => void;
  onAddSheet: () => void;
  onDeleteSheet: (sheetIdx: number) => void;
  onMoveSheet: (fromId: string, toId: string) => void;
}) {
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
              accent={accent}
              editMode={editMode}
              onOpen={() => onOpenSheet(sheet.sheetIdx)}
              onDelete={() => onDeleteSheet(sheet.sheetIdx)}
            />
          ))}

          {editMode && (
            <button
              onClick={onAddSheet}
              className="relative bg-card rounded-xl border-2 border-dashed border-border p-2"
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
                <span
                  className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg text-white"
                  style={{ background: 'var(--action-add)' }}
                >
                  <Plus size={24} strokeWidth={3} />
                </span>
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground text-center">Neues Blatt</div>
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
                  <SheetTile sheet={s} cols={cols} cardsById={cardsById} accent={accent} editMode={false} isOverlay />
                </div>
              );
            })()
          : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableSheetTile({
  id, sheet, cols, cardsById, accent, editMode, onOpen, onDelete,
}: {
  id: string;
  sheet: { front: BinderPage; back: BinderPage; sheetIdx: number };
  cols: number;
  cardsById: Map<string, CardDoc>;
  accent: string;
  editMode: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id,
    disabled: !editMode,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    animation: editMode && !isDragging && !isOver ? 'binder-wiggle 0.5s ease-in-out infinite alternate' : undefined,
    touchAction: editMode ? 'none' : undefined,
    borderColor: isOver ? accent : undefined,
    borderStyle: isOver ? 'dashed' : undefined,
    borderWidth: isOver ? 2 : undefined,
    boxShadow: isOver ? `0 0 0 4px ${accent}40` : undefined,
    scale: isOver ? '1.02' : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <SheetTile
        sheet={sheet}
        cols={cols}
        cardsById={cardsById}
        accent={accent}
        editMode={editMode}
        onOpen={onOpen}
        onDelete={onDelete}
      />
    </div>
  );
}

// ── Spread View — Doppelseite mit Karten-Drag über beide Seiten ───────────
type FlipState = { dir: 'forward' | 'backward'; progress: number; committing: boolean } | null;

function SpreadView({
  spreads, spreadIdx, cols, binderSize, cardsById, accent, editMode,
  onChangeSpread, onSwap, onClearSlot, onAddToSlot, onBack, onCardTap,
}: {
  spreads: BookSpread[]; spreadIdx: number; cols: number; binderSize: number;
  cardsById: Map<string, CardDoc>; accent: string; editMode: boolean;
  onChangeSpread: (i: number) => void;
  onSwap: (pA: number, sA: number, pB: number, sB: number) => void;
  onClearSlot: (pageIdx: number, slotIdx: number) => void;
  onAddToSlot: (pageIdx: number, slotIdx: number) => void;
  onBack: () => void;
  onCardTap: (c: CardDoc) => void;
}) {
  const spread = spreads[spreadIdx];
  const totalSpreads = spreads.length;
  const [activeSlot, setActiveSlot] = useState<{ pageIdx: number; slotIdx: number } | null>(null);

  // Buch-Blätter-State
  const [flip, setFlip] = useState<FlipState>(null);
  const flipStartRef = useRef<{ x: number; y: number; w: number; locked: boolean } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
  );

  if (!spread) {
    return <div className="px-4 py-8 text-center text-muted-foreground">Keine Seite</div>;
  }

  const activeCard = activeSlot && spread
    ? cardsById.get(
        (activeSlot.pageIdx === spread.leftPageIdx ? spread.left : spread.right)
          ?.slots[activeSlot.slotIdx] ?? ''
      )
    : null;

  // ── Page-Renderer (für Spread-Layout, optional DnD-Slots) ──────────────
  const renderSpreadSide = (
    page: BinderPage | null,
    pageIdx: number | null,
    side: 'left' | 'right',
  ) => {
    if (!page || pageIdx == null) {
      return (
        <div
          className="flex-1 rounded-lg border border-dashed border-border bg-secondary/30"
          style={{ minHeight: 200, opacity: 0.4 }}
          aria-hidden
        />
      );
    }
    return (
      <div
        className="flex-1 grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {page.slots.map((slotId, slotI) => {
          const card = slotId ? cardsById.get(slotId) : undefined;
          const slotKey = `slot-${pageIdx}-${slotI}`;
          return card ? (
            <DraggableCardSlot
              key={slotKey}
              id={slotKey}
              card={card}
              accent={accent}
              editMode={editMode}
              isDragging={activeSlot?.pageIdx === pageIdx && activeSlot?.slotIdx === slotI}
              onTap={() => onCardTap(card)}
              onDelete={() => onClearSlot(pageIdx, slotI)}
            />
          ) : (
            <DroppableEmptySlot
              key={slotKey}
              id={slotKey}
              n={pageIdx * binderSize + slotI + 1}
              editMode={editMode}
              accent={accent}
              onAdd={() => onAddToSlot(pageIdx, slotI)}
            />
          );
        })}
      </div>
    );
  };

  const renderSpread = (sp: BookSpread, key: string) => (
    <div key={key} className="flex items-stretch gap-1 px-2">
      <RingsCol />
      {renderSpreadSide(sp.left, sp.leftPageIdx, 'left')}
      <div className="self-stretch w-px bg-border my-1" />
      {renderSpreadSide(sp.right, sp.rightPageIdx, 'right')}
      <RingsCol />
    </div>
  );

  // ── Flip-Pointer-Handlers (View-Mode only) ─────────────────────────────
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
    const dir: 'forward' | 'backward' = dx < 0 ? 'forward' : 'backward';
    if (dir === 'forward' && spreadIdx >= totalSpreads - 1) return;
    if (dir === 'backward' && spreadIdx === 0) return;
    const progress = Math.max(0, Math.min(1, Math.abs(dx) / flipStartRef.current.w));
    setFlip({ dir, progress, committing: false });
  };
  const onFlipUp = () => {
    if (!flipStartRef.current) return;
    flipStartRef.current = null;
    if (!flip) return;
    if (flip.progress > 0.35) {
      const target = flip.dir === 'forward' ? spreadIdx + 1 : spreadIdx - 1;
      setFlip({ ...flip, progress: 1, committing: true });
      setTimeout(() => { onChangeSpread(target); setFlip(null); }, 350);
    } else {
      setFlip({ ...flip, progress: 0, committing: true });
      setTimeout(() => setFlip(null), 250);
    }
  };

  // Layout-Berechnungen für Flip-Layers
  const showFlip = flip != null;
  const rotatingSpread = !showFlip ? spread
    : flip.dir === 'forward' ? spread : spreads[spreadIdx - 1];
  const underneathSpread = !showFlip ? null
    : flip.dir === 'forward' ? spreads[spreadIdx + 1] : spread;
  const rotation = !showFlip ? 0
    : flip.dir === 'forward' ? -180 * flip.progress : -180 * (1 - flip.progress);
  const flipTransition = flip?.committing ? 'transform 350ms cubic-bezier(.4,.0,.2,1)' : 'none';

  return (
    <div>
      <div className="flex items-center justify-between px-4 pt-2 pb-3">
        <button onClick={onBack} className="w-9 h-9 rounded-md flex items-center justify-center" style={{ background: 'var(--secondary)' }} aria-label="Zurück">
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChangeSpread(Math.max(0, spreadIdx - 1))}
            disabled={spreadIdx === 0}
            className="w-8 h-8 rounded-md flex items-center justify-center disabled:opacity-30"
            style={{ background: 'var(--secondary)' }}
            aria-label="Vorherige Doppelseite"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] font-mono text-muted-foreground tabular-nums whitespace-nowrap">
            {spreadLabel(spread)}
          </span>
          <button
            onClick={() => onChangeSpread(Math.min(totalSpreads - 1, spreadIdx + 1))}
            disabled={spreadIdx >= totalSpreads - 1}
            className="w-8 h-8 rounded-md flex items-center justify-center disabled:opacity-30"
            style={{ background: 'var(--secondary)' }}
            aria-label="Nächste Doppelseite"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="w-9" />
      </div>

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
          {renderSpread(spread, 'edit')}

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
                  width: 80,
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
      ) : (
        <div
          className="relative"
          style={{ perspective: '2000px', touchAction: 'pan-y' }}
          onPointerDown={onFlipDown}
          onPointerMove={onFlipMove}
          onPointerUp={onFlipUp}
          onPointerCancel={onFlipUp}
        >
          {showFlip && underneathSpread && (
            <div className="absolute inset-0">
              {renderSpread(underneathSpread, 'under')}
            </div>
          )}
          <div
            style={{
              transform: `rotateY(${rotation}deg)`,
              transformOrigin: 'left center',
              transition: flipTransition,
              backfaceVisibility: 'hidden',
              willChange: showFlip ? 'transform' : undefined,
              boxShadow: showFlip
                ? `${-Math.abs(rotation) * 0.2}px 0 ${Math.abs(rotation) * 0.4}px rgba(0,0,0,0.3)`
                : undefined,
            }}
          >
            {renderSpread(rotatingSpread, 'top')}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Draggable Card-Slot ───────────────────────────────────────────────────
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
      className="relative rounded-xl overflow-hidden aspect-[2.5/3.5] w-full"
      style={{
        borderColor: isOver ? accent : `${accent}55`,
        borderStyle: isOver ? 'dashed' : 'solid',
        borderWidth: isOver ? 2 : 1,
        background: '#1a1a1a',
        opacity: isDragging ? 0.3 : 1,
        boxShadow: isOver ? `0 0 0 4px ${accent}40` : undefined,
        transform: isOver ? 'scale(1.04)' : undefined,
        transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out',
        animation: editMode && !isDragging && !isOver ? 'binder-wiggle 0.5s ease-in-out infinite alternate' : undefined,
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
          className="absolute top-0.5 right-0.5 w-5 h-5 rounded-md flex items-center justify-center shadow-md text-white"
          style={{ background: 'var(--action-delete)' }}
          aria-label="Aus Slot entfernen"
        >
          <X size={10} strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

// ── Droppable Empty-Slot ──────────────────────────────────────────────────
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
            className="w-8 h-8 rounded-full flex items-center justify-center shadow-md text-white"
            style={{ background: 'var(--action-add)' }}
            aria-label="Karte hinzufügen"
          >
            <Plus size={16} strokeWidth={3} />
          </button>
        ) : (
          <span className="text-muted-foreground/30 text-xs">{n}</span>
        )}
      </div>
    </div>
  );
}
