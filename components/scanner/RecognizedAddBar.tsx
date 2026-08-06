'use client';

import { useState, useEffect } from 'react';
import { Plus, Check } from 'lucide-react';
import { cardInfoToAddInput, type CardInfo } from '@/lib/card-info';
import type { CardCondition, CardLanguage, CardVariant, BinderDoc } from '@/types';
import { addCard } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder, ensureDefaultBinder } from '@/lib/firestore/binders';
import { matchTemplateBinders } from '@/lib/template-binders/match-hint';
import { syncTemplateBinders } from '@/lib/template-binders/sync';
import { LANGUAGES, CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';
import { BinderIcon } from '@/lib/binder-icons';
import { Button } from '@/components/ui/button';
import { CustomSelect } from '@/components/ui/select';

const CONDITION_COLOR: Record<string, string> = {
  NM: '#48bb78', LP: '#facc15', MP: '#fb923c', HP: '#f87171', Poor: '#9ca3af',
};

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
  /** Kollaps-Hülle der Add-Sektion — Style (maxHeight/Transition) kommt aus
   *  `useGrabberCollapse` (regionStyle(0)) im Panel; so folgt der Griff dem
   *  Finger + Snap, identisch zu den Filter-Panels. */
  regionStyle?: React.CSSProperties;
  /** Callback-Ref für die Höhenmessung der Region (registerRegion(0)). */
  regionRef?: (el: HTMLDivElement | null) => void;
}

/** Inline-Hinzufügen-Leiste unter der erkannten Karte (Einzelscan): Zustand,
 *  Variante, Sprache und Ziel-Sammlung als Design-System-Dropdowns
 *  (`CustomSelect`, Portal-Panel → wird nicht von der Einklapp-Hülle
 *  abgeschnitten), darunter ein breiter „Hinzufügen"-Button. So landet eine
 *  erkannte Karte mit wenigen Klicks in der Sammlung, ohne Zwischen-Drawer.
 *  Löschen läuft bewusst NICHT hier, sondern über den Exemplar-Drawer
 *  (`onManage`) — ein Exemplar ist erst durch Sammlung + Zustand + Variante +
 *  Sprache eindeutig. */
