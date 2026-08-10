'use client';

import { useState } from 'react';
import { addBinder, updateBinder } from '@/lib/firestore/binders';
import { syncTemplateBinders } from '@/lib/template-binders/sync';
import { BinderIcon, pokemonArtworkUrl } from '@/lib/binder-icons';
import { IconPicker } from '@/components/binder/IconPicker';
import { ButtonGroup } from '@/components/ui/button-group';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BINDER_SIZES, type BinderSize } from '@/lib/binder-sizes';
import { initialSheetCount } from '@/lib/binder-sheets';
import type { BinderDoc, BinderPage, BinderTemplate } from '@/types';

const COLORS = ['#1a1a1a', '#ffffff', '#e53e3e', '#4299e1', '#ecc94b', '#48bb78', '#667eea'];

/** Fixer Akzent für die Auswahl-Hervorhebungen im Drawer (Typ-/Icon-Picker)
 *  — bewusst UNABHÄNGIG von der gewählten Sammlungsfarbe, sonst würde z.B.
 *  ein weißer/schwarzer Farbwahl die Hervorhebungen mitverfärben. */
const ACCENT = '#e53e3e';
// Footer-Button: Neu anlegen = Hinzufügen-Grün (wie die "Neue Sammlung"-
// Kachel/CTA anderswo), Bestehendes bearbeiten = normales Primary-Blau.
const ADD_ACCENT = '#2f855a';
const PRIMARY_ACCENT = '#3182ce';

interface Props {
  existing?: BinderDoc;
  /** Gesetzt = Vorlagen-Binder wird angelegt (Illustrator/Pokédex/
   *  Evolutionslinie/Master-Set) — Name/Icon/Farbe unten sind Vorschläge,
   *  die vor dem Erstellen noch angepasst werden können; Typ ist dann
   *  immer 'binder' (kein Box-Vorlagen-Binder, da Vorlagen positionale
   *  Slots brauchen). Nach dem Erstellen läuft sofort ein erster Sync,
   *  damit der Binder nicht leer bleibt, bis der nächste Cron-Lauf kommt. */
  templateDraft?: BinderTemplate;
  initialName?: string;
  initialIcon?: string;
  initialColor?: string;
  /** Klarer Pokémon-Name für den Icon-Picker-Trigger, wenn `initialIcon` ein
   *  `pokemon:<dex>` ist (sonst zeigt der Trigger nur die Dex-Nummer). */
  initialPokemonName?: string;
  /** Set-Anzeige (Name/Zyklus/Kürzel) für die fixe Icon-Kachel bei
   *  Master-Set-Vorlagen — analog zur read-only Pokémon-Kachel. */
  initialSetDisplay?: { label: string; sub?: string; hint?: string };
  /** Überschreibt die Titelzeile (z.B. „Neue Pokémon Sammlung" aus dem
   *  Vorlagen-Flow); ohne Angabe der bisherige Default. */
  title?: string;
  /** Letzter Schritt eines mehrstufigen Erstellen-Flows: zeigt links einen
   *  Zurück-Chevron (zum vorherigen Schritt). Ohne diese Prop (z.B.
   *  Bearbeiten-Modus) bleibt die Titelzeile bei reinem X. */
  onBack?: () => void;
  onClose: () => void;
  onSaved: () => void;
}

