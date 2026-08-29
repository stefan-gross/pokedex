'use client';

import { useState, useEffect, useMemo, useId } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Trash2, Check, Layers } from 'lucide-react';
import {
  DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getDecks, deleteDeckCascade, reorderDecks } from '@/lib/firestore/decks';
import { getCatalogCardsByIds, type CatalogCard } from '@/lib/firestore/catalog';
import { computeDeckStats } from '@/lib/decks/stats';
import { CreateDeckModal } from '@/components/deck/CreateDeckModal';
import { CollectionDeckToggle } from '@/components/deck/CollectionDeckToggle';
import { BoxCover } from '@/components/binder/BinderCover';
import { Button } from '@/components/ui/button';
import { readableTextColor, lightenColor } from '@/lib/color-utils';
import { formatEUR } from '@/lib/format';

// Banderole (wie Sammlungs-Boxen): eigene, etwas hellere Farbfläche unten.
const BANDEROLE_GAP = 6;
const BANDEROLE_HEIGHT = 28;
const BANDEROLE_SMALL_RADIUS = 1.5;
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
    await deleteDeckCascade(deck.id);
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
    <div className="min-h-screen pb-nav">
      {/* Header-Panel (Glas) — Aufbau wie /binders, damit der Umschalter beim
          Wechseln nicht springt; Umschalter als zweite Zeile integriert. */}
      <div className="sticky top-safe z-20 px-3 pt-3 pb-1">
        <div className="glass rounded-[20px] px-4 pt-3 pb-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.18)]">Meine Karten</h1>
            </div>
            {editMode ? (
              <Button variant="primary" accentColor="#2f855a" onClick={() => setEditMode(false)} icon={<Check />} aria-label="Fertig" className="shrink-0" />
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="primary" accentColor="#2f855a" onClick={() => setCreateOpen(true)} icon={<Plus strokeWidth={2.5} />} aria-label="Deck erstellen" />
                {decks.length > 0 && <Button variant="secondary" onClick={() => setEditMode(true)} icon={<Pencil />} aria-label="Bearbeiten" />}
              </div>
            )}
          </div>
          <CollectionDeckToggle deckCount={loading ? undefined : decks.length} />
        </div>
      </div>

      <div className="px-4 py-4">
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
      </div>

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
  const bandColor = lightenColor(color, 0.14);
  const bandTextColor = readableTextColor(bandColor);
  const grainUid = useId().replace(/:/g, '');

  // Box-Cover (wie Sammlungs-Boxen) + Banderole mit X/60 · Format · €.
  const cover = (
    <div className="relative" style={{ transform: 'scale(0.92)', transformOrigin: 'center' }}>
      <BoxCover color={color} name={deck.name} icon={deck.icon ?? 'box'} reserveBottom={BANDEROLE_HEIGHT + BANDEROLE_GAP} />

      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <filter id={`deck-band-grain-${grainUid}`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.1 0.1 0.1 0 0" result="grain" />
            <feComposite in="grain" in2="SourceAlpha" operator="in" result="grainClipped" />
            <feBlend in="SourceGraphic" in2="grainClipped" mode="multiply" />
          </filter>
        </defs>
      </svg>

      <div
        className="absolute flex items-center justify-between gap-1.5 px-3"
        style={{
          paddingTop: 6, paddingBottom: 6,
          bottom: BANDEROLE_GAP,
          left: 'calc(7 / 300 * 100% - 1px)',
          right: 'calc(7 / 300 * 100% - 1px)',
          background: bandColor,
          boxShadow: '0 3px 6px rgba(0,0,0,.35)',
          filter: `url(#deck-band-grain-${grainUid})`,
          borderRadius: BANDEROLE_SMALL_RADIUS,
        }}
      >
        <span className="font-bold tabular-nums" style={{ fontSize: 12, color: bandTextColor }}>{meta.total}/60</span>
        <span className="font-semibold truncate" style={{ fontSize: 11, color: bandTextColor, opacity: 0.85 }}>{FORMAT_LABEL[deck.format] ?? deck.format}</span>
        <span className="font-bold tabular-nums shrink-0" style={{ fontSize: 12, color: bandTextColor }}>{formatEUR(meta.value)}</span>
      </div>

      {editMode && (
        <>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
            className="absolute -top-1 -left-1 w-11 h-11 rounded-full flex items-center justify-center text-white ring-2 ring-white shadow-lg active:scale-90 transition-transform"
            style={{ background: '#dc2626' }}
            aria-label="Deck löschen"
          >
            <Trash2 size={18} strokeWidth={2.5} />
          </button>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
            className="absolute -top-1 -right-1 w-11 h-11 rounded-full flex items-center justify-center glass-overlay ring-2 ring-white shadow-lg active:scale-90 transition-transform"
            aria-label="Deck bearbeiten"
          >
            <Pencil size={17} color="#fff" strokeWidth={2.4} />
          </button>
        </>
      )}
    </div>
  );

  return (
    <div ref={setNodeRef} style={style} className="relative no-callout" {...(editMode ? { ...attributes, ...listeners } : {})}>
      {editMode ? (
        <div className="cursor-grab">{cover}</div>
      ) : (
        <Link href={`/decks/${deck.id}`} className="block active:scale-[.98] transition-transform">{cover}</Link>
      )}
    </div>
  );
}
