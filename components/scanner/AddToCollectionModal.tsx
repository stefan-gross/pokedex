'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Search, ChevronDown, Check } from 'lucide-react';
import type { CardInfo } from '@/lib/card-info';
import type { CardCondition, CardLanguage, CardVariant } from '@/types';
import { addCard } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder, ensureDefaultBinder } from '@/lib/firestore/binders';
import { LANGUAGES, CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';
import { CardPrice } from '@/components/card/CardPrice';
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
  fromScanner = false,
  onClose, onSaved,
}: Props) {
  // fromScanner = dunkles Liquid-Glass-Sheet (Handoff design_handoff_add_drawer,
  // "13c") statt des normalen hellen Bottom-Sheets — der Scanner liegt immer
  // über dem Kamerabild, deshalb hier immer Dark, unabhängig vom App-Theme.
  const isGlass = fromScanner;
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

  const sheetTransition = dragStartYRef.current != null ? 'none' : `transform ${CLOSE_ANIM_MS}ms ease-out`;

  // Portal direkt in document.body: verhindert, dass das Modal in einem
  // trapped Stacking-Context landet (z.B. Scanner-Root ist selbst `position: fixed`,
  // was IMMER einen eigenen Stacking-Context erzeugt — jedes z-index darin wird nur
  // lokal verglichen und kann nie über Geschwister-Elemente wie die BottomNav
  // hinausragen, egal wie hoch der Wert ist).
  return createPortal((
    <div className="fixed inset-0 z-[100] flex items-end">
      <div
        className={isGlass
          ? 'absolute inset-0 transition-opacity duration-[250ms] [backdrop-filter:saturate(0.5)_brightness(0.42)_blur(2px)] [-webkit-backdrop-filter:saturate(0.5)_brightness(0.42)_blur(2px)]'
          : 'absolute inset-0 bg-black/60 transition-opacity duration-[250ms]'}
        style={{ opacity: visible ? 1 : 0, ...(isGlass ? { background: 'rgba(8,7,12,0.35)' } : {}) }}
        onClick={handleClose}
      />

      <div
        className={isGlass ? 'relative w-full' : 'relative w-full rounded-t-2xl bg-card border-t border-border p-4 pb-safe'}
        style={{
          transform: visible ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: sheetTransition,
          ...(isGlass
            ? {
                background: 'rgba(28,29,38,0.4)',
                backdropFilter: 'blur(34px) saturate(1.5)',
                WebkitBackdropFilter: 'blur(34px) saturate(1.5)',
                borderTop: '1px solid rgba(255,255,255,0.18)',
                borderRadius: '26px 26px 0 0',
                boxShadow: '0 -12px 40px rgba(0,0,0,0.5)',
                padding: '12px 18px calc(22px + env(safe-area-inset-bottom, 0px))',
              }
            : {}),
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
          <div className={isGlass ? 'w-9 h-1 rounded-full bg-white/30' : 'w-10 h-1 rounded-full bg-border'} />
        </div>

        {/* Karten-Zeile — nur im Scanner-Glas-Drawer (Handoff design_handoff_add_drawer) */}
        {isGlass && (
          <div
            className="flex items-center gap-3 pb-[14px] mb-4"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.imgSmallDe || card.imgSmall}
              alt={card.name}
              className="w-10 h-14 rounded-[6px] object-cover shrink-0"
            />
            <div className="min-w-0">
              <div className="text-base font-bold text-white truncate">{card.name}</div>
              <div className="text-xs text-white/60 truncate">{card.setName} · {card.number}</div>
            </div>
            <CardPrice tcgId={card.id} plain fontSize={15} className="ml-auto text-[#6cb0ff]! font-extrabold shrink-0" />
          </div>
        )}

        {/* Variante + Zustand + Sprache */}
        <div className="grid grid-cols-3 gap-2 mb-3" style={isGlass ? { gap: 10, marginBottom: 16 } : undefined}>
          {isGlass ? (
            <>
              <GlassSelect label="Variante" value={variant} onChange={v => setVariant(v as CardVariant)} disabled={variantOptions.length <= 1}>
                {variantOptions.map(v => <option key={v} value={v}>{VARIANT_LABELS[v]}</option>)}
              </GlassSelect>
              <GlassSelect label="Zustand" value={condition} onChange={v => setCondition(v as CardCondition)}>
                {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.short}</option>)}
              </GlassSelect>
              <GlassSelect label="Sprache" value={language} onChange={v => setLanguage(v as CardLanguage)}>
                {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </GlassSelect>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>

        {/* Sammlung — Mehrfach-Auswahl mit Pills + Combobox-Picker.
            Wenn nichts explizit gewählt ist, zeigt eine gedimmte „Meine Sammlung"-
            Pill den Default-Fallback an. Diese Pill ist nicht entfernbar. */}
        <div className="mb-4">
          <div className={isGlass ? 'text-[12px] font-semibold text-white/60 mb-2' : 'text-xs text-muted-foreground mb-1.5'}>Sammlung</div>
          <div className="flex flex-wrap items-center gap-1.5" style={isGlass ? { gap: 10 } : undefined}>
            {selectedDocs.length === 0 ? (
              isGlass ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full text-sm font-semibold text-white"
                  style={{ padding: '10px 16px', background: 'rgba(34,197,94,0.85)' }}
                  title="Standard — wenn keine Sammlung gewählt ist"
                >
                  <Check size={14} strokeWidth={3} />
                  <span>Meine Sammlung</span>
                </span>
              ) : (
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
              )
            ) : (
              selectedDocs.map(b => (
                isGlass ? (
                  <span
                    key={b.id}
                    className="inline-flex items-center gap-1.5 rounded-full text-sm font-semibold text-white"
                    style={{ padding: '10px 10px 10px 16px', background: 'rgba(34,197,94,0.85)' }}
                  >
                    {b.icon ? <span>{b.icon}</span> : <Check size={14} strokeWidth={3} />}
                    <span>{b.name}</span>
                    <button
                      onClick={() => removeBinder(b.id)}
                      className="rounded-full p-0.5 hover:bg-black/15"
                      aria-label={`${b.name} entfernen`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ) : (
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
                )
              ))
            )}
            {availableOptions.length > 0 && (
              isGlass ? (
                <button
                  onClick={() => setPickerOpen(o => !o)}
                  className="inline-flex items-center gap-1 rounded-full text-sm text-white/70"
                  style={{ padding: '10px 16px', border: '1.5px dashed rgba(255,255,255,0.3)' }}
                  aria-label="Sammlung hinzufügen"
                >
                  <Plus size={14} />
                  <span>Hinzufügen</span>
                </button>
              ) : (
                <button
                  onClick={() => setPickerOpen(o => !o)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-border text-sm text-muted-foreground"
                  aria-label="Sammlung hinzufügen"
                >
                  <Plus size={14} />
                  <span>Hinzufügen</span>
                </button>
              )
            )}
          </div>

          {pickerOpen && availableOptions.length > 0 && (
            <div
              className={isGlass ? 'mt-2 rounded-xl overflow-hidden' : 'mt-2 rounded-xl border border-border bg-secondary overflow-hidden'}
              style={isGlass ? { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)' } : undefined}
              onPointerDown={e => e.stopPropagation()}
            >
              <div
                className={isGlass ? 'flex items-center gap-2 px-3 py-2' : 'flex items-center gap-2 px-3 py-2 border-b border-border'}
                style={isGlass ? { borderBottom: '1px solid rgba(255,255,255,0.12)' } : undefined}
              >
                <Search size={14} className={isGlass ? 'text-white/60 shrink-0' : 'text-muted-foreground shrink-0'} />
                <input
                  ref={pickerInputRef}
                  type="text"
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                  placeholder="Sammlung suchen…"
                  className={isGlass ? 'flex-1 bg-transparent text-sm outline-none text-white placeholder-white/40' : 'flex-1 bg-transparent text-sm outline-none'}
                  autoFocus
                />
                <button
                  onClick={() => { setPickerOpen(false); setPickerSearch(''); }}
                  className={isGlass ? 'rounded-full p-1 text-white/60' : 'rounded-full p-1 text-muted-foreground'}
                  aria-label="Picker schließen"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {availableOptions.length === 0 ? (
                  <div className={isGlass ? 'px-3 py-3 text-sm text-white/60 text-center' : 'px-3 py-3 text-sm text-muted-foreground text-center'}>
                    Keine weiteren Sammlungen
                  </div>
                ) : (
                  availableOptions.map(o => (
                    <button
                      key={o.id}
                      onClick={() => addBinder(o.id)}
                      className={isGlass
                        ? 'w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-white/10 active:bg-white/10'
                        : 'w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-card active:bg-card'}
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
          className={isGlass
            ? 'w-full rounded-[15px] font-bold text-white disabled:opacity-50 transition-opacity'
            : 'w-full h-11 rounded-md font-semibold text-sm text-white disabled:opacity-50 transition-opacity'}
          style={isGlass
            ? { height: 54, fontSize: 17, background: '#22c55e', boxShadow: '0 6px 20px rgba(34,197,94,0.4)' }
            : { background: 'var(--action-add)' }}
        >
          {saving ? 'Wird gespeichert…' : 'Zur Sammlung hinzufügen'}
        </button>
      </div>
    </div>
  ), document.body);
}

/** Glas-Select fürs Scanner-Hinzufügen-Drawer — nativer <select> mit
 *  getöntem Glas-Look + eigenem Chevron (Browser-Pfeil per appearance:none
 *  ausgeblendet). Popup-Darstellung bleibt nativ (iOS-Radlist etc.). */
function GlassSelect({ label, value, onChange, disabled, children }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col" style={{ gap: 7 }}>
      <span className="text-[12px] font-semibold text-white/60">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className="w-full text-sm text-white appearance-none disabled:opacity-50"
          style={{
            height: 48, padding: '0 30px 0 12px', borderRadius: 12,
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.16)',
          }}
        >
          {children}
        </select>
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 pointer-events-none" />
      </div>
    </label>
  );
}
