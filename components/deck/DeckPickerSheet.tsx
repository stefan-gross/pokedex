'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Minus } from 'lucide-react';
import { Sheet } from '@/components/ui/modal';
import { BinderIcon } from '@/lib/binder-icons';
import { getDecks, addCardToDeck, setDeckCardCount } from '@/lib/firestore/decks';
import { CreateDeckModal } from '@/components/deck/CreateDeckModal';
import type { CardInfo } from '@/lib/card-info';
import type { DeckDoc } from '@/types';

const FORMAT_LABEL: Record<string, string> = { standard: 'Standard', expanded: 'Expanded', unlimited: 'Unlimited' };

/**
 * Auswahl-Drawer „Zu Deck hinzufügen" — gespiegelt vom WishlistPickerSheet,
 * aber mit ANZAHL-Semantik (ein Deck hält n Exemplare je Karte, nicht binär):
 * je Deck ein Stepper (−/Anzahl/+). „Neues Deck" öffnet den vollen
 * CreateDeckModal. Mutationen laufen über die atomaren Rezept-Funktionen aus
 * lib/firestore/decks; der Deck-Editor spiegelt Änderungen beim nächsten Öffnen.
 */
export function DeckPickerSheet({ open, onClose, card }: {
  open: boolean;
  onClose: () => void;
  card: CardInfo;
}) {
  const [decks, setDecks] = useState<DeckDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setDecks(await getDecks()); }
    catch (e) { console.error('[deck-picker] load error', e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);

  const countIn = (d: DeckDoc) => d.cards.find(c => c.catalogId === card.id)?.count ?? 0;

  const change = async (deck: DeckDoc, next: number) => {
    if (busy) return;
    setBusy(true);
    // optimistisch
    setDecks(ds => ds.map(d => d.id !== deck.id ? d : applyCount(d, card.id, next)));
    try {
      if (next <= 0) await setDeckCardCount(deck.id, card.id, 0);
      else if (countIn(deck) === 0) await addCardToDeck(deck.id, card, next);
      else await setDeckCardCount(deck.id, card.id, next);
    } catch (e) {
      console.error('[deck-picker] mutate error', e);
      load();   // Zustand zurückholen
    } finally { setBusy(false); }
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Zu Deck hinzufügen" dragToClose elevated>
        <div className="flex flex-col gap-2">
          {loading ? (
            <p className="text-role-label text-glass-muted px-1 py-2">Lädt …</p>
          ) : decks.length === 0 ? (
            <p className="text-role-label text-glass-muted px-1 pb-1">Noch kein Deck — leg eins an.</p>
          ) : (
            <p className="text-role-label text-glass-muted px-1 pb-1">Anzahl je Deck</p>
          )}

          {decks.map(deck => {
            const n = countIn(deck);
            const bg = deck.color;
            return (
              <div key={deck.id} className="flex items-center gap-3 rounded-2xl px-3 py-2 glass-inner">
                <BinderIcon name={deck.icon ?? 'cards'} size={22} className="shrink-0 text-glass-muted" style={bg ? { color: bg } : undefined} />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold text-glass">{deck.name}</p>
                  <p className="truncate text-role-label text-glass-muted">
                    {FORMAT_LABEL[deck.format] ?? deck.format} · {deck.cards.reduce((s, c) => s + c.count, 0)}/60
                  </p>
                </div>
                {n > 0 ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => change(deck, n - 1)} disabled={busy} className="w-8 h-8 rounded-full flex items-center justify-center bg-black/10 dark:bg-white/15 disabled:opacity-50" aria-label="weniger">
                      <Minus size={16} />
                    </button>
                    <span className="w-5 text-center font-bold tabular-nums">{n}</span>
                    <button onClick={() => change(deck, n + 1)} disabled={busy} className="w-8 h-8 rounded-full flex items-center justify-center bg-black/10 dark:bg-white/15 disabled:opacity-50" aria-label="mehr">
                      <Plus size={16} />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => change(deck, 1)} disabled={busy} className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white disabled:opacity-50" style={{ background: '#3182ce' }} aria-label="hinzufügen">
                    <Plus size={18} strokeWidth={2.6} />
                  </button>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-full text-role-label text-glass-muted self-start mt-1"
            style={{ border: '1.5px dashed currentColor' }}
          >
            <Plus size={16} className="shrink-0" />
            Neues Deck
          </button>
        </div>
      </Sheet>

      {createOpen && (
        <CreateDeckModal
          onClose={() => setCreateOpen(false)}
          onSaved={load}
        />
      )}
    </>
  );
}

/** Optimistisches Count-Update auf einem Deck-Dokument (lokal, vor dem Write). */
function applyCount(deck: DeckDoc, catalogId: string, count: number): DeckDoc {
  const i = deck.cards.findIndex(c => c.catalogId === catalogId);
  let cards = deck.cards;
  if (count <= 0) cards = deck.cards.filter(c => c.catalogId !== catalogId);
  else if (i >= 0) cards = deck.cards.map(c => c.catalogId === catalogId ? { ...c, count } : c);
  // Neuer Eintrag: die denormalisierten Felder ergänzt der echte Write; für die
  // optimistische Anzeige (nur Zähler) reicht ein Minimal-Ref.
  else cards = [...deck.cards, { catalogId, count, name: '', setId: '', number: '', supertype: '' }];
  return { ...deck, cards };
}