export function CreateBinderModal({ existing, templateDraft, initialName, initialIcon, initialColor, initialPokemonName, initialSetDisplay, title, onBack, onClose, onSaved }: Props) {
  const [collectionType, setCollectionType] = useState<'binder' | 'box'>(existing?.collectionType ?? 'binder');
  const [name,   setName]   = useState(existing?.name ?? initialName ?? '');
  const [icon,   setIcon]   = useState(existing?.icon ?? initialIcon ?? 'folder');
  const [color,  setColor]  = useState(existing?.color ?? initialColor ?? '#e53e3e');
  const [size,     setSize]     = useState<BinderSize>((existing?.size as BinderSize) ?? 9);
  const [capacity, setCapacity] = useState<string>(existing?.capacity != null ? String(existing.capacity) : '');
  const [pageBg,   setPageBg]   = useState<'black' | 'white' | 'transparent'>(existing?.pageBackground ?? 'black');
  const [saving,   setSaving]   = useState(false);

  const isBinder = collectionType === 'binder';
  // Vorlagen mit fixem Icon: Pokémon (Artwork) bzw. Master-Set (Set-Logo) — das
  // Icon ergibt sich aus der Auswahl, daher read-only statt Tab-Picker.
  const isPokemonTemplate = templateDraft?.type === 'pokemon';
  const isMasterSetTemplate = templateDraft?.type === 'masterSet';
  // Illustrator-Vorlage: kein festes Icon (kein Logo/Artwork), aber Typ-/Set-/
  // Pokémon-Icons ergeben inhaltlich keinen Sinn → nur die Basis-Icons anbieten.
  const isArtistTemplate = templateDraft?.type === 'artist';

  // Dex-Nummer aus dem Icon-String (für die read-only Pokémon-Vorlagen-Kachel).
  const pokeDex = icon.startsWith('pokemon:') ? icon.slice(8) : null;

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // Beim Bearbeiten: leeres Feld → null (löscht den Wert in Firestore).
      // Beim Neu-Erstellen: leeres Feld → undefined (Feld wird gar nicht geschrieben).
      const parsedCapacity = capacity.trim() === ''
        ? (existing ? null : undefined)
        : Math.max(1, Math.floor(Number(capacity)));
      const data = {
        name: name.trim(),
        icon,
        color,
        collectionType,
        ...(isBinder ? { size, capacity: parsedCapacity, pageBackground: pageBg } : {}),
      };
      if (existing) {
        await updateBinder(existing.id, data);
      } else {
        // Bei Neuanlage: leere Blätter direkt mit anlegen, damit der User
        // sofort durchblättern kann. Anzahl aus Capacity berechnet (1 Blatt = 2 Pages).
        const sheetCount = isBinder ? initialSheetCount(parsedCapacity, size) : 0;
        const initialPages: BinderPage[] = isBinder
          ? Array.from({ length: sheetCount * 2 }, () => ({ slots: Array(size).fill(null) }))
          : [];
        const newId = await addBinder({
          ...data,
          size: isBinder ? size : 9,
          sortOrder: Date.now(),
          ...(templateDraft ? { template: templateDraft } : {}),
          ...(initialPages.length > 0 ? { pages: initialPages } : {}),
        });
        // Vorlagen-Binder sofort einmal befüllen, statt auf den nächsten
        // Cron-Lauf zu warten.
        if (templateDraft) await syncTemplateBinders({ binderIds: [newId] });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={title ?? (existing ? 'Sammlung bearbeiten' : 'Neue Sammlung')}
      onBack={onBack}
      footer={
        <Button
          variant="primary"
          accentColor={existing ? PRIMARY_ACCENT : ADD_ACCENT}
          size="lg"
          className="w-full"
          onClick={save}
          disabled={!name.trim() || saving}
        >
          {saving ? 'Speichern…' : existing ? 'Änderungen speichern' : 'Sammlung erstellen'}
        </Button>
      }
    >
        {/* Typ-Auswahl — nur beim Erstellen, nicht für Vorlagen-Binder
            (immer 'binder', da Vorlagen positionale Slots brauchen) */}
        {!existing && !templateDraft && (
          <div className="mb-4">
            <label className="text-xs text-muted-foreground mb-1.5 block">Typ</label>
            <div className="grid grid-cols-2 gap-2">
              {([['binder', 'folder', 'Binder', 'Ordner mit Seitenraster'], ['box', 'box', 'Box', 'Offene Box ohne Limit']] as const).map(
                ([val, iconKey, label, sub]) => (
                  <button
                    key={val}
                    onClick={() => {
                      setCollectionType(val);
                      setIcon(val === 'box' ? 'box' : 'folder');
                    }}
                    className={`flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl border-2 transition-colors text-left ${collectionType === val ? '' : 'glass-inner'}`}
                    style={{
                      borderColor: collectionType === val ? ACCENT : 'transparent',
                      background: collectionType === val ? `${ACCENT}15` : undefined,
                    }}
                  >
                    <BinderIcon name={iconKey} size={22} className="mt-0.5" style={{ color: collectionType === val ? ACCENT : undefined }} />
                    <span className="text-sm font-semibold mt-1">{label}</span>
                    <span className="text-[10px] text-muted-foreground">{sub}</span>
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* Name */}
        <div className="mb-3">
          <label className="text-xs text-muted-foreground mb-1 block">Name</label>
          <Input
            value={name}
            onChange={setName}
            placeholder={isBinder ? 'z.B. Elektro-Stars' : 'z.B. Hoenn-Box'}
          />
        </div>

        {/* Icon picker */}
        <div className="mb-3">
          <label className="text-xs text-muted-foreground mb-1.5 block">Icon</label>

          {isPokemonTemplate ? (
            /* Pokémon-Vorlage: Icon ist fix das Artwork des gewählten Pokémon
               — read-only, keine Icon-Typ-Tabs. */
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl glass-inner">
              {pokeDex && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={pokemonArtworkUrl(pokeDex)} alt="" className="w-8 h-8 object-contain shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{initialPokemonName ?? name}</p>
                {pokeDex && (
                  <p className="text-xs text-glass-muted">#{String(pokeDex).padStart(3, '0')}</p>
                )}
              </div>
            </div>
          ) : isMasterSetTemplate ? (
            /* Master-Set-Vorlage: Icon ist fix das Set-Logo — read-only, keine
               Icon-Typ-Tabs (Logo · Name · Zyklus · Kürzel wie im Dropdown). */
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl glass-inner">
              <div className="shrink-0 flex items-center">
                <BinderIcon name={icon} size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{initialSetDisplay?.label ?? name}</p>
                {initialSetDisplay?.sub && (
                  <p className="text-xs text-glass-muted truncate">{initialSetDisplay.sub}</p>
                )}
              </div>
              {initialSetDisplay?.hint && (
                <span className="text-xs text-glass-muted shrink-0">{initialSetDisplay.hint}</span>
              )}
            </div>
          ) : (
            <IconPicker
              value={icon}
              onChange={setIcon}
              accent={ACCENT}
              lockBasis={isArtistTemplate}
              initialPokemonName={initialPokemonName ?? null}
            />
          )}
        </div>

        {/* Color picker */}
        <div className="mb-3">
          <label className="text-xs text-muted-foreground mb-1 block">Farbe</label>
          <div className="flex gap-1">
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="w-11 h-11 rounded-full border-2 transition-all"
                style={{
                  background: c,
                  borderColor: color === c ? 'transparent' : 'rgba(0,0,0,0.12)',
                  boxShadow: color === c ? `0 0 0 2px var(--background), 0 0 0 4px ${c}` : undefined,
                }}
              />
            ))}
          </div>
        </div>

        {/* Größe + Kapazität — nur für Binder */}
        {isBinder && (
          <>
            <div className="mb-5">
              <label className="text-xs text-muted-foreground mb-1 block">Seitenlayout</label>
              <ButtonGroup
                value={String(size)}
                onChange={v => setSize(Number(v) as BinderSize)}
                options={BINDER_SIZES.map(s => ({ value: String(s.value), label: s.label }))}
              />
            </div>

            {/* Kapazität nur bei manuellen Sammlungen — Vorlagen-Sammlungen
                berechnen sie automatisch aus der Slot-Anzahl (Sync). */}
            {!templateDraft && (
              <div className="mb-5">
                <label className="text-xs text-muted-foreground mb-1 block">
                  Kapazität <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <Input
                  type="number"
                  value={capacity}
                  onChange={v => setCapacity(v.replace(/[^0-9]/g, ''))}
                  placeholder="z.B. 400 — wie viele Karten passen rein?"
                />
              </div>
            )}

            <div className="mb-5">
              <label className="text-xs text-muted-foreground mb-1 block">Seiten-Hintergrund</label>
              <ButtonGroup
                value={pageBg}
                onChange={setPageBg}
                options={[
                  { value: 'black',       label: <>
                    <span className="w-3.5 h-3.5 rounded-sm border border-white/30 shrink-0" style={{ background: '#1a1a1a' }} /> Schwarz
                  </> },
                  { value: 'white',       label: <>
                    <span className="w-3.5 h-3.5 rounded-sm border border-white/30 shrink-0" style={{ background: '#f3f4f6' }} /> Weiß
                  </> },
                  { value: 'transparent', label: <>
                    <span className="w-3.5 h-3.5 rounded-sm border border-white/30 shrink-0" style={{ background: 'rgba(127,127,127,0.18)' }} /> Halbtransparent
                  </> },
                ]}
              />
            </div>
          </>
        )}

    </Sheet>
  );
}
