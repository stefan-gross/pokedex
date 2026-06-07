'use client';

import Link from 'next/link';
import { Settings, Star, Clock, Percent } from 'lucide-react';
import { useState, useEffect } from 'react';
import { getCards } from '@/lib/firestore/cards';
import { getWishlists } from '@/lib/firestore/wishlists';
import { getSetById } from '@/lib/firestore/sets';
import { getCountFromServer, collection, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { SetListItem } from '@/components/set/SetListItem';
import type { CardDoc } from '@/types';

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
  const [wishlistCount, setWishlistCount] = useState<number | null>(null);
  const [setTotals, setSetTotals]   = useState<Record<string, number>>({});
  const [setMeta,   setSetMeta]     = useState<Record<string, { nameDe?: string; logoDe?: string; ptcgoCode?: string }>>({});

  useEffect(() => {
    getCards().then(setCards).catch(() => setCards([]));
    getWishlists()
      .then(wls => setWishlistCount(wls.reduce((s, w) => s + w.items.filter(i => !i.acquired).length, 0)))
      .catch(() => setWishlistCount(0));
  }, []);

  // Computed stats
  const totalOwned  = cards ? cards.reduce((s, c) => s + c.quantity, 0) : null;
  const uniqueSets  = cards ? new Set(cards.map(c => c.setId)).size : null;

  const weekAgo     = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek    = cards
    ? cards.filter(c => (c.addedAt?.toMillis?.() ?? 0) > weekAgo).reduce((s, c) => s + c.quantity, 0)
    : null;

  // Recently added — last 3 cards with image
  const recentCards = cards
    ? [...cards]
        .filter(c => c.tcgImageUrl)
        .sort((a, b) => (b.addedAt?.seconds ?? 0) - (a.addedAt?.seconds ?? 0))
        .slice(0, 3)
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
          .then(set => setSetMeta(prev => ({ ...prev, [setId]: { nameDe: set?.nameDe, logoDe: set?.logoUrl, ptcgoCode: set?.ptcgoCode } })))
          .catch(() => {});
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedSets.map(s => s.setId).join(','), setView]);

  const loading = cards === null;

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

      {/* Stat Tiles */}
      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center justify-between min-h-[68px]">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground font-medium">Sammlung</span>
            {thisWeek != null && thisWeek > 0 && (
              <span className="text-[10px] text-muted-foreground/60">+{thisWeek} diese Woche</span>
            )}
          </div>
          <div className="flex items-baseline gap-4">
            <div className="text-right">
              <div className="text-[26px] font-extrabold leading-none" style={{ color: 'var(--pokedex-red)' }}>
                {loading ? '—' : totalOwned?.toLocaleString('de')}
              </div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">Karten</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatTile
            label="Sets"
            sub={uniqueSets != null ? `${uniqueSets} mit Karten` : '…'}
            value={loading ? '—' : String(uniqueSets ?? 0)}
          />
          <StatTile
            label="Wunschliste"
            sub="Noch nicht vorhanden"
            value={wishlistCount == null ? '—' : String(wishlistCount)}
          />
        </div>
      </div>

      {/* Set-Vollständigkeit — immer sichtbar */}
      {!loading && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Sets</h2>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <ViewBtn active={setView === 'favorites'} onClick={() => setSetView('favorites')} label="Meiste Karten">
                  <Star size={13} />
                </ViewBtn>
                <ViewBtn active={setView === 'recent'} onClick={() => setSetView('recent')} label="Zuletzt aktiv">
                  <Clock size={13} />
                </ViewBtn>
                <ViewBtn active={setView === 'complete'} onClick={() => setSetView('complete')} label="Vollständigste">
                  <Percent size={13} />
                </ViewBtn>
              </div>
              <Link href="/sets" className="text-xs" style={{ color: 'var(--pokedex-red)' }}>Alle</Link>
            </div>
          </div>

          {displayedSets.length > 0 ? (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
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
                  href={`/sets/${s.setId}?from=dashboard`}
                  separator={i < displayedSets.length - 1}
                />
              ))}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl px-4 py-6 flex flex-col items-center gap-3 text-center">
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Zuletzt hinzugefügt</h2>
            <Link href="/collection" className="text-xs" style={{ color: 'var(--pokedex-red)' }}>Alle</Link>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {recentCards.map(card => (
              <RecentCard key={card.id} name={card.name} number={card.number} img={card.tcgImageUrl!} />
            ))}
          </div>
        </section>
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

function StatTile({ label, sub, value }: { label: string; sub: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-2 min-h-[68px]">
      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div className="text-xs text-muted-foreground font-medium">{label}</div>
        <div className="text-[10px] text-muted-foreground/60 mt-1">{sub}</div>
      </div>
      <div className="text-[28px] font-extrabold leading-none shrink-0">{value}</div>
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
      className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
      style={{
        background: active ? 'color-mix(in srgb, var(--pokedex-red) 12%, transparent)' : undefined,
        color: active ? 'var(--pokedex-red)' : 'var(--muted-foreground)',
      }}
    >
      {children}
    </button>
  );
}


function RecentCard({ name, number, img }: { name: string; number: string; img: string }) {
  return (
    <Link href="/collection" className="flex flex-col items-center gap-1">
      <div className="w-full aspect-[2/3] rounded-lg overflow-hidden bg-secondary border border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt={name} className="w-full h-full object-cover" />
      </div>
      <span className="text-[10px] text-muted-foreground text-center truncate w-full text-center">{number}</span>
    </Link>
  );
}
