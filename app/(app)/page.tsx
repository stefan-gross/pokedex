'use client';

import Link from 'next/link';
import { Settings, Star, Clock, Percent } from 'lucide-react';
import { useState } from 'react';

type SetView = 'recent' | 'complete' | 'favorites';

interface SetEntry { name: string; code: string; setId: string; owned: number; total: number }

const SETS: Record<SetView, SetEntry[]> = {
  recent: [
    { name: 'Karmesin & Purpur',        code: 'SVI',  setId: 'sv1',     owned: 74, total: 94 },
    { name: 'Obsidianflammen',           code: 'OBF',  setId: 'sv3',     owned: 8,  total: 197 },
    { name: 'Entwicklungen in Paldea',  code: 'PAL',  setId: 'sv2',     owned: 31, total: 93 },
    { name: '151',                       code: 'MEW',  setId: 'sv3pt5',  owned: 12, total: 165 },
  ],
  complete: [
    { name: 'Karmesin & Purpur',        code: 'SVI',  setId: 'sv1',     owned: 74, total: 94 },
    { name: 'Entwicklungen in Paldea',  code: 'PAL',  setId: 'sv2',     owned: 31, total: 93 },
    { name: '151',                       code: 'MEW',  setId: 'sv3pt5',  owned: 12, total: 165 },
    { name: 'Obsidianflammen',           code: 'OBF',  setId: 'sv3',     owned: 8,  total: 197 },
  ],
  favorites: [
    { name: 'Basisset',                  code: 'BS',   setId: 'base1',   owned: 42, total: 102 },
    { name: 'Karmesin & Purpur',        code: 'SVI',  setId: 'sv1',     owned: 74, total: 94 },
    { name: '151',                       code: 'MEW',  setId: 'sv3pt5',  owned: 12, total: 165 },
    { name: 'Neo Genesis',               code: 'N1',   setId: 'neo1',    owned: 5,  total: 111 },
  ],
};

const RECENT_CARDS = [
  { name: 'Pikachu',      number: '049/198', img: 'https://images.pokemontcg.io/sv1/49.png' },
  { name: 'Charizard ex', number: '125/197', img: 'https://images.pokemontcg.io/sv3/125.png' },
  { name: 'Mewtwo',       number: '150/165', img: 'https://images.pokemontcg.io/mew/150.png' },
];

export default function DashboardPage() {
  const [setView, setSetView] = useState<SetView>('recent');

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
        {/* Sammlung — eine breite Box */}
        <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center justify-between min-h-[68px]">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground font-medium">Sammlung</span>
            <span className="text-[10px] text-muted-foreground/60">+12 diese Woche</span>
          </div>
          <div className="flex items-baseline gap-4">
            <div className="text-right">
              <div className="text-[26px] font-extrabold leading-none" style={{ color: 'var(--pokedex-red)' }}>847</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">Karten</div>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="text-right">
              <div className="text-[26px] font-extrabold leading-none">€ 1.240</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">Wert</div>
            </div>
          </div>
        </div>

        {/* Sets + Wunschliste */}
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Sets" sub="3 vollständig" value="12" />
          <StatTile label="Wunschliste" sub="2 günstig" value="34" />
        </div>
      </div>

      {/* Set-Vollständigkeit */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Sets</h2>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <ViewBtn active={setView === 'favorites'} onClick={() => setSetView('favorites')} label="Favoriten">
                <Star size={13} />
              </ViewBtn>
              <ViewBtn active={setView === 'recent'} onClick={() => setSetView('recent')} label="Zuletzt aktiv">
                <Clock size={13} />
              </ViewBtn>
              <ViewBtn active={setView === 'complete'} onClick={() => setSetView('complete')} label="Vollständigste">
                <Percent size={13} />
              </ViewBtn>
            </div>
            <Link href="/collection" className="text-xs" style={{ color: 'var(--pokedex-red)' }}>Alle</Link>
          </div>
        </div>
        <div className="space-y-2">
          {SETS[setView].map(s => (
            <SetProgress key={s.setId} {...s} />
          ))}
        </div>
      </section>

      {/* Zuletzt hinzugefügt */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Zuletzt hinzugefügt</h2>
          <Link href="/collection" className="text-xs" style={{ color: 'var(--pokedex-red)' }}>Alle</Link>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {RECENT_CARDS.map(card => (
            <RecentCard key={card.name} {...card} />
          ))}
        </div>
      </section>

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

function SetProgress({ name, code, setId, owned, total }: SetEntry) {
  const pct = Math.round((owned / total) * 100);
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2.5">
      <div className="flex items-center gap-3 mb-1.5">
        {/* Set Logo */}
        <div className="w-12 h-7 flex items-center justify-start shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://images.pokemontcg.io/${setId}/logo.png`}
            alt={name}
            className="max-h-7 max-w-[48px] object-contain"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-sm font-medium truncate">{name}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-mono text-muted-foreground/60 bg-secondary px-1.5 py-0.5 rounded">{code}</span>
              <span className="text-xs text-muted-foreground">{owned}/{total}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--pokedex-red)' }} />
      </div>
    </div>
  );
}

function RecentCard({ name, number, img }: { name: string; number: string; img: string }) {
  return (
    <Link href="/collection" className="flex flex-col items-center gap-1">
      <div className="w-full aspect-[2/3] rounded-lg overflow-hidden bg-secondary border border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt={name} className="w-full h-full object-cover" />
      </div>
      <span className="text-[10px] text-muted-foreground text-center">{number}</span>
    </Link>
  );
}
