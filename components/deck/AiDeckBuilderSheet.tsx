'use client';

import { useState, useEffect } from 'react';
import { Sparkles, AlertTriangle, Wand2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ButtonGroup } from '@/components/ui/button-group';
import { CardImage } from '@/components/card/CardImage';
import { catalogCardToInfo } from '@/lib/card-info';
import { searchCatalogCards } from '@/lib/search/catalog-search';
import { getCards } from '@/lib/firestore/cards';
import { getBinders } from '@/lib/firestore/binders';
import { getCatalogCardsByIds, type CatalogCard } from '@/lib/firestore/catalog';
import { EnergyIcon, ENERGY_META, type EnergyType } from '@/components/ui/EnergyIcon';
import { buildCandidatePool, toPoolLines, hasBasicPokemonInPool, type PoolCard } from '@/lib/decks/pool';
import { assembleDeck, applyAiPicks, targetEnergyCount, type AiPick } from '@/lib/decks/generate';
import { pickArchetypeDeck } from '@/lib/decks/archetype-pick';
import { validateDeck } from '@/lib/decks/rules';
import { groupDeckRows } from '@/lib/decks/group';
import type { DeckCardRef, DeckFormat, DeckDoc } from '@/types';

type Ownership = 'owned' | 'prefer' | 'best';
type Strategy = 'balanced' | 'aggro' | 'control' | 'combo';

