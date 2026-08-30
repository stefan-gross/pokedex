'use client';

/**
 * „Fertige Decks" (gekaufte Battle Decks) über ein Dropdown auswählen und in
 * einem Schritt als Deck anlegen. Liste statisch in lib/decks/battle-decks.ts;
 * bei Auswahl wird sie über resolvePtcglDeck gegen den Katalog aufgelöst
 * (Trefferquote im Preview). Optional werden die 60 Karten gleich als Besitz in
 * „Unsortiert" markiert. Als Deck-Cover dient das Artwork der Namensgeber-ex-Karte.
 */
import { useState, useMemo } from 'react';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchableSelect } from '@/components/ui/select';
import { EnergyIcon, ENERGY_META, type EnergyType } from '@/components/ui/EnergyIcon';
import { BATTLE_DECKS, PRODUCT_DE, type BattleDeck } from '@/lib/decks/battle-decks';
import { resolvePtcglDeck, type PtcglResolveResult } from '@/lib/decks/ptcgl';
import { catalogCardToInfo, cardInfoToAddInput } from '@/lib/card-info';
import { addDeck, setDeckCards } from '@/lib/firestore/decks';
import { addCard } from '@/lib/firestore/cards';
import { ensureDefaultBinder, addCardToBinder } from '@/lib/firestore/binders';
import type { DeckCardRef } from '@/types';

export function BattleDeckSheet({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (deckId: string) => void;
}) {
  const [selId, setSelId] = useState('');
  const [resolved, setResolved] = useState<PtcglResolveResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [name, setName] = useState('');
  const [markOwned, setMarkOwned] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const sel = useMemo(() => BATTLE_DECKS.find(d => d.id === selId) ?? null, [selId]);

  const options = useMemo(() => BATTLE_DECKS.map(d => ({
    value: d.id,
    label: d.nameDe,
    hint: `${PRODUCT_DE[d.product]} · Lvl ${d.level}`,
    keywords: [d.name, d.nameDe, d.product, PRODUCT_DE[d.product]].join(' '),
    icon: <EnergyIcon type={d.types[0] as EnergyType} size={16} />,
  })), []);

  const pick = async (id: string) => {
    const d = BATTLE_DECKS.find(x => x.id === id);
    setSelId(id); setResolved(null); setError('');
    if (!d) return;
    setName(`${d.nameDe} (${PRODUCT_DE[d.product]})`);
    setResolving(true);
    try { setResolved(await resolvePtcglDeck(d.ptcgl)); }
    catch { setError('Auflösung fehlgeschlagen.'); }
    finally { setResolving(false); }
  };

  const create = async () => {
    if (!resolved || !sel || creating) return;
    setCreating(true); setError('');
    try {
      const refs: DeckCardRef[] = resolved.resolved.map(r => ({
        catalogId: r.card.id, count: r.count,
        name: r.card.nameDe ?? r.card.name, setId: r.card.setId, number: r.card.number, supertype: r.card.supertype,
      }));
      // Cover = Namensgeber-ex-Karte (sonst erstes Pokémon).
      const feat = resolved.resolved.find(r => r.card.supertype === 'Pokémon' && (r.card.subtypes?.includes('ex') || /\bex$/i.test(r.card.name)))
        ?? resolved.resolved.find(r => r.card.supertype === 'Pokémon');

      setProgress('Deck wird angelegt …');
      const deckId = await addDeck({
        name: name.trim() || sel.nameDe,
        format: sel.format,
        color: ENERGY_META[sel.types[0] as EnergyType]?.bg,
        coverCardId: feat?.card.id,
      });
      await setDeckCards(deckId, refs);

      if (markOwned) {
        const binderId = await ensureDefaultBinder();
        let i = 0;
        for (const r of resolved.resolved) {
          setProgress(`Karten als Besitz markieren … (${++i}/${resolved.resolved.length})`);
          const input = { ...cardInfoToAddInput(catalogCardToInfo(r.card), { variant: 'standard', condition: 'NM', language: 'de' }), quantity: r.count };
          const cardId = await addCard(input);
          await addCardToBinder(binderId, cardId);
        }
      }
      onCreated(deckId);
    } catch (e) {
      console.error('[battle-deck] create error', e);
      setError('Anlegen fehlgeschlagen.');
    } finally { setCreating(false); setProgress(''); }
  };

  const total = resolved?.resolved.reduce((s, c) => s + c.count, 0) ?? 0;
  const expected = sel ? sel.ptcgl.match(/^(\d+)\s/gm)?.reduce((s, m) => s + parseInt(m), 0) ?? 0 : 0;

  return (
    <Sheet open={open} onClose={onClose} title="Fertiges Deck übernehmen">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-role-label">Gekauftes Kampfdeck</span>
          <SearchableSelect
            value={selId}
            onChange={pick}
            options={options}
            height="sm"
            fullWidth
            searchPlaceholder="Deck suchen …"
            placeholder="Deck wählen …"
            aria-label="Fertiges Deck"
          />
        </label>

        {sel && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-role-label text-muted-foreground">
                {sel.name} · {sel.year} · {sel.format === 'standard' ? 'Standard' : 'Expanded'}
              </span>
              {resolving
                ? <span className="text-role-label text-muted-foreground">löst auf …</span>
                : <span className="text-lg font-bold tabular-nums" style={{ color: total >= expected ? '#2f855a' : total >= expected * 0.9 ? '#b7791f' : '#c53030' }}>{total}/{expected}</span>}
            </div>

            {resolved && resolved.unresolved.length > 0 && (
              <div className="rounded-xl px-3 py-2 flex flex-col gap-0.5" style={{ background: 'rgba(197,48,48,0.10)' }}>
                <span className="text-role-label font-semibold" style={{ color: '#c53030' }}>Nicht aufgelöst ({resolved.unresolved.length})</span>
                {resolved.unresolved.map((u, i) => <span key={i} className="text-role-label text-muted-foreground truncate">{u.raw} — {u.reason}</span>)}
              </div>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-role-label">Deckname</span>
              <Input value={name} onChange={setName} placeholder="Deckname" />
            </label>

            <Checkbox checked={markOwned} onChange={setMarkOwned} accentColor="#3182ce" className="self-start"
              label="Karten als Besitz markieren (in Unsortiert)" />

            {resolved && (
              <div className="flex flex-col gap-0.5 max-h-[32vh] overflow-auto" data-scroll-lock-allow>
                {resolved.resolved.map(r => (
                  <div key={r.card.id} className="text-role-label flex justify-between gap-2">
                    <span className="truncate">{r.count}× {r.card.nameDe ?? r.card.name}</span>
                    <span className="text-muted-foreground shrink-0">{r.card.setCode} {r.card.number}</span>
                  </div>
                ))}
              </div>
            )}

            {error && <p className="text-role-label" style={{ color: '#c53030' }}>{error}</p>}
            {progress && <p className="text-role-label text-muted-foreground">{progress}</p>}

            <Button variant="primary" accentColor="#2f855a" size="lg" onClick={create} disabled={creating || resolving || !resolved} className="w-full">
              {creating ? '…' : 'Als Deck anlegen'}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