export function RecognizedAddBar({
  card, preVariant, preCondition, preLanguage, ownedCount, onSaved, onManage,
  regionStyle, regionRef,
}: Props) {
  const variantOptions: CardVariant[] =
    (card.variants && card.variants.length > 0 ? card.variants : ['standard']) as CardVariant[];

  const [variant, setVariant]     = useState<CardVariant>(preVariant ?? variantOptions[0] ?? 'standard');
  const [condition, setCondition] = useState<CardCondition>(preCondition ?? 'NM');
  const [language, setLanguage]   = useState<CardLanguage>(preLanguage ?? 'de');

  const [binders, setBinders] = useState<BinderDoc[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Auswählbare Ziele: manuelle Sammlungen + „Unsortiert" (Default), aber KEINE
  // Vorlagen-Binder (die füllen sich automatisch, sind nicht direkt bebuchbar).
  const selectable = binders
    .filter(b => !b.template)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  // Empfehlungen: passende Vorlagen-Sammlungen (Master-Set/Pokédex/Pokémon/
  // Illustrator) — wie die „Vorschläge" im Kartendetail-Drawer. Werden oben im
  // Sammlung-Dropdown angezeigt (Icon/Logo + Name + Hinweis „Empfohlen").
  const recommended = matchTemplateBinders(card, binders.filter(b => b.template));

  // Sammlung-Optionen: Empfehlungen zuerst, dann Unsortiert + manuelle Sammlungen.
  const collectionOptions = [
    ...recommended.map(b => ({
      value: b.id,
      label: b.name,
      hint: 'Empfohlen',
      icon: <BinderIcon name={b.icon ?? 'cards'} size={15} style={{ color: b.color ?? '#cbd5e1' }} />,
    })),
    ...selectable.map(b => ({
      value: b.id,
      label: b.name,
      icon: <BinderIcon name={b.icon ?? 'folder'} size={15} style={{ color: b.color ?? '#cbd5e1' }} />,
    })),
  ];

  useEffect(() => {
    getBinders().then(list => {
      setBinders(list);
      // Default = „Unsortiert"/Eingang (isDefault), sonst erster auswählbarer.
      const def = list.find(b => b.isDefault && !b.template) ?? list.find(b => !b.template);
      if (def) setTargetId(def.id);
    }).catch(() => {});
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const cardId = await addCard(
        cardInfoToAddInput(card, { variant, condition, language, needsReview: true }),
      );
      const chosen = binders.find(b => b.id === targetId);
      if (chosen?.template) {
        // Vorlagen-Sammlungen sind auto-verwaltet — nicht direkt bebuchen,
        // sondern nach „Unsortiert" legen und die passende Vorlage syncen (die
        // holt sich die Karte dann selbst rein, exklusiv wie beim Auto-Flow).
        const unsortedId = await ensureDefaultBinder();
        await addCardToBinder(unsortedId, cardId);
        await syncTemplateBinders({ binderIds: [chosen.id] });
      } else {
        await addCardToBinder(targetId ?? await ensureDefaultBinder(), cardId);
      }
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
    // `dark` erzwingt die Dark-Optik der Design-System-Selects (text-glass etc.),
    // da der Scanner immer über dem dunklen Kamerabild liegt — unabhängig vom
    // App-Theme (analog zum forceDark der Scanner-Drawer).
    <div className="dark w-full flex flex-col gap-2.5">
      {/* Einklappbare Add-Sektion — der Griff im Panel blendet die Dropdowns +
          Hinzufügen-Button + Verwalten-Link aus (mehr Karte sichtbar). Die
          Dropdown-Panels selbst hängen per Portal an <body>, werden also NICHT
          vom overflow-hidden hier abgeschnitten. */}
      <div className="w-full overflow-hidden" style={regionStyle}>
      <div ref={regionRef} className="flex flex-col gap-2.5">
        <div className="h-px w-full bg-white/15" />

        {/* Zustand · Variante · Sprache */}
        <div className="grid grid-cols-3 gap-2">
          <Field label="Zustand">
            <CustomSelect
              fullWidth height="sm" aria-label="Zustand"
              value={condition}
              onChange={(v) => setCondition(v)}
              options={CONDITIONS.map(c => ({
                value: c.value,
                label: c.value,          // Trigger: nur Kürzel (NM/LP/…)
                hint: c.label,           // Panel: zusätzlich Langform (Near Mint …)
                icon: <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CONDITION_COLOR[c.value] }} />,
              }))}
            />
          </Field>
          <Field label="Variante">
            <CustomSelect
              fullWidth height="sm" aria-label="Variante"
              value={variant}
              onChange={(v) => setVariant(v)}
              options={variantOptions.map(v => ({ value: v, label: VARIANT_LABELS[v] }))}
            />
          </Field>
          <Field label="Sprache">
            <CustomSelect
              fullWidth height="sm" aria-label="Sprache"
              value={language}
              onChange={(v) => setLanguage(v)}
              options={LANGUAGES.map(l => ({
                value: l.value,
                label: l.value.toUpperCase(), // Trigger: Kürzel (DE/EN/…)
                hint: l.label,                // Panel: Langform (Deutsch …)
              }))}
            />
          </Field>
        </div>

        {/* Ziel-Sammlung */}
        <Field label="Sammlung">
          <CustomSelect
            fullWidth aria-label="Sammlung"
            value={targetId}
            placeholder="Unsortiert"
            onChange={(v) => setTargetId(v)}
            options={collectionOptions}
          />
        </Field>

        {/* Breiter Hinzufügen-Button — Design-System-Button (variant primary). */}
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
      </div>
    </div>
  );
}

/** Label über einem Dropdown (Zustand/Variante/Sprache/Sammlung). */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-white/50 px-0.5">{label}</span>
      {children}
    </label>
  );
}
