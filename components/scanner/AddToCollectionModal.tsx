'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Search } from 'lucide-react';
import type { CardInfo } from '@/lib/card-info';
import type { CardCondition, CardLanguage, CardVariant } from '@/types';
import { addCard } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder, ensureDefaultBinder } from '@/lib/firestore/binders';
import { LANGUAGES, CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';
import type { BinderDoc } from '@/types';

const CLOSE_ANIM_MS = 250;

interface Props {
  card: CardInfo;
  preVariant?: CardVariant;
  preCondition?: CardCondition;
  preLanguage?: CardLanguage;
  fromScanner?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function AddToCollectionModal({
  card, preVariant, preCondition, preLanguage,
  // fromScanner momentan ungenutzt — Prop bleibt für die Aufrufer-Kompatibilität
  fromScanner: _fromScanner = false,
  onClose, onSaved,
}: Props) {
  const [variant, setVariant] = useState<CardVariant>(preVariant ?? (card.variants?.[0] as CardVariant) ?? 'standard');
  const variantOptions: CardVariant[] = (card.variants && card.variants.length > 0 ? card.variants : ['standard']) as CardVariant[];
  const [condition, setCondition] = useState<CardCondition>(preCondition ?? 'NM');
  const [language, setLanguage] = useState<CardLanguage>(preLanguage ?? 'de');
  // Explizite Sammlungs-Auswahl (ohne Default). Leer = „Meine Sammlung" wird beim Speichern genutzt.
  const [selectedBinders, setSelectedBinders] = useState<string[]>([]);
  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [saving, setSaving] = useState(false);
  // Binder-Picker (Combobox): aufklappbarer Panel mit Suche + verfügbaren Sammlungen
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const pickerInputRef = useRef<HTMLInputElement>(null);

  // Slide-In + Swipe-Down — gleiche Mechanik wie CardDetailSheet
  const [visible, setVisible] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    // Mount → next frame visible setzen, damit die Slide-In-Transition läuft
    const r = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, CLOSE_ANIM_MS);
  };

  useEffect(() => {
    // Nur echte Sammlungen laden — Default-Binder ist virtuell
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
      // Wenn explizite Sammlungen gewählt sind, NUR diese — sonst Default-Binder.
      if (selectedBinders.length === 0) {
        const defaultId = await ensureDefaultBinder();
        await addCardToBinder(defaultId, cardId);
      } else {
        for (const id of selectedBinders) {
          await addCardToBinder(id, cardId);
        }
      }
      onSaved();
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  };

  // Picker zeigt nur echte Binder — der Default-Binder „Meine Sammlung" ist
  // nicht selektierbar (er ist der Fallback, wenn die Liste leer ist).
  const availableOptions = useMemo(() => {
    const s = pickerSearch.trim().toLowerCase();
    return binders
      .filter(b => !selectedBinders.includes(b.id))
      .filter(b => !s || b.name.toLowerCase().includes(s));
  }, [binders, selectedBinders, pickerSearch]);
  const selectedDocs = selectedBinders
    .map(id => binders.find(b => b.id === id))
    .filter(Boolean) as BinderDoc[];

  const addBinder = (id: string) => {
    setSelectedBinders(prev => prev.includes(id) ? prev : [...prev, id]);
    setPickerSearch('');
    // Picker offen lassen, falls Stefan mehrere hinzufügen will — schließt erst per Tap außerhalb
    pickerInputRef.current?.focus();
  };
  const removeBinder = (id: string) => {
    setSelectedBinders(prev => prev.filter(x => x !== id));
  };

  // Portal direkt in document.body: verhindert, dass das Modal in einem
  // trapped Stacking-Context landet (z.B. Scanner-Root ist selbst `position: fixed`,
  // was IMMER einen eigenen Stacking-Context erzeugt — jedes z-index darin wird nur
  // lokal verglichen und kann nie über Geschwister-Elemente wie die BottomNav
  // hinausragen, egal wie hoch der Wert ist).
  return createPortal((
    <div className="fixed inset-0 z-[100] flex items-end">
      <div
        className="absolute inset-0 bg-black/60 transition-opacity duration-[250ms]"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={handleClose}
      />

      <div
        className="relative w-full rounded-t-2xl bg-card border-t border-border p-4 pb-safe"
        style={{
          transform: visible ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: dragStartYRef.current != null ? 'none' : `transform ${CLOSE_ANIM_MS}ms ease-out`,
        }}
      >
        {/* Handle — Swipe-Down zum Schließen */}
        <div
          className="flex items-center justify-center -mt-1 mb-3 py-2 cursor-grab"
          style={{ touchAction: 'none' }}
          onPointerDown={e => {
            dragStartYRef.current = e.clientY;
            setDragY(0);
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            if (dragStartYRef.current == null) return;
            const dy = e.clientY - dragStartYRef.current;
            setDragY(Math.max(0, dy));
          }}
          onPointerUp={e => {
            if (dragStartYRef.current == null) return;
            const dy = e.clientY - dragStartYRef.current;
            dragStartYRef.current = null;
            try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            if (dy > 80) handleClose();
            else setDragY(0);
          }}
          onPointerCancel={() => { dragStartYRef.current = null; setDragY(0); }}
        >
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

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

        {/* Sammlung — Mehrfach-Auswahl mit Pills + Combobox-Picker.
            Wenn nichts explizit gewählt ist, zeigt eine gedimmte „Meine Sammlung"-
            Pill den Default-Fallback an. Diese Pill ist nicht entfernbar. */}
        <div className="mb-4">
          <div className="text-xs text-muted-foreground mb-1.5">Sammlung</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedDocs.length === 0 ? (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-dashed text-sm"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--secondary)',
                  color: 'var(--muted-foreground)',
                }}
                title="Standard — wenn keine Sammlung gewählt ist"
              >
                <span>Meine Sammlung</span>
              </span>
            ) : (
              selectedDocs.map(b => (
                <span
                  key={b.id}
                  className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full border text-sm"
                  style={{
                    borderColor: 'var(--pokedex-red)',
                    background: 'rgba(229,62,62,.1)',
                    color: 'var(--pokedex-red)',
                  }}
                >
                  {b.icon && <span>{b.icon}</span>}
                  <span>{b.name}</span>
                  <button
                    onClick={() => removeBinder(b.id)}
                    className="rounded-full p-0.5 hover:bg-black/10"
                    aria-label={`${b.name} entfernen`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))
            )}
            {availableOptions.length > 0 && (
              <button
                onClick={() => setPickerOpen(o => !o)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-border text-sm text-muted-foreground"
                aria-label="Sammlung hinzufügen"
              >
                <Plus size={14} />
                <span>Hinzufügen</span>
              </button>
            )}
          </div>

          {pickerOpen && availableOptions.length > 0 && (
            <div
              className="mt-2 rounded-xl border border-border bg-secondary overflow-hidden"
              onPointerDown={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <Search size={14} className="text-muted-foreground shrink-0" />
                <input
                  ref={pickerInputRef}
                  type="text"
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                  placeholder="Sammlung suchen…"
                  className="flex-1 bg-transparent text-sm outline-none"
                  autoFocus
                />
                <button
                  onClick={() => { setPickerOpen(false); setPickerSearch(''); }}
                  className="rounded-full p-1 text-muted-foreground"
                  aria-label="Picker schließen"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {availableOptions.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                    Keine weiteren Sammlungen
                  </div>
                ) : (
                  availableOptions.map(o => (
                    <button
                      key={o.id}
                      onClick={() => addBinder(o.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-card active:bg-card"
                    >
                      {o.icon && <span>{o.icon}</span>}
                      <span>{o.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="w-full h-11 rounded-md font-semibold text-sm text-white disabled:opacity-50 transition-opacity"
          style={{ background: 'var(--action-add)' }}
        >
          {saving ? 'Wird gespeichert…' : 'Zur Sammlung hinzufügen'}
        </button>
      </div>
    </div>
  ), document.body);
}
