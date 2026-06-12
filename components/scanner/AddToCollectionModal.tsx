'use client';

import { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import type { CardInfo } from '@/lib/card-info';
import type { CardCondition, CardLanguage, CardVariant } from '@/types';
import { addCard } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder, ensureDefaultBinder } from '@/lib/firestore/binders';

const DEFAULT_ID = '__default__';
import { LANGUAGES, CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';
import type { BinderDoc } from '@/types';

interface Props {
  card: CardInfo;
  preVariant?: CardVariant;
  preCondition?: CardCondition;
  preLanguage?: CardLanguage;
  fromScanner?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function AddToCollectionModal({ card, preVariant, preCondition, preLanguage, fromScanner = false, onClose, onSaved }: Props) {
  const [variant, setVariant] = useState<CardVariant>(preVariant ?? (card.variants?.[0] as CardVariant) ?? 'standard');
  const variantOptions: CardVariant[] = (card.variants && card.variants.length > 0 ? card.variants : ['standard']) as CardVariant[];
  const [condition, setCondition] = useState<CardCondition>(preCondition ?? 'NM');
  const [language, setLanguage] = useState<CardLanguage>(preLanguage ?? 'de');
  const [selectedBinder, setSelectedBinder] = useState<string>(DEFAULT_ID);
  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Nur echte Sammlungen laden — isDefault-Binder wird durch den virtuellen Eintrag repräsentiert
    getBinders()
      .then(b => setBinders(b.filter(x => !x.isDefault)))
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
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
      if (selectedBinder === DEFAULT_ID) {
        const defaultId = await ensureDefaultBinder();
        await addCardToBinder(defaultId, cardId);
      } else if (selectedBinder) {
        await addCardToBinder(selectedBinder, cardId);
      }
      onSaved();
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full rounded-t-2xl bg-card border-t border-border p-4 pb-safe">
        <div className="w-10 h-1 rounded-full bg-border mx-auto mb-4" />

        {/* Variante + Zustand + Sprache */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Variante</span>
            <select
              value={variant}
              onChange={e => setVariant(e.target.value as CardVariant)}
              className="h-9 rounded-lg border border-border bg-secondary px-2 text-sm"
              disabled={variantOptions.length <= 1}
            >
              {variantOptions.map(v => <option key={v} value={v}>{VARIANT_LABELS[v]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Zustand</span>
            <select
              value={condition}
              onChange={e => setCondition(e.target.value as CardCondition)}
              className="h-9 rounded-lg border border-border bg-secondary px-2 text-sm"
            >
              {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.short}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Sprache</span>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value as CardLanguage)}
              className="h-9 rounded-lg border border-border bg-secondary px-2 text-sm"
            >
              {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </label>
        </div>

        {/* Sammlungs-Auswahl */}
        <div className="mb-4">
          <div className="text-xs text-muted-foreground mb-1.5">Sammlung</div>
          <div className="flex flex-wrap gap-2">
            {/* Virtueller Default-Eintrag — Binder wird erst beim Speichern angelegt */}
            {[{ id: DEFAULT_ID, name: 'Meine Sammlung', icon: undefined }, ...binders].map(b => (
              <button
                key={b.id}
                onClick={() => setSelectedBinder(b.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors"
                style={{
                  borderColor: selectedBinder === b.id ? 'var(--pokedex-red)' : 'var(--border)',
                  background: selectedBinder === b.id ? 'rgba(229,62,62,.1)' : 'var(--secondary)',
                  color: selectedBinder === b.id ? 'var(--pokedex-red)' : undefined,
                }}
              >
                {b.icon && <span>{b.icon}</span>}
                <span>{b.name}</span>
                {selectedBinder === b.id && <Check size={12} />}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="w-full h-11 rounded-xl font-semibold text-sm text-white disabled:opacity-50 transition-opacity"
          style={{ background: 'var(--pokedex-red)' }}
        >
          {saving ? 'Wird gespeichert…' : 'Zur Sammlung hinzufügen'}
        </button>
      </div>
    </div>
  );
}
