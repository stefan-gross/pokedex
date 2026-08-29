'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Check, Sparkles } from 'lucide-react';
import { Sheet } from '@/components/ui/modal';
import { CardImage } from '@/components/card/CardImage';
import { catalogCardToInfo } from '@/lib/card-info';
import { computeDeckSuggestions, type DeckSuggestion, type SuggestionKind } from '@/lib/decks/suggestions';
import type { CatalogCard } from '@/lib/firestore/catalog';
import type { DeckCardRef, CardDoc, DeckFormat } from '@/types';

const KIND_LABEL: Record<SuggestionKind, string> = {
  evolution: 'Fehlende Evolutionsstufe',
  playset: 'Playset auffüllen',
  energy: 'Basis-Energie',
  staple: 'Bewährte Trainer-Karten',
};
const KIND_ORDER: SuggestionKind[] = ['evolution', 'playset', 'energy', 'staple'];

/**
 * Regelbasierte Vorschläge (KI-Stufe a). Zeigt konkrete Katalog-Karten mit
 * Grund + Anzahl; „Hinzufügen" übernimmt genau diese Karte ins Deck. Kein LLM
 * → jeder Vorschlag ist deterministisch und referenziert einen echten Druck.
 */
export function DeckSuggestionsSheet({ open, onClose, cards, byId, owned, format, onAdd }: {
  open: boolean;
  onClose: () => void;
  cards: DeckCardRef[];
  byId: Map<string, CatalogCard>;
  owned: CardDoc[];
  format: DeckFormat;
  onAdd: (card: CatalogCard, count: number) => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<DeckSuggestion[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  // Vorschläge NUR beim Öffnen berechnen (nicht bei jeder Deck-Mutation) — so
  // markiert „Hinzufügen" den Vorschlag mit Häkchen, statt die Liste neu zu
  // berechnen und die Häkchen zu verwerfen. Frische Vorschläge = Sheet erneut
  // öffnen. `cards`/`byId`/`owned`/`format` bewusst NICHT in den Deps.
  useEffect(() => {
    if (!open) return;
    setAdded(new Set());
    setLoading(true);
    let cancelled = false;
    computeDeckSuggestions(cards, byId, owned, format)
      .then(s => { if (!cancelled) setSuggestions(s); })
      .catch(e => { console.error('[suggestions] error', e); if (!cancelled) setSuggestions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const add = async (s: DeckSuggestion) => {
    if (busyId) return;
    setBusyId(s.card.id);
    try { await onAdd(s.card, s.addCount); setAdded(prev => new Set(prev).add(s.card.id)); }
    catch (e) { console.error('[suggestions] add error', e); }
    finally { setBusyId(null); }
  };

  const byKind = KIND_ORDER
    .map(k => ({ kind: k, items: suggestions.filter(s => s.kind === k) }))
    .filter(g => g.items.length > 0);

  return (
    <Sheet open={open} onClose={onClose} title="Vorschläge" dragToClose elevated>
      <div className="flex flex-col gap-4">
        {loading ? (
          <p className="text-role-label text-glass-muted px-1 py-2">Analysiere Deck …</p>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-glass-muted">
            <Sparkles size={32} strokeWidth={1.5} />
            <p className="max-w-xs text-role-label">Keine Vorschläge — dein Deck sieht schon rund aus (oder ist noch zu leer).</p>
          </div>
        ) : (
          byKind.map(group => (
            <section key={group.kind}>
              <h3 className="text-role-label font-bold uppercase tracking-wide text-glass-muted mb-2">{KIND_LABEL[group.kind]}</h3>
              <div className="flex flex-col gap-2">
                {group.items.map(s => {
                  const isAdded = added.has(s.card.id);
                  return (
                    <div key={s.card.id} className="flex items-center gap-3 rounded-2xl px-3 py-2 glass-inner">
                      <div className="w-9 shrink-0">
                        <CardImage card={catalogCardToInfo(s.card)} size="small" alt={s.card.nameDe ?? s.card.name} width={63} height={88} className="w-full rounded" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-semibold text-glass">{s.addCount}× {s.card.nameDe ?? s.card.name}</p>
                        <p className="truncate text-role-label text-glass-muted">
                          {s.reason}{s.ownedEnough ? ' · besitzt du' : ''}
                        </p>
                      </div>
                      {isAdded ? (
                        <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white" style={{ background: '#2f855a' }} aria-label="hinzugefügt">
                          <Check size={18} />
                        </span>
                      ) : (
                        <button onClick={() => add(s)} disabled={busyId === s.card.id} className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white disabled:opacity-50" style={{ background: '#3182ce' }} aria-label="hinzufügen">
                          <Plus size={18} strokeWidth={2.6} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </Sheet>
  );
}
