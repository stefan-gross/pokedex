'use client';

import { useState, useEffect, useMemo, useId, useRef, useLayoutEffect } from 'react';
import Link from 'next/link';
import { Plus, Folder, Heart, Check, Trash2, Pencil, FolderPlus, BookOpen, Package, Repeat2, Palette } from 'lucide-react';
import {
  DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getBinders, deleteBinderCascade, updateBinder, reorderBinders } from '@/lib/firestore/binders';
import { formatEUR } from '@/lib/format';
import { getCards } from '@/lib/firestore/cards';
import { CreateBinderModal } from '@/components/binder/CreateBinderModal';
import { CreateTemplateBinderModal } from '@/components/binder/CreateTemplateBinderModal';
import { BinderCover, BoxCover } from '@/components/binder/BinderCover';
import { CollectionDeckToggle } from '@/components/deck/CollectionDeckToggle';
import { CollectionTypeCornerBadge } from '@/components/binder/CollectionTypeBadge';
import { ScrollToTopButton } from '@/components/ui/ScrollToTopButton';
import { LegendButton } from '@/components/ui/LegendButton';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/modal';
import { useTotalValue } from '@/lib/hooks/use-total-value';
import { resolveTemplateSlots } from '@/lib/template-binders/resolve';
import { tintedGlassStyle } from '@/lib/ui/tinted-glass';
import { readableTextColor } from '@/lib/color-utils';
import type { BinderDoc, CardDoc } from '@/types';

