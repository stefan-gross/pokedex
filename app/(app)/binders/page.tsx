'use client';

import { useState, useEffect, useMemo, useId, useRef, useLayoutEffect } from 'react';
import Link from 'next/link';
import { Plus, Folder, Heart } from 'lucide-react';
import { getBinders, deleteBinder } from '@/lib/firestore/binders';
import { getCards } from '@/lib/firestore/cards';
import { CreateBinderModal } from '@/components/binder/CreateBinderModal';
import { BinderCover } from '@/components/binder/BinderCover';
import { useTotalValue } from '@/lib/hooks/use-total-value';
import { tintedGlassStyle } from '@/lib/ui/tinted-glass';
import { readableTextColor } from '@/lib/color-utils';
import type { BinderDoc, CardDoc } from '@/types';

export default function BindersPage() {
  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    try {
      const [binderData, cardData] = await Promise.all([getBinders(), getCards()]);
      // Inbox „Neue Karten" und Default „Meine Sammlung" immer zuerst — danach normal nach sortOrder.
      const sorted = [...binderData].sort((a, b) => {
        const aRank = a.isInbox ? 0 : a.isDefault ? 1 : 2;
        const bRank = b.isInbox ? 0 : b.isDefault ? 1 : 2;
        if (aRank !== bRank) return aRank - bRank;
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      });
      setBinders(sorted);
      setCards(cardData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const cardsById = useMemo(() => {
    const m = new Map<string, CardDoc>();
    for (const c of cards) m.set(c.id, c);
    return m;
  }, [cards]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="px-4 pt-4 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.18)]">Sammlungen</h1>
          <p className="text-role-body text-glass-muted">{binders.length} {binders.length === 1 ? 'Sammlung' : 'Sammlungen'}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="w-11 h-11 rounded-full flex items-center justify-center text-white"
          style={tintedGlassStyle('#2f855a')}
        >
          <Plus size={20} />
        </button>
      </div>

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
              onClick={() => setShowCreate(true)}
              className="mt-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
              style={tintedGlassStyle('#2f855a')}
            >
              Erste Sammlung erstellen
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {binders.map(binder => {
            const binderCards = binder.cardIds
              .map(id => cardsById.get(id))
              .filter((c): c is CardDoc => !!c);
            return (
              <BinderTile
                key={binder.id}
                binder={binder}
                binderCards={binderCards}
                onDeleted={load}
              />
            );
          })}
        </div>
      </div>

      {showCreate && (
        <CreateBinderModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}
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
function BinderTile({ binder, binderCards, onDeleted: _ }: { binder: BinderDoc; binderCards: CardDoc[]; onDeleted: () => void }) {
  const cardCount = binder.cardIds.length;
  const isBox     = binder.collectionType === 'box';
  const totalValue = useTotalValue(binderCards);
  const wishlistCount = binder.wishlistCardIds?.length ?? 0;
  const grainUid = useId().replace(/:/g, '');
  const bandColor = lightenColor(binder.color ?? '#e53e3e', 0.14);
  // Bei hellen Sammlungsfarben (z.B. Weiß) wäre weißer Text auf der
  // ebenfalls hellen Banderole unlesbar — luminanzbasierte Kontrastfarbe.
  const bandTextColor = readableTextColor(bandColor);

  // Tatsächliche Kachelbreite messen (responsives Grid, kein fester Wert)
  // — die Bogenberechnung für die Binder-Ecke unten rechts braucht echte
  // Pixel-Einheiten. useLayoutEffect läuft vor dem Paint, kein sichtbarer
  // Sprung beim ersten Render.
  const tileRef = useRef<HTMLDivElement>(null);
  const [tileWidth, setTileWidth] = useState(0);
  useLayoutEffect(() => {
    if (tileRef.current) setTileWidth(tileRef.current.offsetWidth);
  }, []);

  return (
    <Link href={`/binders/${binder.id}`} className="block active:scale-[.98] transition-transform">
      {/* Boxen etwas kleiner als Ordner darstellen (Karton wirkt kompakter) —
          Skalierung auf einem eigenen relative-Wrapper, damit Badge/Footer
          mitschrumpfen und weiterhin korrekt am Cover ausgerichtet bleiben. */}
      <div className="relative" ref={tileRef} style={isBox ? { transform: 'scale(0.92)', transformOrigin: 'center' } : undefined}>
        <BinderCover
          color={binder.color}
          name={binder.name}
          icon={binder.icon ?? (isBox ? 'box' : 'folder')}
          shape={isBox ? 'box' : 'folder'}
        />

        {wishlistCount > 0 && (
          <span
            className="absolute top-2.5 right-2.5 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: 'rgba(0,0,0,.35)', color: '#fff' }}
          >
            +{wishlistCount} <Heart size={9} fill="currentColor" />
          </span>
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
            schon BOX_BODY_INSET (4 von 300 SVG-Einheiten) schmaler als die
            Kachel, siehe BinderCover.tsx). Ein paar Pixel Abstand nach
            unten, statt direkt an der Kachel-Unterkante zu kleben. Links
            (nur bei Bindern) derselbe Schatten-Verlauf wie am Ordner-Cover
            selbst. Sehr kleine Rundung an 3 Ecken, unten rechts bei
            Bindern folgt stattdessen exakt der Kachel-Rundung. */}
        <div
          className="absolute flex items-end justify-between px-3.5"
          style={{
            paddingTop: 6,
            paddingBottom: 6,
            bottom: BANDEROLE_GAP,
            left: isBox ? 'calc(4 / 300 * 100% - 1px)' : -1,
            right: isBox ? 'calc(4 / 300 * 100% - 1px)' : -1,
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
              ? `≈ ${totalValue.total.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}`
              : ''}
          </span>
          <span className="font-sans font-bold shrink-0 tabular-nums" style={{ fontSize: 13, color: bandTextColor }}>
            {cardCount} {cardCount === 1 ? 'Karte' : 'Karten'}
          </span>
        </div>
      </div>
    </Link>
  );
}
