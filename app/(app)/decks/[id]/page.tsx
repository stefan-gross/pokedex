'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Minus, Pencil, Check, AlertTriangle } from 'lucide-react';
import { getDeck, setDeckCardCount, addCardToDeck } from '@/lib/firestore/decks';
import { getCatalogCardsByIds, type CatalogCard } from '@/lib/firestore/catalog';
import { getCards } from '@/lib/firestore/cards';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { validateDeck } from '@/lib/decks/rules';
import { computeDeckDemand, type DeckDemand } from '@/lib/decks/demand';
import { CardImage } from '@/components/card/CardImage';
import { CreateDeckModal } from '@/components/deck/CreateDeckModal';
import { DeckCardSearchSheet } from '@/components/deck/DeckCardSearchSheet';
import { Button } from '@/components/ui/button';
import { formatEUR } from '@/lib/format';
import type { DeckDoc, DeckCardRef, CardDoc } from '@/types';

const FORMAT_LABEL: Record<string, string> = { standard: 'Standard', expanded: 'Expanded', unlimited: 'Unlimited' };
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'Pokémon', label: 'Pokémon' },
  { key: 'Trainer', label: 'Trainer' },
  { key: 'Energy',  label: 'Energie' },
];

export default function DeckEditorPage() {
  const params = useParams();
  const id = String(params.id);

  const [deck, setDeck] = useState<DeckDoc | null>(null);
  const [byId, setById] = useState<Map<string, CatalogCard>>(new Map());
  const [owned, setOwned] = useState<CardDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const loadDeck = async () => {
    try {
      const d = await getDeck(id);
      setDeck(d);
      const ids = d?.cards.map(c => c.catalogId) ?? [];
      if (ids.length) {
        const cs = await getCatalogCardsByIds(ids);
        setById(new Map(cs.map(c => [c.id, c])));
      } else {
        setById(new Map());
      }
    } catch (e) {
      console.error('[deck] load error', e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadDeck(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => { getCards().then(setOwned).catch(() => {}); }, []);

  const validation = useMemo(() => deck ? validateDeck(deck.cards, byId, deck.format) : null, [deck, byId]);
  const demand: DeckDemand | null = useMemo(() => deck ? computeDeckDemand(deck.cards, byId, owned) : null, [deck, byId, owned]);
  const counts = useMemo(() => new Map((deck?.cards ?? []).map(c => [c.catalogId, c.count])), [deck]);

  const changeCount = async (catalogId: string, count: number) => {
    if (!deck) return;
    await setDeckCardCount(deck.id, catalogId, count);
    loadDeck();
  };
  const addCard = async (card: CardInfo) => {
    if (!deck) return;
    await addCardToDeck(deck.id, card, 1);
    loadDeck();
  };

  if (loading) {
    return <div className="flex justify-center pt-16"><div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (!deck) {
    return <div className="p-6 text-center text-muted-foreground"><p>Deck nicht gefunden.</p><Button variant="ghost" href="/decks" className="mt-3">Zurück zu Decks</Button></div>;
  }

  const valueEur = deck.cards.reduce((s, c) => s + (byId.get(c.catalogId)?.priceEur ?? 0) * c.count, 0);

  return (
    <div className="px-4 pt-safe pb-28">
      {/* Header */}
      <div className="flex items-center gap-2 pt-3 pb-2">
        <Button variant="ghost" href="/decks" className="-ml-2 shrink-0">‹ Decks</Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{deck.name}</h1>
          <p className="text-role-label text-muted-foreground">{FORMAT_LABEL[deck.format] ?? deck.format} · {formatEUR(valueEur)}</p>
        </div>
        <Button variant="ghost" onClick={() => setEditOpen(true)} icon={<Pencil size={18} />} aria-label="Deck bearbeiten" className="shrink-0" />
      </div>

      {/* Live-Regel-Leiste */}
      {validation && (
        <div className="rounded-2xl px-4 py-3 mb-4 glass flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold tabular-nums">{validation.totalCount}/60</span>
            {validation.valid ? (
              <span className="flex items-center gap-1 text-sm font-semibold" style={{ color: '#2f855a' }}><Check size={16} /> Spielbar</span>
            ) : (
              <span className="flex items-center gap-1 text-sm font-semibold" style={{ color: '#c53030' }}>
                <AlertTriangle size={15} /> {validation.issues.filter(i => i.severity === 'block').length} Problem(e)
              </span>
            )}
          </div>
          {validation.issues.map((iss, i) => (
            <div key={i} className="text-role-label" style={{ color: iss.severity === 'block' ? '#c53030' : '#b7791f' }}>
              • {iss.message}
            </div>
          ))}
        </div>
      )}

      {/* Kategorie-Sektionen */}
      {deck.cards.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <p>Noch keine Karten. Füge über „+ Karte" welche hinzu.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {CATEGORIES.map(cat => {
            const rows = deck.cards
              .filter(c => (byId.get(c.catalogId)?.supertype ?? c.supertype) === cat.key)
              .sort((a, b) => a.name.localeCompare(b.name, 'de'));
            if (rows.length === 0) return null;
            const catTotal = rows.reduce((s, c) => s + c.count, 0);
            return (
              <section key={cat.key}>
                <h2 className="text-role-label font-bold uppercase tracking-wide text-muted-foreground mb-2">{cat.label} · {catTotal}</h2>
                <div className="flex flex-col gap-1.5">
                  {rows.map(ref => (
                    <DeckRow key={ref.catalogId} refCard={ref} card={byId.get(ref.catalogId)} demand={demand} onChange={changeCount} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Floating „+ Karte" */}
      <button
        onClick={() => setSearchOpen(true)}
        className="fixed left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 h-12 px-6 rounded-full font-semibold text-white shadow-lg"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)', background: '#2f855a' }}
      >
        <Plus size={18} strokeWidth={2.6} /> Karte
      </button>

      <DeckCardSearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        counts={counts}
        onAdd={addCard}
        onSetCount={changeCount}
      />
      {editOpen && (
        <CreateDeckModal existing={deck} onClose={() => setEditOpen(false)} onSaved={loadDeck} />
      )}
    </div>
  );
}

function DeckRow({ refCard, card, demand, onChange }: {
  refCard: DeckCardRef;
  card: CatalogCard | undefined;
  demand: DeckDemand | null;
  onChange: (catalogId: string, count: number) => void;
}) {
  const info: CardInfo = card
    ? catalogCardToInfo(card)
    : { id: refCard.catalogId, name: refCard.name, number: refCard.number, setId: refCard.setId, supertype: refCard.supertype, imgSmall: '', imgLarge: '' } as CardInfo;
  const own = demand?.perCard.get(refCard.catalogId);
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 shrink-0"><CardImage card={info} size="small" alt={refCard.name} width={63} height={88} className="w-full rounded" /></div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-semibold">{refCard.name}</p>
        <p className="truncate text-role-label text-muted-foreground">
          {own?.isBasicEnergy
            ? 'Basis-Energie'
            : own ? `habe ${own.owned}/${own.need}${own.owned < own.need ? ' · fehlt' : ''}` : `${refCard.setId} · ${refCard.number}`}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={() => onChange(refCard.catalogId, refCard.count - 1)} className="w-8 h-8 rounded-full flex items-center justify-center bg-black/10 dark:bg-white/15" aria-label="weniger"><Minus size={16} /></button>
        <span className="w-5 text-center font-bold tabular-nums">{refCard.count}</span>
        <button onClick={() => onChange(refCard.catalogId, refCard.count + 1)} className="w-8 h-8 rounded-full flex items-center justify-center bg-black/10 dark:bg-white/15" aria-label="mehr"><Plus size={16} /></button>
      </div>
    </div>
  );
}
