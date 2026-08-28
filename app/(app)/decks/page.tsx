'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Trash2, Check, Layers } from 'lucide-react';
import {
  DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getDecks, deleteDeck, reorderDecks } from '@/lib/firestore/decks';
import { getCatalogCardsByIds, type CatalogCard } from '@/lib/firestore/catalog';
import { computeDeckStats } from '@/lib/decks/stats';
import { CreateDeckModal } from '@/components/deck/CreateDeckModal';
import { CollectionDeckToggle } from '@/components/deck/CollectionDeckToggle';
import { BinderCover } from '@/components/binder/BinderCover';
import { Button } from '@/components/ui/button';
import { tintedGlassStyle } from '@/lib/ui/tinted-glass';
import { readableTextColor } from '@/lib/color-utils';
import { formatEUR } from '@/lib/format';
import type { DeckDoc } from '@/types';

const FORMAT_LABEL: Record<string, string> = { standard: 'Standard', expanded: 'Expanded', unlimited: 'Unlimited' };

export default function DecksPage() {
  const [decks, setDecks] = useState<DeckDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editDeck, setEditDeck] = useState<DeckDoc | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [catalog, setCatalog] = useState<Map<string, CatalogCard>>(new Map());

  const load = async () => {
    try {
      const data = await getDecks();
      setDecks([...data].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
    } catch (e) {
      console.error('[decks] load error', e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Katalog für die Deckkarten nicht-blockierend nachladen — nur für den
  // Wert-€ in der Banderole. Cover/Namen stehen davon unabhängig sofort.
  useEffect(() => {
    const ids = [...new Set(decks.flatMap(d => d.cards.map(c => c.catalogId)))];
    if (ids.length === 0) return;
    getCatalogCardsByIds(ids)
      .then(cs => setCatalog(new Map(cs.map(c => [c.id, c]))))
      .catch(() => {});
  }, [decks]);

  const deckMeta = useMemo(() => {
    const m = new Map<string, { total: number; value: number }>();
    for (const d of decks) {
      const total = d.cards.reduce((s, c) => s + c.count, 0);
      const value = catalog.size ? computeDeckStats(d.cards, catalog).totalValueEur : 0;
      m.set(d.id, { total, value });
    }
    return m;
  }, [decks, catalog]);

  const handleDelete = async (deck: DeckDoc) => {
    if (!confirm(`Deck „${deck.name}" löschen?`)) return;
    await deleteDeck(deck.id);
    load();
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 16 } }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = decks.findIndex(d => d.id === active.id);
    const to = decks.findIndex(d => d.id === over.id);
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(decks, from, to);
    setDecks(reordered);   // optimistisch
    reorderDecks(reordered.map(d => d.id)).catch(err => {
      console.error('[decks] reorder error', err);
      load();
    });
  };

  return (
    <div className="px-4 pt-safe pb-nav">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pt-4 pb-3">
        <h1 className="text-2xl font-bold">Decks</h1>
        <div className="flex items-center gap-2">
          {decks.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => setEditMode(m => !m)}
              icon={editMode ? <Check size={18} /> : <Pencil size={18} />}
              aria-label={editMode ? 'Fertig' : 'Bearbeiten'}
            />
          )}
          <Button
            variant="primary"
            accentColor="#2f855a"
            onClick={() => setCreateOpen(true)}
            icon={<Plus size={18} strokeWidth={2.6} />}
            aria-label="Deck erstellen"
          />
        </div>
      </div>

      <div className="mb-4"><CollectionDeckToggle /></div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] rounded-2xl animate-pulse bg-[rgba(30,40,80,0.08)] dark:bg-white/10" />
          ))}
        </div>
      ) : decks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 text-center py-16 text-muted-foreground">
          <Layers size={40} strokeWidth={1.5} />
          <p className="max-w-xs">Noch keine Decks. Leg dein erstes spielbares 60-Karten-Deck an.</p>
          <Button variant="primary" accentColor="#2f855a" onClick={() => setCreateOpen(true)} icon={<Plus size={16} strokeWidth={2.6} />}>
            Deck erstellen
          </Button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={decks.map(d => d.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-3">
              {decks.map(deck => (
                <DeckTile
                  key={deck.id}
                  deck={deck}
                  meta={deckMeta.get(deck.id) ?? { total: 0, value: 0 }}
                  editMode={editMode}
                  onDelete={() => handleDelete(deck)}
                  onEdit={() => setEditDeck(deck)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {(createOpen || editDeck) && (
        <CreateDeckModal
          existing={editDeck ?? undefined}
          onClose={() => { setCreateOpen(false); setEditDeck(null); }}
          onSaved={load}
        />
      )}
    </div>
  );
}

function DeckTile({ deck, meta, editMode, onDelete, onEdit }: {
  deck: DeckDoc;
  meta: { total: number; value: number };
  editMode: boolean;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deck.id, disabled: !editMode });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    touchAction: editMode ? 'none' : undefined,
  };
  const color = deck.color ?? '#4299e1';
  const banderole = tintedGlassStyle(color, { alpha: 0.9 });
  const textColor = readableTextColor(color);

  const inner = (
    <>
      <BinderCover color={color} name={deck.name} icon={deck.icon} />
      <div className="flex items-center justify-between px-2.5 py-1.5 text-[11px] font-semibold" style={{ ...banderole, color: textColor }}>
        <span>{meta.total}/60</span>
        <span className="opacity-80">{FORMAT_LABEL[deck.format] ?? deck.format}</span>
        <span>{formatEUR(meta.value)}</span>
      </div>
    </>
  );

  return (
    <div ref={setNodeRef} style={style} className="relative rounded-2xl overflow-hidden shadow-sm" {...(editMode ? { ...attributes, ...listeners } : {})}>
      {editMode ? (
        <div className="cursor-grab">
          {inner}
          <div className="absolute top-1.5 right-1.5 flex gap-1.5">
            <button onClick={onEdit} className="w-8 h-8 rounded-full flex items-center justify-center glass-overlay" aria-label="Deck bearbeiten">
              <Pencil size={14} color="#fff" />
            </button>
            <button onClick={onDelete} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--action-delete)' }} aria-label="Deck löschen">
              <Trash2 size={14} color="#fff" />
            </button>
          </div>
        </div>
      ) : (
        <Link href={`/decks/${deck.id}`} className="block">{inner}</Link>
      )}
    </div>
  );
}
