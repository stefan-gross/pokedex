'use client';

import { useState, useEffect } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import type { CardCondition, CardLanguage, CardVariant, BinderDoc } from '@/types';
import type { CardInfo } from '@/lib/card-info';
import { addCard } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder, ensureDefaultBinder } from '@/lib/firestore/binders';
import { LANGUAGES, CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';

const DEFAULT_ID = '__default__';

export interface BulkJob {
  id: string;
  card: CardInfo;
  language?: CardLanguage;
  editedVariant?: CardVariant;
  editedCondition?: CardCondition;
}

interface Props {
  jobs: BulkJob[];
  onClose: () => void;
  /** Aufgerufen je Job nach erfolgreichem Speichern — z. B. um `added: true` zu setzen. */
  onJobSaved: (jobId: string) => void;
  /** Aufgerufen wenn alle Jobs gespeichert sind. */
  onAllSaved: () => void;
}

/** Häufigsten Wert aus einer Liste ermitteln; bei Gleichstand erster Treffer. */
function mode<T extends string | undefined>(items: T[]): T | undefined {
  const counts = new Map<T, number>();
  let best: T | undefined; let bestN = 0;
  for (const x of items) {
    if (x === undefined) continue;
    const n = (counts.get(x) ?? 0) + 1;
    counts.set(x, n);
    if (n > bestN) { best = x; bestN = n; }
  }
  return best;
}

export function BulkAddToCollectionModal({ jobs, onClose, onJobSaved, onAllSaved }: Props) {
  // Default-Werte aus den Jobs ableiten (häufigster Wert)
  const defaultVariant   = (mode(jobs.map(j => j.editedVariant)) ?? 'standard') as CardVariant;
  const defaultCondition = (mode(jobs.map(j => j.editedCondition)) ?? 'NM') as CardCondition;
  const defaultLanguage  = (mode(jobs.map(j => j.language)) ?? 'de') as CardLanguage;

  const [variant, setVariant]     = useState<CardVariant>(defaultVariant);
  const [condition, setCondition] = useState<CardCondition>(defaultCondition);
  const [language, setLanguage]   = useState<CardLanguage>(defaultLanguage);
  const [selectedBinder, setSelectedBinder] = useState<string>(DEFAULT_ID);
  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    getBinders()
      .then(b => setBinders(b.filter(x => !x.isDefault && !x.isInbox)))
      .catch(() => {});
  }, []);

  // Verfügbare Varianten = Schnittmenge aller Job-Karten — fallback alle
  const availableVariants: CardVariant[] = (() => {
    const all = jobs.map(j => new Set(j.card.variants ?? ['standard']));
    if (all.length === 0) return ['standard'];
    const intersection = [...all[0]].filter(v => all.every(s => s.has(v))) as CardVariant[];
    return intersection.length ? intersection : ['standard'];
  })();

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setProgress(0);
    try {
      const binderId = selectedBinder === DEFAULT_ID
        ? await ensureDefaultBinder()
        : selectedBinder;
      for (const job of jobs) {
        const card = job.card;
        try {
          const cardId = await addCard({
            tcgId: card.id,
            name: card.name,
            setId: card.setId,
            setName: card.setName,
            series: card.series,
            number: card.number,
            rarity: card.rarity,
            pokemonType: card.types?.[0],
            supertype: card.supertype,
            variant,
            condition,
            language,
            isFoil: variant === 'holo',
            isFirstEd: variant === '1st-ed',
            quantity: 1,
            tcgImageUrl: card.imgLargeDe || card.imgLarge,
          });
          await addCardToBinder(binderId, cardId);
          onJobSaved(job.id);
        } catch (err) {
          console.error('[bulk-modal] error for job', job.id, err);
        }
        setProgress(p => p + 1);
      }
      onAllSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={saving ? undefined : onClose} />

      <div className="relative w-full rounded-t-2xl bg-card border-t border-border p-4 pb-safe max-h-[85vh] overflow-y-auto">
        <div className="w-10 h-1 rounded-full bg-border mx-auto mb-4" />

        <h2 className="text-base font-semibold mb-1">
          {jobs.length} {jobs.length === 1 ? 'Karte' : 'Karten'} hinzufügen
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Werte werden für alle ausgewählten Karten übernommen.
        </p>

        {/* Variant + Condition */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Variante</span>
            <select
              value={variant}
              onChange={e => setVariant(e.target.value as CardVariant)}
              className="h-9 rounded-lg border border-border bg-secondary px-2 text-sm"
              disabled={saving}
            >
              {availableVariants.map(v => (
                <option key={v} value={v}>{VARIANT_LABELS[v] ?? v}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Zustand</span>
            <select
              value={condition}
              onChange={e => setCondition(e.target.value as CardCondition)}
              className="h-9 rounded-lg border border-border bg-secondary px-2 text-sm"
              disabled={saving}
            >
              {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
        </div>

        {/* Sprache */}
        <label className="flex flex-col gap-1 mb-3">
          <span className="text-xs text-muted-foreground">Sprache</span>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value as CardLanguage)}
            className="h-9 rounded-lg border border-border bg-secondary px-2 text-sm"
            disabled={saving}
          >
            {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>

        {/* Sammlung */}
        <div className="mb-4">
          <div className="text-xs text-muted-foreground mb-1.5">Sammlung</div>
          <div className="flex flex-wrap gap-2">
            {[{ id: DEFAULT_ID, name: 'Meine Sammlung', icon: undefined } as { id: string; name: string; icon?: string }, ...binders].map(b => (
              <button
                key={b.id}
                onClick={() => setSelectedBinder(b.id)}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors"
                style={{
                  borderColor: selectedBinder === b.id ? 'var(--pokedex-red)' : 'var(--border)',
                  background: selectedBinder === b.id ? 'rgba(229,62,62,.1)' : 'var(--secondary)',
                  color: selectedBinder === b.id ? 'var(--pokedex-red)' : undefined,
                }}
              >
                {'icon' in b && b.icon ? <span>{b.icon}</span> : null}
                <span>{b.name}</span>
                {selectedBinder === b.id && <Check size={12} />}
              </button>
            ))}
          </div>
        </div>

        {/* Karten-Vorschau */}
        {jobs.length > 0 && (
          <div className="mb-4 max-h-32 overflow-y-auto rounded-lg border border-border bg-secondary/40 p-2">
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {jobs.map(j => (
                <li key={j.id} className="truncate">
                  <span className="font-mono">{j.card.setCode ?? '—'} {j.card.number}</span> · {j.card.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          onClick={save}
          disabled={saving || jobs.length === 0}
          className="w-full h-11 rounded-md font-semibold text-sm text-white disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
          style={{ background: 'var(--action-add)' }}
        >
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Speichere … {progress}/{jobs.length}
            </>
          ) : (
            <>
              <Plus size={18} strokeWidth={2.5} />
              {jobs.length} {jobs.length === 1 ? 'Karte' : 'Karten'} hinzufügen
            </>
          )}
        </button>
      </div>
    </div>
  );
}
