'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import type { CardCondition, CardLanguage, CardVariant } from '@/types';
import { cardInfoToAddInput, type CardInfo } from '@/lib/card-info';
import { addCard } from '@/lib/firestore/cards';
import { addCardToBinder, ensureDefaultBinder } from '@/lib/firestore/binders';
import { VARIANT_LABELS } from '@/lib/card-constants';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

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

/** Mehrfach-Hinzufügen — landet alle Karten in „Unsortiert". KEINE gemeinsame
 *  Werte-Auswahl mehr: pro Karte werden die im Korrektur-Overlay eingestellten
 *  Werte (Variante/Zustand/Sprache) übernommen (Fallback Standard/NM/de). */
export function BulkAddToCollectionModal({ jobs, onClose, onJobSaved, onAllSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setProgress(0);
    try {
      const unsortedId = await ensureDefaultBinder();
      for (const job of jobs) {
        const card = job.card;
        // Werte JE KARTE (aus dem Scan/Korrektur), nicht global.
        const variant   = (job.editedVariant ?? card.variants?.[0] ?? 'standard') as CardVariant;
        const condition = (job.editedCondition ?? 'NM') as CardCondition;
        const language  = (job.language ?? 'de') as CardLanguage;
        try {
          const cardId = await addCard(
            cardInfoToAddInput(card, { variant, condition, language, needsReview: true }),
          );
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
      lockScroll={false}
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
        Jede Karte wird mit ihren eigenen Einstellungen (Variante/Zustand/Sprache)
        aus dem Scan bzw. Korrigieren übernommen. Sie landen in Unsortiert.
      </p>

      {/* Karten-Vorschau je Zeile mit den zu speichernden Werten. */}
      {jobs.length > 0 && (
        <div className="mb-4 max-h-56 overflow-y-auto rounded-lg glass-inner p-2">
          <ul className="text-xs space-y-1">
            {jobs.map(j => {
              const v = (j.editedVariant ?? j.card.variants?.[0] ?? 'standard') as CardVariant;
              const c = j.editedCondition ?? 'NM';
              const l = (j.language ?? 'de').toUpperCase();
              return (
                <li key={j.id} className="flex items-center gap-1.5">
                  <span className="font-mono text-glass-muted shrink-0">{j.card.setCode ?? '—'} {j.card.number}</span>
                  <span className="text-glass truncate">{j.card.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] font-semibold text-glass-muted">
                    {VARIANT_LABELS[v] ?? v} · {c} · {l}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
