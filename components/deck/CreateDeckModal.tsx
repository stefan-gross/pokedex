'use client';

import { useState } from 'react';
import { addDeck, updateDeck } from '@/lib/firestore/decks';
import { IconPicker } from '@/components/binder/IconPicker';
import { ButtonGroup } from '@/components/ui/button-group';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DeckDoc, DeckFormat } from '@/types';

const COLORS = ['#1a1a1a', '#ffffff', '#e53e3e', '#4299e1', '#ecc94b', '#48bb78', '#667eea'];
const ACCENT = '#3182ce';          // Blau — Decks (Abgrenzung zum roten Sammlungs-Flow)
const ADD_ACCENT = '#2f855a';      // Hinzufügen-Grün
const PRIMARY_ACCENT = '#3182ce';

const FORMAT_OPTIONS = [
  { value: 'standard' as DeckFormat,  label: 'Standard' },
  { value: 'expanded' as DeckFormat,  label: 'Expanded' },
  { value: 'unlimited' as DeckFormat, label: 'Unlimited' },
];

interface Props {
  existing?: DeckDoc;
  onClose: () => void;
  onSaved: () => void;
}

export function CreateDeckModal({ existing, onClose, onSaved }: Props) {
  const [name,   setName]   = useState(existing?.name ?? '');
  const [icon,   setIcon]   = useState(existing?.icon ?? 'cards');
  const [color,  setColor]  = useState(existing?.color ?? '#4299e1');
  const [format, setFormat] = useState<DeckFormat>(existing?.format ?? 'standard');
  const [saving, setSaving] = useState(false);

  const isEdit = !!existing;

  const save = async () => {
    if (saving || !name.trim()) return;
    setSaving(true);
    try {
      if (isEdit) await updateDeck(existing!.id, { name: name.trim(), icon, color, format });
      else        await addDeck({ name: name.trim(), icon, color, format });
      onSaved();
      onClose();
    } catch (e) {
      console.error('[deck] save error', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={isEdit ? 'Deck bearbeiten' : 'Neues Deck'}
      footer={
        <Button
          variant="primary"
          accentColor={isEdit ? PRIMARY_ACCENT : ADD_ACCENT}
          size="lg"
          className="w-full"
          disabled={saving || !name.trim()}
          onClick={save}
        >
          {saving ? 'Wird gespeichert …' : isEdit ? 'Speichern' : 'Deck erstellen'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-role-label">Name</span>
          <Input value={name} onChange={setName} placeholder="z. B. Glurak-Kontrolle" autoFocus />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-role-label">Format</span>
          <ButtonGroup value={format} onChange={setFormat} options={FORMAT_OPTIONS} accentColor={ACCENT} />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-role-label">Symbol</span>
          <IconPicker value={icon} onChange={setIcon} accent={ACCENT} />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-role-label">Farbe</span>
          <div className="flex gap-2 flex-wrap">
            {COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Farbe ${c}`}
                className="w-9 h-9 rounded-full shrink-0 transition-transform active:scale-90"
                style={{
                  background: c,
                  border: '1.5px solid rgba(0,0,0,0.15)',
                  outline: color === c ? `2.5px solid ${ACCENT}` : 'none',
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
