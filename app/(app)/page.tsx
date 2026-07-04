'use client';

import Link from 'next/link';
import { Settings, Star, Clock, Percent, ArrowUp } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { getCards } from '@/lib/firestore/cards';
import { useTotalValue } from '@/lib/hooks/use-total-value';
import { getBinders } from '@/lib/firestore/binders';
import { getWishlists } from '@/lib/firestore/wishlists';
import { getCatalogCardsByIds } from '@/lib/firestore/catalog';
import { getSetById } from '@/lib/firestore/sets';
import { getRarityGroup } from '@/lib/card-constants';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { getCountFromServer, collection, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { SetListItem } from '@/components/set/SetListItem';
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
    getCards().then(setCards).catch(() => setCards([]));
    getBinders().then(setBinders).catch(() => {});
    getWishlists()
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
    <div className="px-4 pt-6 pb-4 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pokédex</h1>
          <p className="text-sm text-muted-foreground">Deine Sammlung</p>
        </div>
        <Link href="/settings" className="text-muted-foreground p-1">
          <Settings size={22} strokeWidth={1.8} />
        </Link>
      </div>

      {/* Wert-Hero + Chip-Streifen */}
      <div className="space-y-3">
        <ValueHero
          totalOwned={loading ? null : (totalOwned ?? 0)}
          thisWeek={thisWeek}
          totalValue={totalValue}
          heroCard={heroCard}
        />

        <div className="grid grid-cols-3 gap-2">
          <StatChip label="Sammlungen" value={loading ? '—' : String(binders.length)} />
          <StatChip label="Sets" value={loading ? '—' : String(uniqueSets ?? 0)} />
          <StatChip label="Wunschliste" value={wishlistCount == null ? '—' : String(wishlistCount)} />
        </div>
      </div>

      {/* Set-Vollständigkeit — immer sichtbar */}
      {!loading && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold">Sets</h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-0.5 p-1 rounded-full bg-secondary">
                <ViewBtn active={setView === 'favorites'} onClick={() => setSetView('favorites')} label="Meiste Karten">
                  <Star size={17} />
                </ViewBtn>
                <ViewBtn active={setView === 'recent'} onClick={() => setSetView('recent')} label="Zuletzt aktiv">
                  <Clock size={17} />
                </ViewBtn>
                <ViewBtn active={setView === 'complete'} onClick={() => setSetView('complete')} label="Vollständigste">
                  <Percent size={17} />
                </ViewBtn>
              </div>
              <Link href="/sets" className="text-sm font-medium" style={{ color: 'var(--pokedex-red)' }}>Alle</Link>
            </div>
          </div>

          {displayedSets.length > 0 ? (
            <div className="bg-card rounded-2xl shadow-card overflow-hidden">
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
                />
              ))}
            </div>
          ) : (
            <div className="bg-card rounded-2xl shadow-card px-4 py-6 flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">
                {setView === 'favorites'
                  ? 'Noch keine Favoriten — scanne Karten um Sets zu befüllen.'
                  : 'Noch keine Karten in deiner Sammlung.'}
              </p>
              <Link
                href="/sets"
                className="text-sm font-medium px-4 py-2 rounded-xl"
                style={{ background: 'var(--pokedex-red)', color: '#fff' }}
              >
                Alle Zyklen & Sets ansehen
              </Link>
            </div>
          )}
        </section>
      )}

      {/* Zuletzt hinzugefügt */}
      {recentCards.length > 0 && (
        <section>
          <h2 className="text-base font-bold mb-3">Zuletzt hinzugefügt</h2>
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
            const fresh = await getCards().catch(() => [] as CardDoc[]);
            setCards(fresh);
            if (detailCard) setDetailOwned(fresh.filter(c => c.tcgId === detailCard.id));
          }}
        />
      )}

      {/* Leerer Zustand */}
      {!loading && (cards?.length ?? 0) === 0 && (
        <div className="flex flex-col items-center justify-center pt-16 gap-3 text-center">
          <div className="text-4xl">📦</div>
          <p className="text-sm font-medium">Noch keine Karten</p>
          <p className="text-xs text-muted-foreground max-w-[220px]">Scanne deine erste Karte oder suche sie in der Kartendatenbank.</p>
          <Link href="/scanner" className="mt-2 px-4 py-2 rounded-xl text-sm font-medium text-white" style={{ background: 'var(--pokedex-red)' }}>
            Karte scannen
          </Link>
        </div>
      )}

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
    <div className="bg-card rounded-[22px] shadow-card p-5 relative overflow-hidden">
      <div
        className="absolute pointer-events-none"
        style={{ top: -30, right: -30, width: 130, height: 130, borderRadius: 999, background: 'rgba(229,62,62,0.06)' }}
      />
      {heroCard?.tcgImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={heroCard.tcgImageUrl}
          alt=""
          aria-hidden="true"
          className="absolute pointer-events-none select-none"
          style={{
            top: '50%',
            right: -18,
            height: '70%',
            width: 'auto',
            aspectRatio: '63/88',
            objectFit: 'cover',
            transform: 'translateY(-50%) rotate(16deg)',
            opacity: 0.35,
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          }}
        />
      )}
      <div className="relative">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Karten in der Sammlung
        </span>
        <div className="flex items-baseline gap-2 mt-1">
          <span
            className="tabular-nums"
            style={{ fontSize: 46, fontWeight: 800, lineHeight: 1, color: 'var(--pokedex-red)', letterSpacing: '-.03em' }}
          >
            {(totalOwned ?? 0).toLocaleString('de')}
          </span>
          {thisWeek != null && thisWeek > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-xs font-bold rounded-full"
              style={{ background: '#E7F4EC', color: 'var(--action-add)', padding: '4px 9px' }}
            >
              <ArrowUp size={12} strokeWidth={3} />
              {thisWeek} diese Woche
            </span>
          )}
        </div>

        <div className="flex items-center mt-3.5 pt-3.5 border-t border-border/40">
          <span className="text-[13px] text-muted-foreground">Geschätzter Wert</span>
          <span className="text-lg font-extrabold ml-auto">{valueLabel}</span>
        </div>
      </div>
    </div>
  );
}

/** Kompakter Stat-Chip im 3er-Streifen (Sammlungen · Sets · Wunschliste). */
function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-[14px] shadow-card px-2 py-3 flex flex-col items-center gap-0.5">
      <span className="text-[22px] font-extrabold leading-none tabular-nums">{value}</span>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

function ViewBtn({ active, onClick, label, children }: {
  active: boolean; onClick: () => void; label: string; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="w-9 h-9 flex items-center justify-center rounded-full transition-colors"
      style={{
        background: active ? 'var(--card)' : undefined,
        boxShadow: active ? '0 1px 3px rgba(30,40,80,0.12)' : undefined,
        color: active ? 'var(--pokedex-red)' : 'var(--muted-foreground)',
      }}
    >
      {children}
    </button>
  );
}


function RecentCard({ name, img, onClick }: { name: string; img: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 text-left w-full">
      <div className="w-full aspect-[63/88] rounded-[11px] overflow-hidden bg-secondary shadow-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt={name} className="w-full h-full object-cover" />
      </div>
      <span className="text-[11px] font-semibold text-center truncate w-full mt-0.5">{name}</span>
    </button>
  );
}