const STRATEGY_OPTS = [
  { value: 'balanced' as Strategy, label: 'Ausgewogen' },
  { value: 'aggro' as Strategy, label: 'Aggro' },
  { value: 'control' as Strategy, label: 'Kontrolle' },
  { value: 'combo' as Strategy, label: 'Combo' },
];
// Deck-relevante Typen (mit Basis-Energie / echten Angreifern).
const DECK_TYPES: EnergyType[] = ['Fire', 'Water', 'Grass', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon'];

const OWNERSHIP_OPTS = [
  { value: 'prefer' as Ownership, label: 'Bevorzugt eigene' },
  { value: 'owned' as Ownership, label: 'Nur eigene' },
  { value: 'best' as Ownership, label: 'Bestes Deck' },
];
const CATS = [
  { key: 'Pokémon', label: 'Pokémon' },
  { key: 'Trainer', label: 'Trainer' },
  { key: 'Energy', label: 'Energie' },
];

/**
 * KI-Deck-Generator (D8, Stufe b). Baut CLIENT-seitig einen Kandidaten-Pool,
 * lässt Gemini per Index daraus wählen (Server-Route), und übernimmt die
 * Auswahl nur nach Validierung/Reparatur (applyAiPicks) — Fallback ist der
 * regelbasierte Generator. Ergebnis = editierbarer Entwurf, erst „Übernehmen"
 * schreibt ins Deck.
 */
export function AiDeckBuilderSheet({ open, onClose, deck, onApplied }: {
  open: boolean;
  onClose: () => void;
  deck: DeckDoc;
  onApplied: () => void;
}) {
  // Form
  const [coreQuery, setCoreQuery] = useState('');
  const [coreResults, setCoreResults] = useState<CatalogCard[]>([]);
  const [core, setCore] = useState<CatalogCard | null>(null);
  const [selectedType, setSelectedType] = useState<EnergyType | null>(null);
  const [strategy, setStrategy] = useState<Strategy>('balanced');
  const [ownership, setOwnership] = useState<Ownership>('prefer');
  const [freeText, setFreeText] = useState('');
  const [keepExisting, setKeepExisting] = useState(deck.cards.length > 0);

  // Flow
  const [phase, setPhase] = useState<'form' | 'generating' | 'draft'>('form');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<DeckCardRef[]>([]);
  const [draftById, setDraftById] = useState<Map<string, CatalogCard>>(new Map());
  const [usedAi, setUsedAi] = useState(true);
  const [archetypeInfo, setArchetypeInfo] = useState<{ name: string; source: string; popularity: number; placing: number } | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => { if (open) { setPhase('form'); setError(''); setCore(null); setCoreQuery(''); setSelectedType(null); setKeepExisting(deck.cards.length > 0); } }, [open, deck.cards.length]);

  // Kern-Pokémon-Suche (nur Pokémon).
  useEffect(() => {
    const term = coreQuery.trim();
    const t = setTimeout(async () => {
      if (term.length < 2) { setCoreResults([]); return; }
      try {
        const { cards } = await searchCatalogCards(term, { displayLimit: 12, bridgeByDex: true });
        setCoreResults(cards.filter(c => c.supertype === 'Pokémon').slice(0, 6));
      } catch { setCoreResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [coreQuery]);

  const generate = async () => {
    setPhase('generating'); setError(''); setArchetypeInfo(null); setStatus('Sammle Kandidaten …');
    try {
      // Besitz-Quelle = NUR lose Karten in „Unsortiert" (Default-Binder), nicht
      // die in Sammlungen einsortierten — so baut der Generator aus dem freien
      // Kartenpool.
      const [owned, binders] = await Promise.all([getCards(), getBinders()]);
      const looseIds = new Set(binders.find(b => b.isDefault)?.cardIds ?? []);
      const ownedByTcgId = new Map<string, number>();
      for (const c of owned) {
        if (!c.tcgId || !looseIds.has(c.id)) continue;
        ownedByTcgId.set(c.tcgId, (ownedByTcgId.get(c.tcgId) ?? 0) + (c.quantity ?? 1));
      }

      if (!core && !coreQuery.trim() && !selectedType) {
        setError('Wähle eine Kern-Karte oder einen Typ.');
        setPhase('form'); return;
      }

      // „Bestes Deck": zuerst ein echtes Turnierdeck (Archetyp) versuchen —
      // resolvte Turnier-Deckliste statt KI-Bau. Fällt auf den KI-Weg zurück,
      // wenn kein passender Archetyp existiert.
      if (ownership === 'best') {
        setStatus('Suche bestes Turnierdeck …');
        try {
          const pick = await pickArchetypeDeck({
            type: core?.types?.[0] ?? selectedType ?? undefined,
            coreName: coreQuery.trim() || core?.name || undefined,
          });
          if (pick && pick.total >= 50) {
            const ids = [...new Set(pick.refs.map(c => c.catalogId))];
            const catCards = ids.length ? await getCatalogCardsByIds(ids) : [];
            setDraftById(new Map(catCards.map(c => [c.id, c])));
            setDraft(pick.refs);
            setUsedAi(false);
            setArchetypeInfo({ name: pick.name, source: pick.sourceLabel, popularity: pick.popularity, placing: pick.bestPlacing });
            setPhase('draft');
            return;
          }
        } catch (e) { console.error('[ai-deck] archetype pick', e); }
      }

      // Typ-Start: besten Angreifer des Typs aus dem Unsortiert-Besitz als Kern.
      let coreId = core?.id;
      if (!coreId && !coreQuery.trim() && selectedType) {
        setStatus(`Suche ${ENERGY_META[selectedType].de}-Kern aus „Unsortiert" …`);
        const ownedCatalog = ownedByTcgId.size ? await getCatalogCardsByIds([...ownedByTcgId.keys()]) : [];
        const stageR = (c: CatalogCard) => c.subtypes?.includes('Stage 2') ? 2 : c.subtypes?.includes('Stage 1') ? 1 : 0;
        const cands = ownedCatalog
          .filter(c => c.supertype === 'Pokémon' && (c.types ?? []).includes(selectedType))
          .sort((a, b) => (stageR(b) - stageR(a)) || ((b.hp ?? 0) - (a.hp ?? 0)));
        if (!cands[0]) {
          setError(`Keine besessenen ${ENERGY_META[selectedType].de}-Pokémon in „Unsortiert". Wähle eine Kern-Karte oder einen anderen Typ.`);
          setPhase('form'); return;
        }
        coreId = cands[0].id;
      }

      const params = {
        format: deck.format as DeckFormat,
        coreId,
        coreName: coreId ? undefined : coreQuery.trim() || undefined,
        type: core?.types?.[0] ?? selectedType ?? undefined,
        ownership,
      };
      const pool = await buildCandidatePool(params, ownedByTcgId);
      if (pool.length === 0 || !hasBasicPokemonInPool(pool)) {
        setError('Zu wenig Kandidaten — wähle eine Kern-Karte (mit Basis-Pokémon in der Linie).');
        setPhase('form'); return;
      }

      const existing = keepExisting ? deck.cards : [];
      setStatus('Gemini baut das Deck …');
      let picks: AiPick[] = [];
      try {
        const res = await fetch('/api/decks/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ poolLines: toPoolLines(pool), format: deck.format, strategy, freeText: freeText.trim() || undefined, ownership, existingCount: existing.reduce((s, c) => s + c.count, 0), energyTarget: targetEnergyCount(pool) }),
        });
        const data = await res.json();
        picks = Array.isArray(data.picks) ? data.picks : [];
      } catch { picks = []; }

      let cards: DeckCardRef[];
      let ai = picks.length > 0;
      if (ai) {
        cards = applyAiPicks(picks, { pool, existing });
        // Falls die KI-Auswahl unbrauchbar war (z.B. leer nach Filter), Fallback.
        if (cards.reduce((s, c) => s + c.count, 0) < 60) { cards = assembleDeck({ pool, existing }); ai = false; }
      } else {
        cards = assembleDeck({ pool, existing });
        ai = false;
      }

      const ids = [...new Set(cards.map(c => c.catalogId))];
      const catCards = ids.length ? await getCatalogCardsByIds(ids) : [];
      setDraftById(new Map(catCards.map(c => [c.id, c])));
      setDraft(cards);
      setUsedAi(ai);
      setPhase('draft');
    } catch (e) {
      console.error('[ai-deck] generate error', e);
      setError('Generierung fehlgeschlagen. Versuch es erneut.');
      setPhase('form');
    }
  };

  const apply = async () => {
    if (applying) return;
    setApplying(true);
    try {
      const { setDeckCards } = await import('@/lib/firestore/decks');
      await setDeckCards(deck.id, draft);
      onApplied();
      onClose();
    } catch (e) { console.error('[ai-deck] apply error', e); setError('Übernehmen fehlgeschlagen.'); }
    finally { setApplying(false); }
  };

  const total = draft.reduce((s, c) => s + c.count, 0);
  const validation = phase === 'draft' ? validateDeck(draft, draftById, deck.format) : null;

  return (
    <Sheet open={open} onClose={onClose} title="KI-Deck erstellen" dragToClose elevated>
      {phase === 'generating' ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
          <p className="text-role-label text-glass-muted">{status}</p>
        </div>
      ) : phase === 'draft' ? (
        <DraftView draft={draft} byId={draftById} total={total} validation={validation} usedAi={usedAi} archetypeInfo={archetypeInfo} applying={applying}
          onApply={apply} onBack={() => setPhase('form')} onRegenerate={generate} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Kern-Pokémon */}
          <label className="flex flex-col gap-1">
            <span className="text-role-label">Kern-Pokémon (optional)</span>
            {core ? (
              <div className="flex items-center gap-3 rounded-2xl px-3 py-2 glass-inner">
                <div className="w-9 shrink-0"><CardImage card={catalogCardToInfo(core)} size="small" alt={core.name} width={63} height={88} className="w-full rounded" /></div>
                <span className="flex-1 truncate text-sm font-semibold text-glass">{core.nameDe ?? core.name}</span>
                <Button variant="ghost" size="sm" onClick={() => { setCore(null); setCoreQuery(''); }}>Ändern</Button>
              </div>
            ) : (
              <>
                <Input value={coreQuery} onChange={setCoreQuery} placeholder="z. B. Glurak ex" autoFocus />
                {coreResults.length > 0 && (
                  <div className="flex flex-col gap-1 mt-1">
                    {coreResults.map(c => (
                      <button key={c.id} onClick={() => { setCore(c); setCoreResults([]); }} className="flex items-center gap-3 rounded-xl px-2 py-1.5 glass-inner text-left">
                        <div className="w-8 shrink-0"><CardImage card={catalogCardToInfo(c)} size="small" alt={c.name} width={63} height={88} className="w-full rounded" /></div>
                        <span className="flex-1 truncate text-role-label text-glass">{c.nameDe ?? c.name}</span>
                        <span className="text-role-label text-glass-muted shrink-0">{c.setCode ?? c.setId}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </label>

          {/* Typ-Start (Alternative zur Kern-Karte): Generator nimmt den besten
              Angreifer dieses Typs aus deinem Unsortiert-Pool als Kern. */}
          {!core && (
            <label className="flex flex-col gap-1">
              <span className="text-role-label">… oder Typ wählen</span>
              <div className="flex flex-wrap gap-2">
                {DECK_TYPES.map(t => {
                  const active = selectedType === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSelectedType(active ? null : t)}
                      aria-pressed={active}
                      aria-label={ENERGY_META[t].de}
                      className="w-10 h-10 rounded-full flex items-center justify-center transition-transform active:scale-90"
                      style={{ background: active ? ENERGY_META[t].bg : 'transparent', outline: active ? `2px solid ${ENERGY_META[t].bg}` : 'none', outlineOffset: 1, opacity: active ? 1 : 0.55 }}
                    >
                      <EnergyIcon type={t} size={26} />
                    </button>
                  );
                })}
              </div>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-role-label">Strategie</span>
            <ButtonGroup value={strategy} onChange={setStrategy} options={STRATEGY_OPTS} accentColor="#3182ce" />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-role-label">Sammlung</span>
            <ButtonGroup value={ownership} onChange={setOwnership} options={OWNERSHIP_OPTS} accentColor="#3182ce" />
            <span className="text-role-label text-muted-foreground">„Eigene" = lose Karten in „Unsortiert" (nicht in Sammlungen einsortierte)</span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-role-label">Zusatzwunsch (optional)</span>
            <Input value={freeText} onChange={setFreeText} placeholder="z. B. viel Kartenzug, wenig teure Karten" />
          </label>

          {deck.cards.length > 0 && (
            <Checkbox
              checked={keepExisting}
              onChange={setKeepExisting}
              accentColor="#3182ce"
              className="self-start"
              label={`Bestehende ${deck.cards.reduce((s, c) => s + c.count, 0)} Karten behalten (ergänzen)`}
            />
          )}

          {error && <p className="text-role-label" style={{ color: '#c53030' }}>{error}</p>}

          <Button variant="primary" accentColor="#3182ce" size="lg" onClick={generate} icon={<Wand2 size={18} />} className="w-full">
            Deck generieren
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function DraftView({ draft, byId, total, validation, usedAi, archetypeInfo, applying, onApply, onBack, onRegenerate }: {
  draft: DeckCardRef[];
  byId: Map<string, CatalogCard>;
  total: number;
  validation: ReturnType<typeof validateDeck> | null;
  usedAi: boolean;
  archetypeInfo: { name: string; source: string; popularity: number; placing: number } | null;
  applying: boolean;
  onApply: () => void;
  onBack: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold tabular-nums text-glass">{total}/60</span>
        <span className="flex items-center gap-1.5 text-role-label text-glass-muted">
          <Sparkles size={14} /> {archetypeInfo ? 'Turnierdeck' : usedAi ? 'Von Gemini gebaut' : 'Regelbasiert gebaut'}
        </span>
      </div>

      {archetypeInfo && (
        <div className="rounded-2xl px-3 py-2 flex flex-col gap-0.5" style={{ background: 'rgba(49,130,206,0.12)' }}>
          <span className="text-sm font-semibold text-glass">{archetypeInfo.name}</span>
          <span className="text-role-label text-glass-muted">
            {archetypeInfo.popularity}× in Turnieren · beste Platzierung #{archetypeInfo.placing}
          </span>
          <span className="text-role-label text-glass-muted truncate">Quelle: {archetypeInfo.source}</span>
        </div>
      )}

      {validation && !validation.valid && (
        <div className="rounded-2xl px-3 py-2 flex flex-col gap-1" style={{ background: 'rgba(183,121,31,0.12)' }}>
          {validation.issues.map((iss, i) => (
            <span key={i} className="flex items-center gap-1.5 text-role-label" style={{ color: '#b7791f' }}><AlertTriangle size={13} /> {iss.message}</span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 max-h-[46vh] overflow-auto" data-scroll-lock-allow>
        {CATS.map(cat => {
          const refs = draft.filter(c => (byId.get(c.catalogId)?.supertype ?? c.supertype) === cat.key);
          const groups = groupDeckRows(refs, byId).sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'));
          if (groups.length === 0) return null;
          const catTotal = groups.reduce((s, g) => s + g.total, 0);
          return (
            <section key={cat.key}>
              <h3 className="text-role-label font-bold uppercase tracking-wide text-glass-muted mb-1.5">{cat.label} · {catTotal}</h3>
              <div className="flex flex-col gap-1">
                {groups.map(g => (
                  <div key={g.key} className="flex items-center gap-2 text-role-label">
                    <span className="w-6 text-right font-bold tabular-nums shrink-0">{g.total}×</span>
                    <span className="truncate text-glass">{g.displayName}</span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Button variant="ghost" size="lg" onClick={onBack} className="flex-1">Zurück</Button>
        <Button variant="secondary" size="lg" onClick={onRegenerate} className="flex-1">Neu</Button>
        <Button variant="primary" accentColor="#2f855a" size="lg" onClick={onApply} disabled={applying} className="flex-1">
          {applying ? '…' : 'Übernehmen'}
        </Button>
      </div>
    </div>
  );
}
