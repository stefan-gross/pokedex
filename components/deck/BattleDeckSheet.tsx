'use client';

/**
 * „Fertige Decks" (gekaufte Battle Decks) auswählen und in einem Schritt als
 * Deck anlegen. Die Liste steht statisch in lib/decks/battle-decks.ts; beim
 * Öffnen einer Auswahl wird sie über resolvePtcglDeck gegen den Katalog
 * aufgelöst (Trefferquote im Preview). Optional werden die 60 Karten gleich als
 * Besitz in „Unsortiert" markiert, damit die Sammlung der Jungs stimmt.
 */
import { useState } from 'react';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { EnergyIcon, type EnergyType } from '@/components/ui/EnergyIcon';
import { BATTLE_DECKS, type BattleDeck } from '@/lib/decks/battle-decks';
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
  const [sel, setSel] = useState<BattleDeck | null>(null);
  const [resolved, setResolved] = useState<PtcglResolveResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [name, setName] = useState('');
  const [markOwned, setMarkOwned] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const pick = async (d: BattleDeck) => {
    setSel(d); setName(`${d.name} (${d.product})`); setResolved(null); setResolving(true); setError('');
    try { setResolved(await resolvePtcglDeck(d.ptcgl)); }
    catch { setError('Auflösung fehlgeschlagen.'); }
    finally { setResolving(false); }
  };

  const back = () => { setSel(null); setResolved(null); setError(''); };

  const create = async () => {
    if (!resolved || creating) return;
    setCreating(true); setError('');
    try {
      const refs: DeckCardRef[] = resolved.resolved.map(r => ({
        catalogId: r.card.id, count: r.count,
        name: r.card.nameDe ?? r.card.name, setId: r.card.setId, number: r.card.number, supertype: r.card.supertype,
      }));
      setProgress('Deck wird angelegt …');
      const deckId = await addDeck({ name: name.trim() || sel!.name, format: sel!.format });
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

  const total = sel ? [...(resolved?.resolved ?? [])].reduce((s, c) => s + c.count, 0) : 0;
  const expected = sel ? sel.ptcgl.match(/^(\d+)\s/gm)?.reduce((s, m) => s + parseInt(m), 0) ?? 0 : 0;
  const hit = expected ? Math.round((total / expected) * 100) : 0;

  return (
    <Sheet open={open} onClose={onClose} title={sel ? 'Fertiges Deck übernehmen' : 'Fertiges Deck wählen'}>
      {!sel ? (
        <div className="flex flex-col gap-2">
          <p className="text-role-label text-muted-foreground">
            Gekauftes Kampfdeck auswählen — es wird als spielbares Deck angelegt (optional gleich als Besitz).
          </p>
          {BATTLE_DECKS.map(d => (
            <button key={d.id} onClick={() => pick(d)} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 glass-inner text-left">
              <span className="flex gap-0.5 shrink-0">
                {d.types.map(t => <EnergyIcon key={t} type={t as EnergyType} size={20} />)}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate text-sm font-semibold">{d.name}</span>
                <span className="block text-role-label text-muted-foreground">{d.product} · {d.year}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{sel.name}</span>
            {resolving
              ? <span className="text-role-label text-muted-foreground">löst auf …</span>
              : <span className="text-lg font-bold tabular-nums" style={{ color: hit >= 100 ? '#2f855a' : hit >= 90 ? '#b7791f' : '#c53030' }}>{total}/{expected}</span>}
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

          <div className="flex gap-2">
            <Button variant="ghost" size="lg" onClick={back} disabled={creating} className="flex-1">Zurück</Button>
            <Button variant="primary" accentColor="#2f855a" size="lg" onClick={create} disabled={creating || resolving || !resolved} className="flex-1">
              {creating ? '…' : 'Als Deck anlegen'}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
