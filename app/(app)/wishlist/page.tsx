'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Heart, Plus, Check, Pencil, Trash2 } from 'lucide-react';
import {
  DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getWishlists, deleteWishlist, reorderWishlists, pruneOrphanTemplateWishlists } from '@/lib/firestore/wishlists';
import { getBinders } from '@/lib/firestore/binders';
import { ScrollToTopButton } from '@/components/ui/ScrollToTopButton';
import { LegendButton } from '@/components/ui/LegendButton';
import { Button } from '@/components/ui/button';
import { BinderIcon } from '@/lib/binder-icons';
import { AutomaticCornerBadge } from '@/components/binder/CollectionTypeBadge';
import { CreateWishlistModal } from '@/components/wishlist/CreateWishlistModal';
import { tintedGlassStyle } from '@/lib/ui/tinted-glass';
import { readableTextColor } from '@/lib/color-utils';
import type { WishlistDoc, BinderDoc } from '@/types';

/** Übersicht aller Wunschlisten — analog zur Sammlungsübersicht
 *  (app/(app)/binders/page.tsx): manuelle Listen zuerst (per DnD sortierbar,
 *  löschbar, neu anlegbar), automatische (Vorlagen-)Listen danach und gesperrt
 *  (Lock, nicht ziehbar/löschbar — Rolle wie der geschützte Default-Binder). */