export default function BindersPage() {
  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [cardsLoaded, setCardsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [createMode, setCreateMode] = useState<'closed' | 'choose' | 'manual' | 'template'>('closed');
  const [templateKind, setTemplateKind] = useState<'pokedex' | 'pokemon' | 'masterSet' | 'artist' | null>(null);
  const [editMode, setEditMode] = useState(false);

  const load = async () => {
    try {
      // Zuerst NUR die Binder laden → Cover/Namen können sofort erscheinen, ohne
      // auf die (u.U. große/langsame) Kartenliste zu warten. Bisher blockierte
      // ein hängender getCards()-Read die gesamte Übersicht (leerer Bildschirm).
      let binderData = await getBinders();
      // Einmalige Migration zum neuen Modell: der frühere „Eingang" (isInbox)
      // entfällt — seine Karten wandern nach „Unsortiert", der Binder wird
      // gelöscht (deleteBinderCascade übernimmt beides). Danach neu laden.
      const inbox = binderData.find(b => b.isInbox);
      if (inbox) {
        await deleteBinderCascade(inbox);
        binderData = await getBinders();
      }
      // Alte Bestandsdaten: „Unsortiert" war früher „Meine Sammlung" — Name/
      // Icon/Farbe einmalig auf den aktuellen Stand anheben, falls nötig.
      const def = binderData.find(b => b.isDefault);
      if (def && (def.name !== 'Unsortiert' || def.icon !== 'cards' || def.color !== '#ffffff')) {
        await updateBinder(def.id, { name: 'Unsortiert', color: '#ffffff', icon: 'cards' });
        Object.assign(def, { name: 'Unsortiert', color: '#ffffff', icon: 'cards' });
      }
      // „Unsortiert" (Default) immer zuerst — danach normal nach sortOrder.
      const sorted = [...binderData].sort((a, b) => {
        const aRank = a.isDefault ? 0 : 1;
        const bRank = b.isDefault ? 0 : 1;
        if (aRank !== bRank) return aRank - bRank;
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      });
      setBinders(sorted);
    } catch (e) {
      console.error('[binders] load error', e);
    } finally {
      setLoading(false);
    }
    // Karten separat und NICHT blockierend nachladen — nur für Kartenzähler/Wert
    // in der Banderole. Die Cover stehen davon unabhängig sofort.
    getCards().then(cs => { setCards(cs); setCardsLoaded(true); }).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  // Gleiches bedingtes Confirm-Muster wie deleteSheet auf der Detailseite
  // (app/(app)/binders/[id]/page.tsx) — nur bei nicht-leerem Binder nachfragen.
  const handleDeleteBinder = async (binder: BinderDoc) => {
    if (binder.cardIds.length > 0) {
      const ok = confirm(
        `„${binder.name}" enthält ${binder.cardIds.length} Karte(n). ` +
        `Sie werden zurück nach „Unsortiert" verschoben. Fortfahren?`
      );
      if (!ok) return;
    }
    await deleteBinderCascade(binder);
    load();
  };

  const cardsById = useMemo(() => {
    const m = new Map<string, CardDoc>();
    for (const c of cards) m.set(c.id, c);
    return m;
  }, [cards]);

  // Drag & Drop zum Umsortieren (nur im Bearbeiten-Modus) — Muster wie die
  // Blatt-Sortierung auf der Detailseite. „Unsortiert" (isDefault) ist per
  // useSortable disabled und wird hier zusätzlich abgesichert.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 16 } }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const byId = new Map(binders.map(b => [b.id, b]));
    if (byId.get(String(active.id))?.isDefault || byId.get(String(over.id))?.isDefault) return;
    const nonDefault = binders.filter(b => !b.isDefault);
    const from = nonDefault.findIndex(b => b.id === active.id);
    const to = nonDefault.findIndex(b => b.id === over.id);
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(nonDefault, from, to);
    const def = binders.filter(b => b.isDefault);
    setBinders([...def, ...reordered]);   // optimistisch
    reorderBinders(reordered.map(b => b.id)).catch(err => {
      console.error('[binders] reorder error', err);
      load();   // bei Fehler serverseitigen Stand wiederherstellen
    });
  };

  return (
    <div className="min-h-screen">
      {/* Header-Panel (Glas) */}
      <div className="sticky top-safe z-20 px-3 pt-3 pb-1">
        <div className="glass rounded-[20px] px-4 pt-3 pb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.18)]">Sammlungen</h1>
            <p className="text-role-label text-glass-muted">{loading ? '…' : `${binders.length} ${binders.length === 1 ? 'Sammlung' : 'Sammlungen'}`}</p>
          </div>
          {/* Rechts: im Bearbeiten-Modus „Fertig", sonst zwei icon-only Buttons —
              „+“ (neue Sammlung) und ein Stift (Bearbeiten-Modus starten;
              Löschen + Umsortieren). Kein Long-Press mehr (analog Detailseite). */}
          {editMode ? (
            <Button variant="primary" accentColor="#2f855a" onClick={() => setEditMode(false)} icon={<Check />} aria-label="Fertig" className="shrink-0" />
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="primary" accentColor="#2f855a" onClick={() => setCreateMode('choose')} icon={<Plus strokeWidth={2.5} />} aria-label="Neue Sammlung" />
              <Button variant="secondary" onClick={() => setEditMode(true)} icon={<Pencil />} aria-label="Bearbeiten" />
            </div>
          )}
        </div>
      </div>

      <div className="px-3 pt-1"><CollectionDeckToggle /></div>

      <div className="px-4 py-4">
        {loading && (
          <div className="flex justify-center pt-12">
            <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && binders.length === 0 && (
          <div className="text-center pt-16 space-y-3">
            <div className="flex justify-center"><Folder size={48} className="text-glass-muted" /></div>
            <p className="text-role-title text-glass">Noch keine Sammlungen</p>
            <p className="text-role-body text-glass-muted">Erstelle deinen ersten Binder oder eine Box, um Karten zu organisieren</p>
            <button
              onClick={() => setCreateMode('choose')}
              className="mt-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
              style={tintedGlassStyle('#2f855a')}
            >
              Erste Sammlung erstellen
            </button>
          </div>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={binders.map(b => b.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-3">
              {binders.map((binder) => {
                const binderCards = binder.cardIds
                  .map(id => cardsById.get(id))
                  .filter((c): c is CardDoc => !!c);
                return (
                  <BinderTile
                    key={binder.id}
                    binder={binder}
                    binderCards={binderCards}
                    cardsLoaded={cardsLoaded}
                    editMode={editMode}
                    onDelete={() => handleDeleteBinder(binder)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {createMode === 'choose' && (
        <Sheet
          open
          onClose={() => setCreateMode('closed')}
          title="Neue Sammlung"
          onBack={() => setCreateMode('closed')}
          showClose={false}
        >
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setCreateMode('manual')}
              className="flex items-center gap-3 px-4 py-3 rounded-xl glass-inner text-left"
            >
              <FolderPlus size={20} className="text-glass-muted shrink-0" />
              <div>
                <p className="text-sm font-semibold">Manuell</p>
                <p className="text-xs text-glass-muted">Leerer Binder, du befüllst ihn selbst</p>
              </div>
            </button>

            {/* Trenner + Vorlagen direkt hier wählbar (spart den Zwischenschritt) */}
            <p className="text-role-label text-glass-muted px-1 pt-2 pb-0.5 border-t border-[var(--border)] mt-1">
              Aus Vorlage — füllt sich automatisch
            </p>
            {([
              ['masterSet', Package,  'Master-Set', 'Alle Karten einer Erweiterung, eine Kachel pro Nummer'],
              ['pokemon',   Repeat2,  'Pokémon',   'Alle Karten eines Pokémon, optional inkl. Entwicklungslinie'],
              ['pokedex',   BookOpen, 'Pokédex',   'Alle ~1025 Pokémon, eine Kachel pro Nummer'],
              ['artist',    Palette,  'Illustrator', 'Alle Karten eines Illustrators, eine Kachel pro Karte'],
            ] as const).map(([k, Icon, label, sub]) => (
              <button
                key={k}
                onClick={() => { setTemplateKind(k); setCreateMode('template'); }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl glass-inner text-left"
              >
                <Icon size={20} className="text-glass-muted shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{label}</p>
                  <p className="text-xs text-glass-muted">{sub}</p>
                </div>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {createMode === 'manual' && (
        <CreateBinderModal
          onBack={() => setCreateMode('choose')}
          onClose={() => setCreateMode('closed')}
          onSaved={() => { setCreateMode('closed'); load(); }}
        />
      )}

      {createMode === 'template' && (
        <CreateTemplateBinderModal
          initialKind={templateKind ?? 'masterSet'}
          onBack={() => setCreateMode('choose')}
          onClose={() => { setCreateMode('closed'); setTemplateKind(null); }}
          onSaved={() => { setCreateMode('closed'); setTemplateKind(null); load(); }}
        />
      )}

      <ScrollToTopButton />
      <LegendButton symbols={['automatic', 'system']} />
    </div>
  );
}

// Radius der echten Kachel-Rundung (rounded-br-[20px] in ROUNDING.folder,
// components/binder/BinderCover.tsx).
const TILE_RADIUS = 20;
const BANDEROLE_GAP = 6;
const BANDEROLE_HEIGHT = 28;
// Sehr kleine Rundung an den "normalen" Ecken (oben links/rechts, unten
// links) — nur die Binder-Ecke unten rechts bekommt stattdessen die an die
// Kachel-Rundung angeglichene große Kurve (siehe banderoleClipPath).
const BANDEROLE_SMALL_RADIUS = 1.5;

/** Etwas hellere Variante der Binderfarbe für die Banderole. Einfache
 *  Mischung Richtung Weiß, analog zu embossTextColor() in BinderCover.tsx. */
function lightenColor(hex: string, amount: number): string {
  const full = hex.replace('#', '');
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * amount);
  return `#${[r, g, b].map(mix).map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Banderole-Umriss für Binder (Ordner) — kleine Rundung an 3 Ecken, unten
 *  rechts folgt exakt demselben Kreisbogen wie die echte Kachel-Rundung
 *  (TILE_RADIUS), nur um 1px nach rechts verschoben. `tileWidthPx` ist die
 *  tatsächliche, gemessene Kachelbreite (variiert im responsiven Grid —
 *  anders als auf der festen 260px-Vorschauseite), da die Bogenberechnung
 *  echte Pixel-Einheiten braucht (keine Prozentwerte). */
function banderoleClipPath(tileWidthPx: number): string {
  const w = tileWidthPx + 2; // Div-Breite: -1 bis tileWidthPx+1
  const h = BANDEROLE_HEIGHT;
  const sr = BANDEROLE_SMALL_RADIUS;
  const yc = BANDEROLE_HEIGHT + BANDEROLE_GAP - TILE_RADIUS; // Kreismittelpunkt, lokale Y
  const dy = h - yc;
  const dx = Math.sqrt(Math.max(TILE_RADIUS ** 2 - dy ** 2, 0));
  const xBottom = (w - TILE_RADIUS) + dx;
  return `path('M0 ${sr} A${sr} ${sr} 0 0 1 ${sr} 0 L${w - sr} 0 A${sr} ${sr} 0 0 1 ${w} ${sr} `
    + `L${w} ${yc} A${TILE_RADIUS} ${TILE_RADIUS} 0 0 1 ${xBottom} ${h} `
    + `L${sr} ${h} A${sr} ${sr} 0 0 1 0 ${h - sr} Z')`;
}

/** Binder/Box als Ringbuch-"Deckel"-Grafik (BinderCover) in der Sammlungsfarbe,
 *  Wert/Kartenanzahl als Banderole (eigene Farbfläche, etwas heller als der
 *  Binder, mit Leder-Körnung) unten. Boxen nutzen automatisch das Box-Icon
 *  statt des Ordner-Icons (binder.icon-Fallback), sehen sonst identisch aus. */
function BinderTile({ binder, binderCards, cardsLoaded, editMode, onDelete }: { binder: BinderDoc; binderCards: CardDoc[]; cardsLoaded: boolean; editMode: boolean; onDelete: () => void }) {
  const isBox     = binder.collectionType === 'box';
  // Vorlagen-Sammlung: ein Slot = eine Karte → eindeutig nach tcgId zählen
  // (Duplikate/Varianten als eine Karte, wie die Set-Übersicht). Sonst alle
  // Exemplare (eine Box darf mehrere gleiche Karten getrennt zählen).
  const cardCount = binder.template
    ? new Set(binderCards.map(c => c.tcgId ?? c.id)).size
    : binder.cardIds.length;
  const totalValue = useTotalValue(binderCards);
  // Automatische Sammlung: Gesamt-Slotzahl (max. Karten) auflösen, damit die
  // Banderole „besessen / max" zeigt statt nur der besessenen Anzahl.
  // A1: persistierte Slot-Gesamtzahl direkt nutzen (beim Sync geschrieben) →
  // KEIN ~1025-Query-Katalog-Scan pro Kachel. Nur Legacy-Binder ohne
  // persistierten Wert lösen einmalig per resolveTemplateSlots auf.
  const [templateTotal, setTemplateTotal] = useState<number | null>(
    binder.template ? (binder.slotTotal ?? null) : null,
  );
  useEffect(() => {
    const template = binder.template;
    if (!template) { setTemplateTotal(null); return; }
    if (binder.slotTotal != null) { setTemplateTotal(binder.slotTotal); return; }
    let cancelled = false;
    resolveTemplateSlots(template)
      .then(slots => { if (!cancelled) setTemplateTotal(slots.length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [binder.template, binder.slotTotal]);
  const wishlistCount = binder.wishlistCardIds?.length ?? 0;
  const grainUid = useId().replace(/:/g, '');
  const bandColor = lightenColor(binder.color ?? '#e53e3e', 0.14);
  // Bei hellen Sammlungsfarben (z.B. Weiß) wäre weißer Text auf der
  // ebenfalls hellen Banderole unlesbar — luminanzbasierte Kontrastfarbe.
  const bandTextColor = readableTextColor(bandColor);
  // „Unsortiert" (Default) ist der dauerhafte Hub (u.a. Scanner-Ziel) — im
  // Bearbeiten-Modus nicht löschbar/ziehbar.
  const isProtected = !!binder.isDefault;

  // Tatsächliche Kachelbreite messen (responsives Grid, kein fester Wert)
  // — die Bogenberechnung für die Binder-Ecke unten rechts braucht echte
  // Pixel-Einheiten. useLayoutEffect läuft vor dem Paint, kein sichtbarer
  // Sprung beim ersten Render.
  const tileRef = useRef<HTMLDivElement>(null);
  const [tileWidth, setTileWidth] = useState(0);
  useLayoutEffect(() => {
    if (tileRef.current) setTileWidth(tileRef.current.offsetWidth);
  }, []);

  // Bearbeiten-Modus → Kacheln per Drag & Drop umsortieren (Muster wie die
  // Blatt-Sortierung auf der Detailseite). „Unsortiert" (isProtected) ist
  // disabled und bleibt vorn gepinnt. Kein Long-Press mehr — der Einstieg
  // läuft über den Stift-Button in der Kopfzeile.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: binder.id,
    disabled: !editMode || isProtected,
  });
  const dragEnabled = editMode && !isProtected;
  // Nach einem (Touch-)Drag synthetisiert der Browser einen `click` auf den
  // <Link>; bei Touch greift das `preventDefault` im Link-onClick nicht
  // zuverlässig → die Sammlung öffnet sich sofort. Gerade beendetes Ziehen
  // merken und den Folge-Klick in der Capture-Phase des Wrappers verschlucken.
  const justDraggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) { justDraggedRef.current = true; return; }
    if (justDraggedRef.current) {
      const t = setTimeout(() => { justDraggedRef.current = false; }, 400);
      return () => clearTimeout(t);
    }
  }, [isDragging]);

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
      href={`/binders/${binder.id}`}
      className="block active:scale-[.98] transition-transform no-callout"
      onContextMenu={e => e.preventDefault()}
      onClick={e => { if (editMode) e.preventDefault(); }}
    >
      {/* Boxen etwas kleiner als Ordner darstellen (Karton wirkt kompakter) —
          Skalierung auf einem eigenen relative-Wrapper, damit Badge/Footer
          mitschrumpfen und weiterhin korrekt am Cover ausgerichtet bleiben. */}
      <div
        className="relative"
        ref={tileRef}
        style={isBox ? { transform: 'scale(0.92)', transformOrigin: 'center' } : undefined}
      >
        {isBox ? (
          <BoxCover
            color={binder.color}
            name={binder.name}
            icon={binder.icon ?? 'box'}
            reserveBottom={BANDEROLE_HEIGHT + BANDEROLE_GAP}
            badge={(!editMode || isProtected) ? <CollectionTypeCornerBadge binder={binder} shape="box" /> : undefined}
          />
        ) : (
          <BinderCover
            color={binder.color}
            name={binder.name}
            icon={binder.icon ?? 'folder'}
            reserveBottom={BANDEROLE_HEIGHT + BANDEROLE_GAP}
            badge={(!editMode || isProtected) ? <CollectionTypeCornerBadge binder={binder} shape="folder" /> : undefined}
          />
        )}

        {wishlistCount > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 inline-flex items-center gap-0.5 text-[11px] font-bold px-2 py-1 rounded-full"
            style={{ background: 'rgba(0,0,0,.35)', color: '#fff' }}
          >
            +{wishlistCount} <Heart size={10} fill="currentColor" />
          </span>
        )}

        {/* Lösch-X — direkt in der oberen linken Ecke (Wunschlisten-Badge
            belegt bereits rechts oben), 44px (App-weite Touch-Target-
            Mindestgröße), nur im Bearbeiten-Modus und nicht bei geschützten
            Bindern (Inbox/Standard). */}
        {editMode && !isProtected && (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
            className="absolute -top-1 -left-1 w-11 h-11 rounded-full flex items-center justify-center text-white ring-2 ring-white shadow-lg active:scale-90 transition-transform"
            style={{ background: '#dc2626' }}
            aria-label="Sammlung löschen"
          >
            <Trash2 size={18} strokeWidth={2.5} />
          </button>
        )}

        {/* Leder-Körnung für die Banderole — gleiches feBlend/multiply-Rezept
            wie in BinderCover.tsx, aber mit eigener uid, da die Banderole
            außerhalb von BinderCover liegt und dessen SVG-Filter-IDs nicht
            kennt. */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            <filter id={`banderole-grain-${grainUid}`}>
              <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" result="noise" />
              <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.1 0.1 0.1 0 0" result="grain" />
              <feComposite in="grain" in2="SourceAlpha" operator="in" result="grainClipped" />
              <feBlend in="SourceGraphic" in2="grainClipped" mode="multiply" />
            </filter>
          </defs>
        </svg>

        {/* Banderole — eigene, etwas hellere Farbfläche in der
            Sammlungsfarbe, nur 1px breiter als der Körper, auf dem sie
            liegt (nicht die ganze Kachel — die Box-Körper-Form ist selbst
            schon BOX_BODY_LEFT/RIGHT (7 von 300 SVG-Einheiten, siehe
            BinderCover.tsx: BOX_BODY_LEFT = 3 + BOX_BODY_INSET(4)) schmaler
            als die Kachel — der Einzug bezieht sich auf die volle
            Kachelbreite (0-300), nicht nur auf den Lid-Bereich (3-297),
            daher 7/300 statt der reinen BOX_BODY_INSET-Zahl 4). Ein paar
            Pixel Abstand nach unten, statt direkt an der Kachel-Unterkante
            zu kleben. Links (nur bei Bindern) derselbe Schatten-Verlauf wie
            am Ordner-Cover selbst. Sehr kleine Rundung an 3 Ecken, unten
            rechts bei Bindern folgt stattdessen exakt der Kachel-Rundung. */}
        <div
          className="absolute flex items-end justify-between px-3.5"
          style={{
            paddingTop: 6,
            paddingBottom: 6,
            bottom: BANDEROLE_GAP,
            left: isBox ? 'calc(7 / 300 * 100% - 1px)' : -1,
            right: isBox ? 'calc(7 / 300 * 100% - 1px)' : -1,
            background: [
              ...(isBox ? [] : ['linear-gradient(90deg, rgba(0,0,0,.3) 0px, rgba(0,0,0,0) 26px)']),
              bandColor,
            ].join(', '),
            boxShadow: '0 3px 6px rgba(0,0,0,.35)',
            filter: `url(#banderole-grain-${grainUid})`,
            borderRadius: isBox ? BANDEROLE_SMALL_RADIUS : undefined,
            clipPath: isBox || tileWidth === 0 ? undefined : banderoleClipPath(tileWidth),
          }}
        >
          <span className="font-sans font-bold truncate" style={{ fontSize: 13, color: bandTextColor }}>
            {!totalValue.loading && totalValue.withPrice > 0
              ? `≈ ${formatEUR(totalValue.total)}`
              : ''}
          </span>
          <span className="font-sans font-bold shrink-0 tabular-nums" style={{ fontSize: 13, color: bandTextColor }}>
            {templateTotal != null
              ? `${(binder.template && !cardsLoaded) ? '…' : cardCount} / ${templateTotal} Karten`
              : `${cardCount} ${cardCount === 1 ? 'Karte' : 'Karten'}`}
          </span>
        </div>
      </div>
    </Link>
    </div>
  );
}
