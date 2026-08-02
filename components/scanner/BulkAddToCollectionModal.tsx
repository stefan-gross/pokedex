'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import type { CardCondition, CardLanguage, CardVariant } from '@/types';
import type { CardInfo } from '@/lib/card-info';
import { addCard } from '@/lib/firestore/cards';
import { addCardToBinder, ensureDefaultBinder } from '@/lib/firestore/binders';
import { LANGUAGES, CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { CustomSelect } from '@/components/ui/select';

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

/** Mehrfach-Hinzufügen — wie der Einzel-Drawer landen alle Karten IMMER in
 *  „Unsortiert" (dem dauerhaften Hub); keine Sammlungs-Auswahl. Zugeordnet wird
 *  danach von Hand (Vorschläge im Kartendetail / Seitenansicht). */
export function BulkAddToCollectionModal({ jobs, onClose, onJobSaved, onAllSaved }: Props) {
  // Default-Werte aus den Jobs ableiten (häufigster Wert)
  const defaultVariant   = (mode(jobs.map(j => j.editedVariant)) ?? 'standard') as CardVariant;
  const defaultCondition = (mode(jobs.map(j => j.editedCondition)) ?? 'NM') as CardCondition;
  const defaultLanguage  = (mode(jobs.map(j => j.language)) ?? 'de') as CardLanguage;

  const [variant, setVariant]     = useState<CardVariant>(defaultVariant);
  const [condition, setCondition] = useState<CardCondition>(defaultCondition);
  const [language, setLanguage]   = useState<CardLanguage>(defaultLanguage);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);

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
      const unsortedId = await ensureDefaultBinder();
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
            needsReview: true,
          });
          await addCardToBinder(unsortedId, cardId);
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
    <Sheet
      open
      onClose={saving ? () => {} : onClose}
      elevated
      title={`${jobs.length} ${jobs.length === 1 ? 'Karte' : 'Karten'} hinzufügen`}
      footer={
        <Button
          onClick={save}
          disabled={saving || jobs.length === 0}
          variant="primary"
          accentColor="#2f855a"
          size="lg"
          className="w-full"
          icon={saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} strokeWidth={2.5} />}
        >
          {saving
            ? `Speichere … ${progress}/${jobs.length}`
            : `${jobs.length} ${jobs.length === 1 ? 'Karte' : 'Karten'} zu Unsortiert`}
        </Button>
      }
    >
      <p className="text-xs text-glass-muted mb-3">
        Werte werden für alle ausgewählten Karten übernommen. Sie landen in Unsortiert.
      </p>

      {/* Variant + Condition */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-glass-muted">Variante</span>
          <CustomSelect fullWidth aria-label="Variante" value={variant} onChange={v => setVariant(v as CardVariant)}
            options={availableVariants.map(v => ({ value: v, label: VARIANT_LABELS[v] ?? v }))} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-glass-muted">Zustand</span>
          <CustomSelect fullWidth aria-label="Zustand" value={condition} onChange={v => setCondition(v as CardCondition)}
            options={CONDITIONS.map(c => ({ value: c.value, label: c.label }))} />
        </label>
      </div>

      {/* Sprache */}
      <label className="flex flex-col gap-1 mb-3">
        <span className="text-xs text-glass-muted">Sprache</span>
        <CustomSelect fullWidth aria-label="Sprache" value={language} onChange={v => setLanguage(v as CardLanguage)}
          options={LANGUAGES.map(l => ({ value: l.value, label: l.label }))} />
      </label>

      {/* Karten-Vorschau */}
      {jobs.length > 0 && (
        <div className="mb-4 max-h-32 overflow-y-auto rounded-lg glass-inner p-2">
          <ul className="text-xs text-glass-muted space-y-0.5">
            {jobs.map(j => (
              <li key={j.id} className="truncate">
                <span className="font-mono">{j.card.setCode ?? '—'} {j.card.number}</span> · {j.card.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
