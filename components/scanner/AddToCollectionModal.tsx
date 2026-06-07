'use client';

import { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import type { TcgApiCard } from '@/lib/pokemon-tcg';
import type { CardCondition, CardLanguage, CardVariant } from '@/types';
import { addCard } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder } from '@/lib/firestore/binders';
import { LANGUAGES, CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';
import type { BinderDoc } from '@/types';

interface Props {
  card: TcgApiCard;
  preVariant?: CardVariant;
  preLanguage?: CardLanguage;
  fromScanner?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const VARIANTS: { value: CardVariant; label: string }[] = (
  Object.entries(VARIANT_LABELS) as [CardVariant, string][]
).map(([value, label]) => ({ value, label }));

export function AddToCollectionModal({ card, preVariant, preLanguage, fromScanner = false, onClose, onSaved }: Props) {
  const [variant, setVariant] = useState<CardVariant>(preVariant ?? 'standard');
  const [condition, setCondition] = useState<CardCondition>('NM');
  const [language, setLanguage] = useState<CardLanguage>(preLanguage ?? 'de');
  const [quantity, setQuantity] = useState(1);
  const [selectedBinders, setSelectedBinders] = useState<string[]>([]);
  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getBinders().then(setBinders).catch(() => {});
  }, []);

  const toggleBinder = (id: string) => {
    setSelectedBinders(prev =>
      prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const cardId = await addCard({
        tcgId: card.id,
        name: card.name,
        setId: card.set.id,
        setName: card.set.name,
        series: card.set.series,
        number: card.number,
        rarity: card.rarity,
        pokemonType: card.types?.[0],
        supertype: card.supertype,
        variant,
        condition,
        language,
        isFoil: variant === 'holo',
        isFirstEd: variant === '1st-ed',
        quantity,
        tcgImageUrl: card.images.large,
        ...(fromScanner ? { needsReview: true } : {}),
      });
      if (fromScanner) window.dispatchEvent(new Event('review-count-changed'));
      await Promise.all(selectedBinders.map(b => addCardToBinder(b, cardId)));
      onSaved();
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full rounded-t-2xl bg-card border-t border-border p-4 pb-safe">
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-border mx-auto mb-4" />

        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className="w-12 h-[67px] rounded-lg overflow-hidden bg-secondary shrink-0 border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.images.small} alt={card.name} className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm leading-tight">{card.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{card.set.name} · {card.number}/{card.set.printedTotal ?? card.set.total}</div>
            {card.rarity && <div className="text-xs text-muted-foreground">{card.rarity}</div>}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0">
            <X size={14} />
          </button>
        </div>

        {/* Variant + Condition */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Variante</span>
            <select
              value={variant}
              onChange={e => setVariant(e.target.value as CardVariant)}
              className="h-9 rounded-lg border border-border bg-secondary px-2 text-sm"
            >
              {VARIANTS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Zustand</span>
            <select
              value={condition}
              onChange={e => setCondition(e.target.value as CardCondition)}
              className="h-9 rounded-lg border border-border bg-secondary px-2 text-sm"
            >
              {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
        </div>

        {/* Language + Quantity */}
        <div className="grid grid-cols-2 gap-2 mb-3">
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
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Anzahl</span>
            <div className="h-9 flex items-center rounded-lg border border-border bg-secondary overflow-hidden">
              <button
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                className="w-9 h-full flex items-center justify-center text-lg font-bold shrink-0"
              >−</button>
              <span className="flex-1 text-center text-sm font-semibold">{quantity}</span>
              <button
                onClick={() => setQuantity(q => q + 1)}
                className="w-9 h-full flex items-center justify-center text-lg font-bold shrink-0"
              >+</button>
            </div>
          </div>
        </div>

        {/* Binder assignment */}
        {binders.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-muted-foreground mb-1.5">Sammlung zuordnen</div>
            <div className="flex flex-wrap gap-2">
              {binders.map(b => (
                <button
                  key={b.id}
                  onClick={() => toggleBinder(b.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors"
                  style={{
                    borderColor: selectedBinders.includes(b.id) ? 'var(--pokedex-red)' : 'var(--border)',
                    background: selectedBinders.includes(b.id) ? 'rgba(229,62,62,.1)' : 'var(--secondary)',
                    color: selectedBinders.includes(b.id) ? 'var(--pokedex-red)' : undefined,
                  }}
                >
                  {b.icon && <span>{b.icon}</span>}
                  <span>{b.name}</span>
                  {selectedBinders.includes(b.id) && <Check size={12} />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Save button */}
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
