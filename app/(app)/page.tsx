'use client';

import Link from 'next/link';
import { Settings, Star, Clock, Percent, ArrowUp } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { getCardsRest } from '@/lib/firestore/cards-rest';
import { useTotalValue } from '@/lib/hooks/use-total-value';
import { getBindersRest } from '@/lib/firestore/binders-rest';
import { getWishlistsRest } from '@/lib/firestore/wishlists-rest';
import { getCatalogCardsByIds } from '@/lib/firestore/catalog';
import { getSetById } from '@/lib/firestore/sets';
import { getRarityGroup } from '@/lib/card-constants';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { getCountFromServer, collection, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { SetListItem } from '@/components/set/SetListItem';
import { ButtonGroup } from '@/components/ui/button-group';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import type { CardDoc, BinderDoc } from '@/types';

type SetView = 'recent' | 'complete' | 'favorites';

interface SetEntry {
  setId: string;
  name: string;
  nameDe?: string;
  logoDe?: string;
  owned: number;
  total: number | null;
  latestAt: number;
}

export default function DashboardPage() {
  const [setView, setSetView]       = useState<SetView>('recent');
  const [cards, setCards]           = useState<CardDoc[] | null>(null);
  const [binders, setBinders]       = useState<BinderDoc[]>([]);
  const [wishlistCount, setWishlistCount] = useState<number | null>(null);
  const [setTotals, setSetTotals]   = useState<Record<string, number>>({});
  const [setMeta,   setSetMeta]     = useState<Record<string, { nameDe?: string; logoDe?: string; ptcgoCode?: string; symbolUrl?: string; series?: string }>>({});
  const [detailCard, setDetailCard] = useState<CardInfo | null>(null);
  const [detailOwned, setDetailOwned] = useState<CardDoc[]>([]);

  useEffect(() => {
    // REST statt Firestore-Web-SDK — vermeidet den WebSocket-Cold-Start
    // (10-20s auf iOS-PWA, besonders nach "App aktualisieren"), siehe
    // lib/firestore/rest-shared.ts.
    getCardsRest().then(setCards).catch(() => setCards([]));
    getBindersRest().then(setBinders).catch(() => {});
    getWishlistsRest()
      .then(wls => setWishlistCount(wls.reduce((s, w) => s + w.items.filter(i => !i.acquired).length, 0)))
      .catch(() => setWishlistCount(0));
  }, []);

  async function openDetail(cardDoc: CardDoc) {
    if (!cardDoc.tcgId) return;
    const [catalogCard] = await getCatalogCardsByIds([cardDoc.tcgId]);
    if (!catalogCard) return;
    const info = catalogCardToInfo(catalogCard);
    const owned = (cards ?? []).filter(c => c.tcgId === cardDoc.tcgId);
    setDetailOwned(owned);
    setDetailCard(info);
  }

  // Computed stats
  const totalOwned  = cards ? cards.reduce((s, c) => s + c.quantity, 0) : null;
  const uniqueSets  = cards ? new Set(cards.map(c => c.setId)).size : null;

  const weekAgo     = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek    = cards
    ? cards.filter(c => (c.addedAt?.toMillis?.() ?? 0) > weekAgo).reduce((s, c) => s + c.quantity, 0)
    : null;

  // Recently added — last 6 cards with image
  const recentCards = cards
    ? [...cards]
        .filter(c => c.tcgImageUrl)
        .sort((a, b) => (b.addedAt?.seconds ?? 0) - (a.addedAt?.seconds ?? 0))
        .slice(0, 6)
    : [];

  // Sets grouped by setId
  const setMap = new Map<string, SetEntry>();
  (cards ?? []).forEach(c => {
    const cur = setMap.get(c.setId) ?? { setId: c.setId, name: c.setName, owned: 0, total: null, latestAt: 0 };
    cur.owned    += c.quantity;
    cur.latestAt  = Math.max(cur.latestAt, c.addedAt?.seconds ?? 0);
    setMap.set(c.setId, cur);
  });
  const allSets = [...setMap.values()];

  // Lade Catalog-Totals für die angezeigten Sets
  const displayedSets: SetEntry[] = (() => {
    if (setView === 'recent') {
      return [...allSets].sort((a, b) => b.latestAt - a.latestAt).slice(0, 4);
    }
    if (setView === 'complete') {
      return [...allSets].sort((a, b) => {
        const pctA = setTotals[a.setId] ? a.owned / setTotals[a.setId] : 0;
        const pctB = setTotals[b.setId] ? b.owned / setTotals[b.setId] : 0;
        return pctB - pctA;
      }).slice(0, 4);
    }
    // favorites: top by owned count
    return [...allSets].sort((a, b) => b.owned - a.owned).slice(0, 4);
  })();

  useEffect(() => {
    const ids = displayedSets.map(s => s.setId);
    ids.forEach(setId => {
      // Catalog-Totals laden
      if (!(setId in setTotals)) {
        getCountFromServer(query(collection(db, 'tcg_catalog'), where('setId', '==', setId)))
          .then(snap => setSetTotals(prev => ({ ...prev, [setId]: snap.data().count })))
          .catch(() => {});
      }
      // Deutsche Set-Metadaten laden (Name + Logo)
      if (!(setId in setMeta)) {
        getSetById(setId)
          .then(set => setSetMeta(prev => ({ ...prev, [setId]: {
            nameDe: set?.nameDe, logoDe: set?.logoUrl, ptcgoCode: set?.ptcgoCode,
            symbolUrl: set?.symbolUrl, series: set?.series,
          } })))
          .catch(() => {});
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedSets.map(s => s.setId).join(','), setView]);

  const loading = cards === null;
  const totalValue = useTotalValue(cards);

  // Fallback für den Wert-Hero, falls keine Karte einen Preis hat: seltenste
  // Karte nach Rarity-Ordnung (Promo zählt nicht als "selten", siehe order 99).
  const rarestCard = useMemo(() => {
    if (!cards) return null;
    let best: CardDoc | null = null;
    let bestOrder = -1;
    for (const c of cards) {
      if (!c.tcgImageUrl) continue;
      const order = c.rarity ? (getRarityGroup(c.rarity)?.order ?? -1) : -1;
      const effectiveOrder = order === 99 ? -1 : order;
      if (effectiveOrder > bestOrder) { bestOrder = effectiveOrder; best = c; }
    }
    return best;
  }, [cards]);
  const heroCard = totalValue.loading ? null : (totalValue.topCard ?? rarestCard);

  return (
    <div className="relative min-h-screen">
      <div className="px-4 pt-6 pb-4 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.18)]">Pokédex</h1>
          <p className="text-role-body text-glass-muted">Deine Sammlung</p>
        </div>
        <Link
          href="/settings"
          className="glass w-[38px] h-[38px] rounded-full flex items-center justify-center text-glass"
          style={{ backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
        >
          <Settings size={20} strokeWidth={1.8} />
        </Link>
      </div>

      {/* Wert-Hero + Chip-Streifen */}
      <div className="space-y-3">
        {loading ? (
          <ValueHeroSkeleton />
        ) : (
          <ValueHero
            totalOwned={totalOwned ?? 0}
            thisWeek={thisWeek}
            totalValue={totalValue}
            heroCard={heroCard}
          />
        )}

        <div className="grid grid-cols-3 gap-2">
          {loading ? (
            <>
              <StatChipSkeleton />
              <StatChipSkeleton />
              <StatChipSkeleton />
            </>
          ) : (
            <>
              <StatChip label="Sammlungen" value={String(binders.length)} />
              <StatChip label="Sets" value={String(uniqueSets ?? 0)} />
              <StatChip label="Wunschliste" value={wishlistCount == null ? '—' : String(wishlistCount)} />
            </>
          )}
        </div>
      </div>

      {/* Set-Vollständigkeit — Skeleton während des Ladens, danach immer sichtbar */}
      {loading && <SetsSkeleton />}
      {!loading && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-role-h2 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.25)]">Sets</h2>
            <div className="flex items-center gap-3">
              <ButtonGroup
                iconOnly
                value={setView}
                onChange={setSetView}
                options={[
                  { value: 'favorites', label: <Star size={17} />, ariaLabel: 'Meiste Karten' },
                  { value: 'recent',    label: <Clock size={17} />, ariaLabel: 'Zuletzt aktiv' },
                  { value: 'complete',  label: <Percent size={17} />, ariaLabel: 'Vollständigste' },
                ]}
              />
              <Link
                href="/sets"
                className="inline-flex items-center min-h-11 text-role-title text-glass"
              >
                Alle
              </Link>
            </div>
          </div>

          {displayedSets.length > 0 ? (
            <div className="glass rounded-[20px] overflow-hidden">
              {displayedSets.map((s, i) => (
                <SetListItem
                  key={s.setId}
                  setId={s.setId}
                  name={s.name}
                  nameDe={setMeta[s.setId]?.nameDe}
                  logoDe={setMeta[s.setId]?.logoDe}
                  owned={s.owned}
                  total={setTotals[s.setId] ?? null}
                  ptcgoCode={setMeta[s.setId]?.ptcgoCode}
                  symbolUrl={setMeta[s.setId]?.symbolUrl}
                  series={setMeta[s.setId]?.series}
                  href={`/sets/${s.setId}?from=dashboard`}
                  separator={i < displayedSets.length - 1}
                  variant="glass"
                />
              ))}
            </div>
          ) : (
            <div className="glass rounded-[20px] px-4 py-6 flex flex-col items-center gap-3 text-center">
              <p className="text-role-body text-glass-muted">
                {setView === 'favorites'
                  ? 'Noch keine Favoriten — scanne Karten um Sets zu befüllen.'
                  : 'Noch keine Karten in deiner Sammlung.'}
              </p>
              <Link
                href="/sets"
                className="text-role-title px-4 py-2 rounded-xl"
                style={{ background: 'var(--pokedex-red)', color: '#fff' }}
              >
                Alle Zyklen & Sets ansehen
              </Link>
            </div>
          )}
        </section>
      )}

      {/* Zuletzt hinzugefügt */}
      {loading && <RecentCardsSkeleton />}
      {!loading && recentCards.length > 0 && (
        <section>
          <h2 className="text-role-h2 mb-3 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.25)]">Zuletzt hinzugefügt</h2>
          <div className="grid grid-cols-3 gap-2.5">
            {recentCards.map(card => (
              <RecentCard key={card.id} name={card.name} img={card.tcgImageUrl!} onClick={() => openDetail(card)} />
            ))}
          </div>
        </section>
      )}

      {/* Kartendetail-Modal */}
      {detailCard && (
        <CardDetailSheet
          card={detailCard}
          ownedCopies={detailOwned}
          binders={binders}
          onClose={() => setDetailCard(null)}
          onSaved={async () => {
            const fresh = await getCardsRest().catch(() => [] as CardDoc[]);
            setCards(fresh);
            if (detailCard) setDetailOwned(fresh.filter(c => c.tcgId === detailCard.id));
          }}
        />
      )}

      {/* Leerer Zustand */}
      {!loading && (cards?.length ?? 0) === 0 && (
        <div className="flex flex-col items-center justify-center pt-16 gap-3 text-center">
          <div className="text-4xl">📦</div>
          <p className="text-role-title text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.18)]">Noch keine Karten</p>
          <p className="text-role-label text-glass-muted max-w-[220px]">Scanne deine erste Karte oder suche sie in der Kartendatenbank.</p>
          <Link href="/scanner" className="mt-2 px-4 py-2 rounded-xl text-role-title text-white" style={{ background: 'var(--pokedex-red)' }}>
            Karte scannen
          </Link>
        </div>
      )}

      </div>
    </div>
  );
}

/** Wert-Hero: ersetzt die 3 TopStat-Kacheln durch eine große Karte mit
 *  Kartenanzahl (Hauptwert), Wochen-Delta-Chip und Gesamtwert-Fußzeile. */
function ValueHero({ totalOwned, thisWeek, totalValue, heroCard }: {
  totalOwned: number | null;
  thisWeek: number | null;
  totalValue: { loading: boolean; withPrice: number; total: number };
  heroCard: CardDoc | null;
}) {
  const valueLabel = totalValue.loading
    ? '—'
    : totalValue.withPrice > 0
      ? totalValue.total.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
      : '—';

  return (
    <div className="glass rounded-[24px] p-5 relative overflow-hidden">
      {heroCard?.tcgImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={heroCard.tcgImageUrl}
          alt=""
          aria-hidden="true"
          className="absolute pointer-events-none select-none"
          style={{
            top: -20,
            right: -22,
            height: '112%',
            width: 'auto',
            aspectRatio: '63/88',
            objectFit: 'cover',
            transform: 'rotate(16deg)',
            opacity: 0.65,
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          }}
        />
      )}
      <div className="relative">
        <span className="text-xs font-semibold uppercase text-glass-muted" style={{ letterSpacing: '.05em' }}>
          Karten in der Sammlung
        </span>
        <div className="flex items-baseline gap-2 mt-1">
          <span
            className="tabular-nums text-[#e53e3e] dark:text-white dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.25)]"
            style={{ fontSize: 46, fontWeight: 800, lineHeight: 1, letterSpacing: '-.03em' }}
          >
            {(totalOwned ?? 0).toLocaleString('de')}
          </span>
          {thisWeek != null && thisWeek > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-xs font-bold rounded-full text-[#1E2024] bg-white/60 border border-[rgba(30,40,80,0.15)] dark:bg-[rgba(74,222,128,.16)] dark:text-[#7ee6a0] dark:border-[rgba(126,230,160,0.35)]"
              style={{ padding: '4px 9px' }}
            >
              <ArrowUp size={12} strokeWidth={3} />
              {thisWeek} diese Woche
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-1.5 mt-3.5 pt-3.5 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14]">
          <span className="text-role-label text-glass-muted">Geschätzter Wert</span>
          <span className="text-lg font-extrabold text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.25)]">{valueLabel}</span>
        </div>
      </div>
    </div>
  );
}

/** Kompakter Stat-Chip im 3er-Streifen (Sammlungen · Sets · Wunschliste). */
function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-[16px] px-2 py-3 flex flex-col items-center gap-0.5">
      <span className="text-role-metric leading-none tabular-nums text-glass">{value}</span>
      <span className="text-role-label text-glass-muted">{label}</span>
    </div>
  );
}


function RecentCard({ name, img, onClick }: { name: string; img: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 text-left w-full">
      <div
        className="w-full aspect-[63/88] rounded-[6px] overflow-hidden bg-black/5 dark:bg-white/10 border border-[rgba(30,40,80,0.12)] dark:border-white/40"
        style={{ boxShadow: '0 6px 18px rgba(0,0,0,.18)' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt={name} className="w-full h-full object-cover" />
      </div>
      <span className="text-role-label text-center truncate w-full mt-0.5 text-glass">{name}</span>
    </button>
  );
}

/** Generischer pulsierender Platzhalter-Balken — Basis aller Skeletons unten.
 *  Deckt die Ladephase ab, in der `getCards()`/`getBinders()`/`getWishlists()`
 *  (Firestore-Web-SDK, websocket-basiert) noch keine Antwort haben — auf
 *  iOS-PWA kann der erste Verbindungsaufbau (Cold-Start), besonders direkt
 *  nach "App aktualisieren" (Service-Worker-Reset), spürbar dauern. */
function Skel({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-[rgba(30,40,80,0.12)] dark:bg-white/15 rounded ${className ?? ''}`} />;
}

/** Skeleton für ValueHero — gleiche Maße/Form wie die echte Karte. */
function ValueHeroSkeleton() {
  return (
    <div className="glass rounded-[24px] p-5">
      <Skel className="h-3 w-32 rounded-full" />
      <Skel className="h-11 w-40 rounded-lg mt-2" />
      <div className="mt-3.5 pt-3.5 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14] flex items-center gap-2">
        <Skel className="h-3.5 w-24 rounded-full" />
        <Skel className="h-4 w-16 rounded-full ml-auto" />
      </div>
    </div>
  );
}

/** Skeleton für StatChip. */
function StatChipSkeleton() {
  return (
    <div className="glass rounded-[16px] px-2 py-3 flex flex-col items-center gap-1.5">
      <Skel className="h-5 w-8 rounded-md" />
      <Skel className="h-2.5 w-14 rounded-full" />
    </div>
  );
}

/** Skeleton für die Sets-Sektion — 3 Zeilen im Stil von SetListItem. */
function SetsSkeleton() {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <Skel className="h-5 w-14 rounded-md" />
        <Skel className="h-8 w-28 rounded-full" />
      </div>
      <div className="glass rounded-[20px] overflow-hidden">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className={`flex items-center gap-3 px-4 py-[13px]${i < 2 ? ' border-b border-[rgba(46,46,50,0.1)] dark:border-white/[.14]' : ''}`}
          >
            <Skel className="w-10 h-10 rounded-lg shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Skel className="h-3.5 w-28 rounded-full" />
                <Skel className="h-3.5 w-8 rounded-full" />
              </div>
              <Skel className="h-2 w-full rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Skeleton für "Zuletzt hinzugefügt" — 6 Karten-Kacheln. */
function RecentCardsSkeleton() {
  return (
    <section>
      <Skel className="h-5 w-40 rounded-md mb-3" />
      <div className="grid grid-cols-3 gap-2.5">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="w-full aspect-[63/88] rounded-[6px] overflow-hidden">
              <Skel className="w-full h-full rounded-[11px]" />
            </div>
            <Skel className="h-2.5 w-3/4 rounded-full mt-0.5" />
          </div>
        ))}
      </div>
    </section>
  );
}