export default function WishlistOverviewPage() {
  const [lists, setLists] = useState<WishlistDoc[]>([]);
  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [wl, bs] = await Promise.all([getWishlists(), getBinders()]);
      // Verwaiste Auto-Wunschlisten (Vorlagen-Sammlung gelöscht/umbenannt)
      // hier aufräumen — die Übersicht ist die Stelle, an der sie sichtbar
      // würden, und hat beide Datensätze bereits geladen (keine Race).
      const pruned = await pruneOrphanTemplateWishlists(wl, bs);
      setLists(pruned);
      setBinders(bs);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Automatische Wunschlisten erben Name/Icon/Farbe von ihrer Vorlagen-Sammlung
  // (templateBinderId) — Anzeige daher live aus dem Binder ableiten, nicht aus
  // ggf. veralteten Wunschlisten-Feldern.
  const binderById = useMemo(() => new Map(binders.map(b => [b.id, b])), [binders]);
  const displayMeta = useCallback((list: WishlistDoc): { name: string; icon?: string; color?: string } => {
    if (list.templateBinderId) {
      const b = binderById.get(list.templateBinderId);
      if (b) return { name: b.name, icon: b.icon, color: b.color };
    }
    return { name: list.name, icon: list.icon, color: list.color };
  }, [binderById]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 16 } }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const byId = new Map(lists.map(l => [l.id, l]));
    // Automatische Listen sind nicht sortierbar.
    if (byId.get(String(active.id))?.templateBinderId || byId.get(String(over.id))?.templateBinderId) return;
    const manual = lists.filter(l => !l.templateBinderId);
    const from = manual.findIndex(l => l.id === active.id);
    const to = manual.findIndex(l => l.id === over.id);
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(manual, from, to);
    const auto = lists.filter(l => !!l.templateBinderId);
    setLists([...reordered, ...auto]);   // optimistisch
    reorderWishlists(reordered.map(l => l.id)).catch(err => {
      console.error('[wishlists] reorder error', err);
      load();
    });
  };

  const handleDelete = async (list: WishlistDoc) => {
    if (list.templateBinderId) return;   // automatische Listen sind gesperrt
    if (list.items.length > 0 && !confirm(`Wunschliste „${list.name}" mit ${list.items.length} Karte(n) löschen?`)) return;
    await deleteWishlist(list.id);
    load();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex justify-center pt-16">
        <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <div className="sticky top-safe z-20 px-3 pt-3 pb-1">
        <div className="glass rounded-[20px] px-4 pt-3 pb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.18)]">Wunschlisten</h1>
            <p className="text-role-label text-glass-muted">{lists.length} {lists.length === 1 ? 'Liste' : 'Listen'}</p>
          </div>
          {editMode ? (
            <Button variant="primary" accentColor="#2f855a" onClick={() => setEditMode(false)} icon={<Check />} aria-label="Fertig" className="shrink-0" />
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="primary" accentColor="#2f855a" onClick={() => setCreateOpen(true)} icon={<Plus strokeWidth={2.5} />} aria-label="Neue Wunschliste" />
              <Button variant="secondary" onClick={() => setEditMode(true)} icon={<Pencil />} aria-label="Bearbeiten" />
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-4">
        {lists.length === 0 ? (
          <div className="text-center pt-16 space-y-3">
            <div className="flex justify-center"><Heart size={48} className="text-glass-muted" /></div>
            <p className="text-role-title text-glass">Noch keine Wunschliste</p>
            <button
              onClick={() => setCreateOpen(true)}
              className="mt-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
              style={tintedGlassStyle('#2f855a')}
            >
              Erste Wunschliste erstellen
            </button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={lists.map(l => l.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-3">
                {lists.map(list => (
                  <SortableWishlistTile
                    key={list.id}
                    list={list}
                    meta={displayMeta(list)}
                    editMode={editMode}
                    onDelete={() => handleDelete(list)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {createOpen && (
        <CreateWishlistModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); load(); }}
        />
      )}

      <ScrollToTopButton />
      <LegendButton symbols={['automatic']} />
    </div>
  );
}

function SortableWishlistTile({ list, meta, editMode, onDelete }: {
  list: WishlistDoc;
  /** Anzeige-Name/-Icon/-Farbe (bei Auto-Listen von der Sammlung geerbt). */
  meta: { name: string; icon?: string; color?: string };
  editMode: boolean;
  onDelete: () => void;
}) {
  const isTemplate = !!list.templateBinderId;
  const count = list.items.length;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: list.id,
    disabled: !editMode || isTemplate,
  });
  const dragEnabled = editMode && !isTemplate;
  // Nach einem (Touch-)Drag synthetisiert der Browser einen `click` auf den
  // <Link> — bei Touch greift das `preventDefault` im Link-onClick nicht
  // zuverlässig, sodass die Wunschliste sich sofort öffnet. Wir merken uns ein
  // gerade beendetes Ziehen und verschlucken den Folge-Klick in der
  // Capture-Phase des Wrappers (läuft VOR dem Anchor → blockt Navigation sicher).
  const justDraggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) { justDraggedRef.current = true; return; }
    if (justDraggedRef.current) {
      const t = setTimeout(() => { justDraggedRef.current = false; }, 400);
      return () => clearTimeout(t);
    }
  }, [isDragging]);
  // Sammlungsfarbe als Kachel-Hintergrund (geerbt bei Auto-Listen); Text/Icon
  // in kontrastierender Farbe. Ohne Farbe: neutrales Glas.
  const bg = meta.color;
  const fg = bg ? readableTextColor(bg) : undefined;
  // Bild-Icons (Pokémon-Artwork / Set-Logo) füllen die Kachelbreite (minus
  // Rand) wie auf den Sammlungs-Covern: `maxWidth:100%` skaliert responsiv und
  // läuft nie über. Gezeichnete Symbole (Lucide/Energie/Herz) bleiben klein.
  const isImageIcon = !!meta.icon && (meta.icon.startsWith('pokemon:') || meta.icon.startsWith('set:'));

  return (
    <div
      ref={setNodeRef}
      className="no-callout"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        touchAction: dragEnabled ? 'none' : undefined,
        zIndex: isDragging ? 10 : undefined,
      }}
      {...(dragEnabled ? attributes : {})}
      {...(dragEnabled ? listeners : {})}
      onClickCapture={e => {
        if (justDraggedRef.current) { e.preventDefault(); e.stopPropagation(); justDraggedRef.current = false; }
      }}
    >
      <Link
        href={`/wishlist/${list.id}`}
        onClick={e => { if (editMode) e.preventDefault(); }}
        onContextMenu={e => e.preventDefault()}
        className={`relative aspect-[3/4] rounded-2xl flex flex-col items-center justify-center gap-2 px-3 text-center active:scale-[.98] transition-transform ${bg ? '' : 'glass-inner'}`}
        style={bg ? { background: bg } : undefined}
      >
        {isTemplate && <AutomaticCornerBadge tlRadius={16} />}
        {meta.icon ? (
          isImageIcon ? (
            <div className="w-full px-2 flex justify-center">
              <BinderIcon
                name={meta.icon}
                size={176}
                style={{ ...(fg ? { color: fg } : {}), maxWidth: '100%', width: 'auto', height: 'auto', maxHeight: 176 }}
              />
            </div>
          ) : (
            <BinderIcon name={meta.icon} size={60} style={fg ? { color: fg } : undefined} />
          )
        ) : (
          <Heart size={60} style={fg ? { color: fg } : undefined} className={fg ? '' : 'text-glass-muted'} />
        )}
        <span className={`text-sm font-semibold truncate max-w-full ${fg ? '' : 'text-glass'}`} style={fg ? { color: fg } : undefined}>{meta.name}</span>
        <span className={`text-xs ${fg ? '' : 'text-glass-muted'}`} style={fg ? { color: fg, opacity: 0.75 } : undefined}>{count} {count === 1 ? 'Karte' : 'Karten'}</span>

        {editMode && !isTemplate && (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
            className="absolute -top-1 -left-1 w-11 h-11 rounded-full flex items-center justify-center text-white ring-2 ring-white shadow-lg active:scale-90 transition-transform"
            style={{ background: '#dc2626' }}
            aria-label="Wunschliste löschen"
          >
            <Trash2 size={18} strokeWidth={2.5} />
          </button>
        )}
      </Link>
    </div>
  );
}
