'use client';

import { useState, useEffect } from 'react';
import { Plus, Check, ChevronDown } from 'lucide-react';
import { cardInfoToAddInput, type CardInfo } from '@/lib/card-info';
import type { CardCondition, CardLanguage, CardVariant, BinderDoc } from '@/types';
import { addCard } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder, ensureDefaultBinder } from '@/lib/firestore/binders';
import { LANGUAGES, CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';
import { BinderIcon } from '@/lib/binder-icons';
import { Button } from '@/components/ui/button';

const CONDITION_COLOR: Record<string, string> = {
  NM: '#48bb78', LP: '#facc15', MP: '#fb923c', HP: '#f87171', Poor: '#9ca3af',
};

type Field = 'condition' | 'variant' | 'language' | 'collection';

interface Props {
  card: CardInfo;
  /** Vorbelegte Werte aus dem Scan-Ergebnis (Variante/Sprache erkannt). */
  preVariant?: CardVariant;
  preCondition?: CardCondition;
  preLanguage?: CardLanguage;
  /** Anzahl bereits besessener Exemplare — steuert den „Verwalten"-Link. */
  ownedCount: number;
  /** Nach erfolgreichem Speichern: Parent aktualisiert ownedCount/added. */
  onSaved: () => void;
  /** Öffnet den Exemplar-Verwalten/Löschen-Drawer (DeleteFromCollectionModal). */
  onManage: () => void;
  /** Eingeklappt: Attribut-/Sammlungs-Dropdowns ausblenden (mehr Karte sichtbar),
   *  Hinzufügen-Button + Verwalten-Link bleiben. Gesteuert vom Griff im Panel. */
  collapsed?: boolean;
}

/** Inline-Hinzufügen-Leiste unter der erkannten Karte (Einzelscan): zeigt
 *  Zustand/Variante/Sprache als vorbelegte Chips (Tap → Popover) plus die
 *  Ziel-Sammlung, darunter einen breiten „Hinzufügen"-Button. So landet eine
 *  erkannte Karte mit genau einem Klick in der Sammlung, ohne Zwischen-Drawer.
 *  Löschen läuft bewusst NICHT hier, sondern über den Exemplar-Drawer
 *  (`onManage`) — ein Exemplar ist erst durch Sammlung + Zustand + Variante +
 *  Sprache eindeutig, die Sammlungswahl allein reicht dafür nicht. */
export function RecognizedAddBar({
  card, preVariant, preCondition, preLanguage, ownedCount, onSaved, onManage, collapsed = false,
}: Props) {
  const variantOptions: CardVariant[] =
    (card.variants && card.variants.length > 0 ? card.variants : ['standard']) as CardVariant[];

  const [variant, setVariant]     = useState<CardVariant>(preVariant ?? variantOptions[0] ?? 'standard');
  const [condition, setCondition] = useState<CardCondition>(preCondition ?? 'NM');
  const [language, setLanguage]   = useState<CardLanguage>(preLanguage ?? 'de');

  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);

  const [open, setOpen] = useState<Field | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Auswählbare Ziele: manuelle Sammlungen + „Unsortiert" (Default), aber KEINE
  // Vorlagen-Binder (die füllen sich automatisch, sind nicht direkt bebuchbar).
  const selectable = binders
    .filter(b => !b.template)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const target = selectable.find(b => b.id === targetId) ?? null;
  const targetName = target?.name ?? 'Unsortiert';

  useEffect(() => {
    getBinders().then(list => {
      setBinders(list);
      // Default = „Unsortiert"/Eingang (isDefault), sonst erster auswählbarer.
      const def = list.find(b => b.isDefault && !b.template) ?? list.find(b => !b.template);
      if (def) setTargetId(def.id);
    }).catch(() => {});
  }, []);

  const toggle = (f: Field) => setOpen(o => (o === f ? null : f));

  // Beim Einklappen ein offenes Popover mit schließen.
  useEffect(() => { if (collapsed) setOpen(null); }, [collapsed]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const cardId = await addCard(
        cardInfoToAddInput(card, { variant, condition, language, needsReview: true }),
      );
      const dest = targetId ?? await ensureDefaultBinder();
      await addCardToBinder(dest, cardId);
      onSaved();
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1600);
    } catch (err) {
      console.error('RecognizedAddBar save error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-2.5">
      {/* Klick-Fänger: schließt ein offenes Popover beim Tippen daneben. */}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(null)} />}

      {/* Einklappbare Dropdown-Sektion — der Griff im Panel blendet Zustand/
          Variante/Sprache + Sammlung aus, damit mehr von der Karte sichtbar
          wird. Hinzufügen-Button + Verwalten-Link bleiben stehen. */}
      <div
        className="w-full overflow-hidden"
        style={{
          maxHeight: collapsed ? 0 : 260,
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : 'auto',
          transition: 'max-height 300ms ease, opacity 200ms ease',
        }}
      >
      <div className="flex flex-col gap-2.5">
      <div className="h-px w-full bg-white/15" />

      {/* Attribut-Chips: Zustand · Variante · Sprache */}
      <div className="grid grid-cols-3 gap-2">
        <Chip label="Zustand" open={open === 'condition'} onToggle={() => toggle('condition')} align="left">
          <ChipValue>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CONDITION_COLOR[condition] }} />
            {condition}
          </ChipValue>
          {open === 'condition' && (
            <Popover align="left">
              {CONDITIONS.map(c => (
                <Row key={c.value} selected={c.value === condition} onClick={() => { setCondition(c.value); setOpen(null); }}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CONDITION_COLOR[c.value] }} />
                  {c.value}<span className="text-white/45 font-normal text-xs">{c.label}</span>
                </Row>
              ))}
            </Popover>
          )}
        </Chip>

        <Chip label="Variante" open={open === 'variant'} onToggle={() => toggle('variant')} align="center">
          <ChipValue><span className="truncate">{VARIANT_LABELS[variant]}</span></ChipValue>
          {open === 'variant' && (
            <Popover align="center">
              {variantOptions.map(v => (
                <Row key={v} selected={v === variant} onClick={() => { setVariant(v); setOpen(null); }}>
                  {VARIANT_LABELS[v]}
                </Row>
              ))}
            </Popover>
          )}
        </Chip>

        <Chip label="Sprache" open={open === 'language'} onToggle={() => toggle('language')} align="right">
          <ChipValue>{language.toUpperCase()}</ChipValue>
          {open === 'language' && (
            <Popover align="right">
              {LANGUAGES.map(l => (
                <Row key={l.value} selected={l.value === language} onClick={() => { setLanguage(l.value); setOpen(null); }}>
                  {l.value.toUpperCase()}<span className="text-white/45 font-normal text-xs">{l.label}</span>
                </Row>
              ))}
            </Popover>
          )}
        </Chip>
      </div>

      {/* Ziel-Sammlung */}
      <div className="relative">
        <div
          role="button"
          tabIndex={0}
          onClick={() => toggle('collection')}
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-2xl cursor-pointer"
          style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.16)' }}
        >
          <span
            className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center shrink-0"
            style={{ background: `color-mix(in srgb, ${target?.color ?? '#8898b0'} 26%, transparent)` }}
          >
            <BinderIcon name={target?.icon ?? 'folder'} size={17} style={{ color: target?.color ?? '#cbd5e1' }} />
          </span>
          <span className="flex flex-col min-w-0">
            <span className="text-[9px] font-bold uppercase tracking-wide text-white/50">Sammlung</span>
            <span className="text-white text-[15px] font-bold truncate">{targetName}</span>
          </span>
          <ChevronDown size={17} className="ml-auto text-white/55 shrink-0" />
        </div>
        {open === 'collection' && (
          <div
            className="absolute z-50 left-0 right-0 bottom-[calc(100%+8px)] p-1.5 rounded-2xl max-h-[240px] overflow-y-auto"
            style={{
              background: 'rgba(28,29,36,0.94)',
              backdropFilter: 'blur(24px) saturate(1.5)', WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
              border: '1px solid rgba(255,255,255,0.16)', boxShadow: '0 12px 34px rgba(0,0,0,0.5)',
            }}
          >
            {selectable.map(b => (
              <button
                key={b.id}
                onClick={() => { setTargetId(b.id); setOpen(null); }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left"
                style={b.id === targetId ? { background: 'rgba(255,255,255,0.14)' } : undefined}
              >
                <span
                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `color-mix(in srgb, ${b.color ?? '#8898b0'} 24%, transparent)` }}
                >
                  <BinderIcon name={b.icon ?? 'folder'} size={15} style={{ color: b.color ?? '#cbd5e1' }} />
                </span>
                <span className="text-white text-sm font-semibold truncate flex-1">{b.name}</span>
                {b.id === targetId && <Check size={15} className="text-[#8ff0b0] shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      </div>
      </div>

      {/* Breiter Hinzufügen-Button — Design-System-Button (variant primary,
          grüner Akzent wie im AddToCollectionModal). */}
      <Button
        variant="primary"
        accentColor="#2f855a"
        size="lg"
        className="w-full"
        disabled={saving}
        icon={justSaved ? <Check strokeWidth={3} /> : <Plus strokeWidth={3} />}
        onClick={save}
      >
        {justSaved ? 'Hinzugefügt' : saving ? 'Wird gespeichert …' : 'Hinzufügen'}
      </Button>

      {/* Verwalten/Entfernen — nur wenn schon Exemplare existieren. Öffnet den
          Exemplar-Drawer; dort wird das konkrete Exemplar (Sammlung + Zustand +
          Variante + Sprache) zum Löschen gewählt. */}
      {ownedCount > 0 && (
        <button
          onClick={onManage}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[13px] font-semibold"
          style={{ color: 'rgba(255,138,138,0.9)' }}
        >
          <span className="w-3.5 h-0.5 rounded-full bg-current inline-block" />
          {ownedCount} {ownedCount === 1 ? 'Exemplar' : 'Exemplare'} verwalten …
        </button>
      )}
    </div>
  );
}

/** Ein Attribut-Chip (Zustand/Variante/Sprache) mit Label + Wert + Caret. */
function Chip({
  label, open, onToggle, align, children,
}: {
  label: string; open: boolean; onToggle: () => void;
  align: 'left' | 'center' | 'right'; children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        className="flex flex-col gap-0.5 px-2.5 py-2 rounded-2xl cursor-pointer"
        style={{
          background: open ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.10)',
          border: `1px solid ${open ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.16)'}`,
        }}
      >
        <span className="text-[9px] font-bold uppercase tracking-wide text-white/50">{label}</span>
        {children}
      </div>
    </div>
  );
}

function ChipValue({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-white text-sm font-bold min-w-0">
      {children}
      <ChevronDown size={13} className="ml-auto text-white/50 shrink-0" />
    </span>
  );
}

function Popover({ align, children }: { align: 'left' | 'center' | 'right'; children: React.ReactNode }) {
  const pos =
    align === 'left' ? 'left-0'
    : align === 'right' ? 'right-0'
    : 'left-1/2 -translate-x-1/2';
  return (
    <div
      className={`absolute z-50 ${pos} bottom-[calc(100%+8px)] w-[180px] p-1.5 rounded-2xl`}
      style={{
        background: 'rgba(28,29,36,0.94)',
        backdropFilter: 'blur(24px) saturate(1.5)', WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
        border: '1px solid rgba(255,255,255,0.16)', boxShadow: '0 12px 34px rgba(0,0,0,0.5)',
      }}
    >
      {children}
    </div>
  );
}

function Row({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-white text-sm font-semibold"
      style={selected ? { background: 'rgba(255,255,255,0.14)' } : undefined}
    >
      {children}
      {selected && <Check size={15} className="ml-auto text-[#8ff0b0] shrink-0" />}
    </button>
  );
}
