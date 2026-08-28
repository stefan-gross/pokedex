'use client';

import { useState, useMemo, useCallback } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { CardImage } from '@/components/card/CardImage';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { drawTestHand, expandDeck, OPENING_HAND_SIZE } from '@/lib/decks/test-hand';
import { isBasicPokemon } from '@/lib/decks/rules';
import type { CatalogCard } from '@/lib/firestore/catalog';
import type { DeckCardRef } from '@/types';

/**
 * Testhand-Ziehen (nutzt drawTestHand aus lib/decks/test-hand.ts). Zieht 7
 * Karten, markiert Mulligan (keine Basis-Pokémon) und zeigt zusätzlich eine
 * simulierte Mulligan-Quote über viele Ziehungen — als grobe Konsistenz-Hilfe.
 */
export function TestHandSheet({ open, onClose, cards, byId }: {
  open: boolean;
  onClose: () => void;
  cards: DeckCardRef[];
  byId: Map<string, CatalogCard>;
}) {
  const [seed, setSeed] = useState(0);   // Neu-Ziehen-Trigger
  const deckSize = useMemo(() => expandDeck(cards).length, [cards]);

  // Neue Ziehung je Klick. drawTestHand nutzt Math.random — `seed` erzwingt nur
  // ein Neu-Rechnen des useMemo (der Wert selbst geht nicht in den RNG ein).
  const result = useMemo(() => drawTestHand(cards, byId), [cards, byId, seed]);

  // Grobe Mulligan-Quote: 500 Ziehungen simulieren (rein clientseitig, günstig).
  const mulliganRate = useMemo(() => {
    if (deckSize === 0) return 0;
    const N = 500;
    let m = 0;
    for (let i = 0; i < N; i++) if (drawTestHand(cards, byId).mulligan) m++;
    return Math.round((m / N) * 100);
  }, [cards, byId]);

  const infoFor = useCallback((id: string): CardInfo => {
    const c = byId.get(id);
    if (c) return catalogCardToInfo(c);
    const ref = cards.find(r => r.catalogId === id);
    return { id, name: ref?.name ?? '', number: ref?.number ?? '', setId: ref?.setId ?? '', supertype: ref?.supertype, imgSmall: '', imgLarge: '' } as CardInfo;
  }, [byId, cards]);

  return (
    <Sheet open={open} onClose={onClose} title="Testhand" dragToClose elevated>
      <div className="flex flex-col gap-4">
        {deckSize === 0 ? (
          <p className="text-role-label text-glass-muted px-1">Noch keine Karten im Deck.</p>
        ) : (
          <>
            {result.mulligan ? (
              <div className="rounded-2xl px-4 py-3 flex items-center gap-2 text-sm font-semibold" style={{ background: 'rgba(197,48,48,0.12)', color: '#c53030' }}>
                <AlertTriangle size={16} className="shrink-0" /> Mulligan — kein Basis-Pokémon in der Hand
              </div>
            ) : (
              <div className="rounded-2xl px-4 py-3 text-sm font-semibold" style={{ background: 'rgba(47,133,90,0.12)', color: '#2f855a' }}>
                Startbereit — Basis-Pokémon vorhanden
              </div>
            )}

            <div className="grid grid-cols-4 gap-2">
              {result.hand.map((id, i) => {
                const info = infoFor(id);
                const basic = isBasicPokemon(byId.get(id));
                return (
                  <div key={i} className="relative">
                    <CardImage card={info} size="small" alt={info.name} width={63} height={88} className="w-full rounded-lg" />
                    {basic && <span className="absolute top-1 left-1 w-2.5 h-2.5 rounded-full ring-1 ring-white" style={{ background: '#2f855a' }} title="Basis-Pokémon" />}
                  </div>
                );
              })}
            </div>

            <p className="text-role-label text-glass-muted px-1">
              {result.hand.length} von {OPENING_HAND_SIZE} gezogen · Deck {deckSize} Karten · simulierte Mulligan-Quote ~{mulliganRate}%
            </p>

            <Button variant="secondary" size="lg" onClick={() => setSeed(s => s + 1)} icon={<RefreshCw size={18} />} className="w-full">
              Neu ziehen
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
